import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Alert, AppState, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, PanResponder, Platform, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text as NativeText, TextInput, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { askAssistant, calculateRoute, fetchEmergencyPublicKey, prepareOfflineGraph, searchNearbyPois, searchPlaces, searchPois } from '../api';
import { createSealedEmergencyPacket } from '../emergencyPacket';
import { useLocationSharing } from '../hooks/useLocationSharing';
import { useParty } from '../hooks/useParty';
import { buildNavigationGuidance, distanceMeters, snapPositionToRoute } from '../navigationGuidance';
import { CONNECTION_STATE, NAVIGATION_STATE, createNavigationState, transitionNavigation } from '../navigationState';
import { executeNavigationCommand } from '../navigationCommandExecutor';
import { speakAssistantText, speakNavigationGuidance, stopNavigationVoice } from '../navigationVoice';
import { assistantReplyForIntent, parseAssistantIntent } from '../assistantIntent';
import { useSpeechAssistant } from '../hooks/useSpeechAssistant';
import { loadFavoritePlaces, loadOfflineRoutePackage, loadPartyPoints, loadRecentPlaces, loadRouteHistory, loadRouteOrigins, placeStorageId, removeFavoritePlace, saveFavoritePlace, saveOfflineRoutePackage, savePartyPoints, savePartySnapshot, saveRecentPlace, saveRouteHistory, saveRouteOrigin } from '../offlineStore';
import { calculatePackagedOfflineRoute } from '../offlineNavigation';
import { createOfflineRoutePackage } from '../offlineRoutePackage';
import { MAP_TILE_TEMPLATES, useOfflineRouteTiles } from '../offlineMapTiles';
import { buildParticipantRouteStatus } from '../partyNavigation';
import { clusterAccessibilityLabel, clusterPois } from '../poiClustering';
import { SERVER_URL } from '../config';
import { connectivityLabel, CONNECTIVITY_LEVEL } from '../connectivity';

// The native marker PNG was fully transparent on iOS. Reuse the verified
// visible eagle asset already bundled with the app icon.
const EAGLE_MARKER_IMAGE = require('../../assets/eagle-app-icon.png');
const EAGLE_MARKER_ANCHOR = Platform.OS === 'android' ? { x: 0.5, y: 50 / 88 } : undefined;
// MapKit anchors custom marker views at their center. The GPS coordinate must
// land on the bottom-center of the eagle, not on the center of its 44x50 view.
const EAGLE_MARKER_CENTER_OFFSET = Platform.OS === 'ios' ? { x: 0, y: -25 } : undefined;

function decodeMojibake(value) {
  const text = String(value ?? '');
  if (!/[ÃÂâ]/.test(text)) return text;
  try { return decodeURIComponent(escape(text)); } catch { return text; }
}

function normalizeVisibleText(value) {
  let text = String(value ?? '');
  const replacements = [
    ['\u00c3\u0192\u00c2\u00a3', '\u00e3'], ['\u00c3\u0192\u00c2\u00a7', '\u00e7'],
    ['\u00c3\u0192\u00c2\u00a1', '\u00e1'], ['\u00c3\u0192\u00c2\u00a9', '\u00e9'],
    ['\u00c3\u0192\u00c2\u00aa', '\u00ea'], ['\u00c3\u0192\u00c2\u00ad', '\u00ed'],
    ['\u00c3\u0192\u00c2\u00b3', '\u00f3'], ['\u00c3\u0192\u00c2\u00b4', '\u00f4'],
    ['\u00c3\u0192\u00c2\u00ba', '\u00fa'], ['\u00c3\u201a\u00c2\u00b7', '\u00b7'],
    ['\u00c3\u00a2\u00e2\u201a\u00ac\u00c2\u00a2', '\u2022'],
    ['\u00c3\u00a2\u00e2\u201a\u00ac\u00c2\u00a6', '\u2026'],
    ['\u00c3\u00a2\u2014\u00e2\u0080\u00a2', '\u2299'],
    ['\u00c3\u00a2\u2039\u0153\u00e2', '\u2605'],
    ['\u00e2\u20ac\u00a2', '\u2022'], ['\u00e2\u20ac\u00a6', '\u2026'],
    ['\u00f0\u0178\u0094\u00b4', '\ud83c\udf74'], ['\u00e2\u203a\u00bd', '\u26fd'],
    ['\u00f0\u0178\u00b4', '\ud83c\udf74'],
    ['\u00c3\u00a7', '\u00e7'], ['\u00c3\u00a3', '\u00e3'], ['\u00c3\u00a1', '\u00e1'],
    ['\u00c3\u00a9', '\u00e9'], ['\u00c3\u00aa', '\u00ea'], ['\u00c3\u00ad', '\u00ed'],
    ['\u00c3\u00b3', '\u00f3'], ['\u00c3\u00b4', '\u00f4'], ['\u00c3\u00ba', '\u00fa'],
    ['\u00c2\u00b7', '\u00b7'], ['\u00c2\u00a9', '\u00a9'],
    ['\u00c3\u0097', '\u00d7'], ['\u00e2\u02dc\u2026', '\u2605'], ['\u00e2\u02dc\u2020', '\u2606'],
  ];
  for (const [from, to] of replacements) text = text.split(from).join(to);
  for (let attempt = 0; attempt < 5 && /[ÃÂâð]/.test(text); attempt += 1) {
    try { text = decodeURIComponent(escape(text)); } catch { break; }
  }
  return text;
}

function normalizeTextChildren(children) {
  if (Array.isArray(children)) return children.map(normalizeTextChildren);
  return typeof children === 'string' ? normalizeVisibleText(children) : children;
}

function Text({ children, ...props }) {
  return <NativeText {...props}>{normalizeTextChildren(children)}</NativeText>;
}

const INITIAL_REGION = { latitude: -14.2, longitude: -51.9, latitudeDelta: 35, longitudeDelta: 35 };
const POI_CATEGORIES = [
  { id: 'restaurant', label: 'Restaurantes', icon: '\ud83c\udf74', color: '#ea4335' },
  { id: 'fuel', label: 'Postos', icon: '\u26fd', color: '#1a73e8' }
];
POI_CATEGORIES[0].icon = '\ud83c\udf74';
POI_CATEGORIES[1].icon = '\u26fd';

const CONNECTION_PRESENTATION = {
  connecting: { label: 'CONECTANDO', message: 'Conectando à party…', color: '#f59e0b' },
  joining: { label: 'ENTRANDO', message: 'Conexão estabelecida. Confirmando sua entrada…', color: '#f59e0b' },
  online: { label: 'AO VIVO', message: '', color: '#b9f227' },
  reconnecting: { label: 'RECONECTANDO', message: 'Conexão perdida. Tentando reconectar…', color: '#f59e0b' },
  unavailable: { label: 'SEM CONEXÃO', message: 'Servidor indisponível. Continuaremos tentando.', color: '#f97316' },
  'join-error': { label: 'NÃO ENTROU', message: 'Não foi possível entrar na party.', color: '#ef4444' }
};

function MapPin({ color, label }) {
  return <View style={[styles.pin, { backgroundColor: color }]}>
    <Text style={styles.pinText}>{label}</Text>
  </View>;
}

function EagleMarker({ name, estimated = false, labelBelow = false }) {
  return <View style={[styles.eagleMarker, estimated && styles.eagleMarkerEstimated]}>
    <Image source={EAGLE_MARKER_IMAGE} resizeMode="contain" style={styles.eagleMarkerImage} />
    <View style={[styles.personLabel, labelBelow && styles.personLabelBelow]}>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.personLabelText}>{name}</Text>
    </View>
  </View>;
}

function markerCoordinate(location, participantId, participants, exact = false) {
  if (exact) return { latitude: location.lat, longitude: location.lng };
  const peers = participants.filter((item) => item.location
    && Math.abs(item.location.lat - location.lat) < 0.00005
    && Math.abs(item.location.lng - location.lng) < 0.00005);
  const slot = peers.findIndex((item) => item.id === participantId);
  if (slot <= 0) return { latitude: location.lat, longitude: location.lng };
  const angle = (slot * Math.PI * 2) / peers.length;
  const offset = 0.00025;
  return {
    latitude: location.lat + Math.cos(angle) * offset,
    longitude: location.lng + Math.sin(angle) * offset
  };
}

function visualRoutePosition(route, location) {
  if (!route || !location) return location;
  const accuracy = Number(location.accuracy);
  const snapLimit = Number.isFinite(accuracy)
    ? Math.max(90, Math.min(140, accuracy + 35))
    : 100;
  return snapPositionToRoute(route, location, snapLimit);
}

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatSpeedValue(position) {
  const speed = Number(position?.speed);
  return Number.isFinite(speed) && speed >= 0 ? String(Math.round(speed * 3.6)) : '--';
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}min` : `${minutes} min`;
}

function formatAge(milliseconds) {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min`;
}

function participantStatusText(status) {
  const eta = Number.isFinite(status?.etaSeconds) ? `ETA ${formatDuration(status.etaSeconds)}` : 'ETA indisponível';
  const update = Number.isFinite(status?.lastUpdateAgeMs) ? `atualizado há ${formatAge(status.lastUpdateAgeMs)}` : 'sem atualização';
  return `${eta} · ${update}`;
}

function searchResultDetails(result, currentLocation) {
  const parts = String(result.label || '').split(',').map((part) => part.trim()).filter(Boolean);
  const decodeMojibake = (value) => {
    const text = String(value ?? '');
    if (!/[ÃÂâ]/.test(text)) return text;
    try { return decodeURIComponent(escape(text)); } catch { return text; }
  };
  const title = decodeMojibake(result.name || parts.shift() || 'Local sem nome');
  const address = decodeMojibake(result.address || parts.join(', ') || 'Endereço não informado');
  const distanceMeters = Number.isFinite(result.distanceMeters)
    ? result.distanceMeters
    : currentLocation ? distanceBetween(currentLocation, result) : null;
  const distance = Number.isFinite(distanceMeters)
    ? `${formatDistance(distanceMeters)} de você`
    : 'Distância indisponível';
  return { title, address, distance };
}

function locationWarning(results) {
  const nearest = (results || [])
    .map((item) => Number(item.distanceMeters))
    .filter(Number.isFinite)
    .sort((first, second) => first - second)[0];
  return Number.isFinite(nearest) && nearest > 50_000
    ? `Atenção: o resultado mais próximo fica a ${formatDistance(nearest)}. Ele pode estar fora da sua cidade atual.`
    : '';
}

function distanceBetween(first, second) {
  if (!first || !second) return 0;
  const latitude = (second.lat - first.lat) * Math.PI / 180;
  const longitude = (second.lng - first.lng) * Math.PI / 180;
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cameraHeading(position, headingRef) {
  const heading = Number(position?.heading);
  const speed = Number(position?.speed);
  if (Number.isFinite(heading) && heading >= 0 && (speed >= 0.8 || headingRef.current == null)) headingRef.current = heading;
  return Number.isFinite(headingRef.current) ? headingRef.current : 0;
}

function markerRotation(position, navigationActive, headingRef) {
  const heading = cameraHeading(position, headingRef);
  // Durante a navegação a câmera já aponta para o rumo do veículo. Aplicar o
  // mesmo rumo no Marker faria a águia girar duas vezes.
  return navigationActive ? 0 : heading;
}

function isFuelSearch(value) {
  return /\b(posto|postos|combust[ií]vel|gasolina|abastecer)\b/i.test(String(value || ''));
}

export default function PartyScreen({ session, onLeave }) {
  const mapRef = useRef(null);
  const searchInputRef = useRef(null);
  const viewport = useWindowDimensions();
  const party = useParty(session.roomId, session.name, session.visible !== false);

  const [points, setPoints] = useState({ origin: null, destination: null });
  const [localRoute, setLocalRoute] = useState(null);
  const [temporaryStop, setTemporaryStop] = useState(null);
  const [activeKind, setActiveKind] = useState('destination');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [recentPlaces, setRecentPlaces] = useState([]);
  const [routeOrigins, setRouteOrigins] = useState([]);
  const [routeHistory, setRouteHistory] = useState([]);
  const [showSavedPlaces, setShowSavedPlaces] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [directRecipient, setDirectRecipient] = useState(null);
  const [directDraft, setDirectDraft] = useState('');
  const [directSending, setDirectSending] = useState(false);
  const [assistantDraft, setAssistantDraft] = useState('');
  const [assistantReply, setAssistantReply] = useState('');
  const speechAssistant = useSpeechAssistant({ onFinalTranscript: (text) => submitAssistant(text), connectivityLevel: party.connectivity.level });
  const [routeSharePickerVisible, setRouteSharePickerVisible] = useState(false);
  const [routeShareSelection, setRouteShareSelection] = useState(() => new Set());
  const [authorizedRouteParticipantIds, setAuthorizedRouteParticipantIds] = useState(() => new Set());
  const [visibleRegion, setVisibleRegion] = useState(INITIAL_REGION);
  const [activeCategories, setActiveCategories] = useState(POI_CATEGORIES.map((item) => item.id));
  const [pois, setPois] = useState([]);
  const [poiLoading, setPoiLoading] = useState(false);
  const [poiMessage, setPoiMessage] = useState('Aproxime o mapa para ver locais próximos.');
  const [selectedPoi, setSelectedPoi] = useState(null);
  const [mapStyle, setMapStyle] = useState('simple');
  const [navigationState, transitionNavigationState] = useReducer(transitionNavigation, undefined, createNavigationState);
  const navigationActive = navigationState.navigation === NAVIGATION_STATE.NAVIGATING || navigationState.navigation === NAVIGATION_STATE.RECALCULATING;
  const [navigationLocked, setNavigationLocked] = useState(false);
  const [navigationGuidance, setNavigationGuidance] = useState(null);
  const [recalculating, setRecalculating] = useState(false);
  const [sosSending, setSosSending] = useState(false);
  const poiRequestRef = useRef(0);
  const didCenterUserRef = useRef(false);
  const headingRef = useRef(null);
  const routeOriginRef = useRef(null);
  const originalNavigationRouteRef = useRef(null);
  const mapTapRef = useRef(null);
  const offRouteReadingsRef = useRef(0);
  const recalculationRef = useRef(false);
  const lastRecalculationAtRef = useRef(0);
  const lastNavigationCameraRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const restoreMapTimerRef = useRef(null);
  const speedBubbleDragStartRef = useRef({ left: 0, top: 12 });
  const speedBubbleCustomizedRef = useRef(false);
  const voiceHistoryRef = useRef({});
  const assistantHistoryRef = useRef([]);
  const categoryKey = activeCategories.join(',');
  const navigationRoute = party.personalRoute || localRoute || party.sharedRoute || party.route;
  // GPS local é necessário para busca por proximidade mesmo quando o usuário
  // optou por não compartilhar sua posição com a party.
  const location = useLocationSharing({ enabled: party.joined || navigationActive || Boolean(navigationRoute), roomId: session.roomId, shareLocation: party.locationSharingEnabled, onLocation: party.sendLocation });
  const displayedRoute = navigationActive ? navigationRoute : (localRoute || party.sharedRoute || party.route);
  const offlineTileTemplate = useOfflineRouteTiles(displayedRoute);
  const ownParticipantId = party.participantId || party.participants.find((item) => item.name === session.name)?.id;
  const ownParticipantName = session.name.trim().toLocaleLowerCase('pt-BR');
  const ownParticipant = party.participants.find((item) => item.id === ownParticipantId);
  const searchLocation = location.position || null;
  const ownLocation = party.locationSharingEnabled || navigationActive || Boolean(navigationRoute) ? location.position || ownParticipant?.location : null;
  const visualRoute = navigationRoute || displayedRoute;
  const ownMarkerLocation = useMemo(() => visualRoutePosition(visualRoute, ownLocation), [visualRoute, ownLocation]);
  const speedBubbleSize = 88;
  const defaultSpeedBubbleLeft = Math.max(8, viewport.width - speedBubbleSize - 12);
  const speedBubblePositionRef = useRef({ left: defaultSpeedBubbleLeft, top: 12 });
  const [speedBubblePosition, setSpeedBubblePosition] = useState(() => speedBubblePositionRef.current);
  const speedBubbleResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      speedBubbleDragStartRef.current = speedBubblePositionRef.current;
    },
    onPanResponderMove: (_event, gesture) => {
      const maxLeft = Math.max(8, viewport.width - speedBubbleSize - 8);
      const maxTop = Math.max(8, viewport.height - speedBubbleSize - 8);
      const nextPosition = {
        left: Math.max(8, Math.min(maxLeft, speedBubbleDragStartRef.current.left + gesture.dx)),
        top: Math.max(8, Math.min(maxTop, speedBubbleDragStartRef.current.top + gesture.dy))
      };
      speedBubblePositionRef.current = nextPosition;
      setSpeedBubblePosition(nextPosition);
      speedBubbleCustomizedRef.current = true;
    }
  }), [viewport.height, viewport.width]);
  const locationPermissionDenied = location.permissionGranted === false;
  useEffect(() => {
    transitionNavigationState({
      type: party.connected ? 'connection.online' : party.connectionStatus === 'connecting' ? 'connection.connecting' : 'connection.offline'
    });
  }, [party.connected, party.connectionStatus]);

  const participantStatuses = useMemo(() => new Map(party.participants.map((participant) => [
    participant.id,
    buildParticipantRouteStatus(
      participant,
      participant.id === ownParticipantId && party.personalRoute ? party.personalRoute : party.route
    )
  ])), [ownParticipantId, party.participants, party.personalRoute, party.route]);

  useEffect(() => {
    const command = party.incomingNavigationCommand;
    if (!command) return;
    executeNavigationCommand(command, {
      'navigation.cancel': () => {
        setLocalRoute(null);
        setNavigationGuidance(null);
        party.clearPersonalRoute();
        transitionNavigationState({ type: 'navigation.cancel' });
        return { message: 'Navegação cancelada no dispositivo.' };
      },
      'navigation.pause': () => {
        transitionNavigationState({ type: 'navigation.pause' });
        return { message: 'Navegação pausada no dispositivo.' };
      },
      'navigation.resume': () => {
        transitionNavigationState({ type: 'navigation.resume' });
        return { message: 'Navegação retomada no dispositivo.' };
      },
      'navigation.get_status': () => ({ navigation: navigationState.navigation, connection: navigationState.connection }),
      'navigation.get_position': () => ({ available: Boolean(location.position) })
      , 'location.get': () => ({ available: Boolean(location.position), position: location.position || null })
      , 'location.share': () => {
        party.setLocationSharing(command.enabled);
        return { enabled: command.enabled, message: command.enabled ? 'Compartilhamento de localização ativado.' : 'Compartilhamento de localização pausado.' };
      }
      , 'message.send': async () => {
        await party.sendDirectMessage(command.target_participant_id, command.text);
        return { message: 'Mensagem enviada.' };
      }
      , 'sos.send': async () => {
        await sendSos();
        return { message: 'SOS processado no dispositivo.' };
      }
    }).then((result) => {
      party.reportNavigationCommandResult(result);
      if (result.success) return setMessage(result.result?.message || 'Comando local executado.');
      if (result.code === 'REMOTE_INTENT_REQUIRED') return setMessage('Intenção recebida. Confirme o destino na busca antes de iniciar a rota.');
      setMessage('Comando rejeitado pelo dispositivo.');
    });
  }, [party.incomingNavigationCommand]);

  useEffect(() => {
    if (!navigationActive) {
      stopNavigationVoice();
      voiceHistoryRef.current = {};
      return;
    }
    voiceHistoryRef.current = speakNavigationGuidance(navigationGuidance, voiceHistoryRef.current);
  }, [navigationActive, navigationGuidance]);

  useEffect(() => {
    if (party.incomingSos?.messageId) {
      const sender = party.incomingSos.participantName || 'Um participante';
      const sosMessage = party.incomingSos.message || 'SOS — preciso de ajuda';
      Alert.alert('SOS RECEBIDO', `${sender}: ${sosMessage}`);
      setMessage(`SOS recebido de ${sender}: ${sosMessage}`);
    }
  }, [party.incomingSos]);

  useEffect(() => {
    if (!party.incomingDirectMessage?.messageId) return;
    const incoming = party.incomingDirectMessage;
    setMessage(`Mensagem de ${incoming.senderName}: ${incoming.text}`);
    Alert.alert(`Mensagem de ${incoming.senderName}`, incoming.text);
  }, [party.incomingDirectMessage]);

  useEffect(() => {
    const invitation = party.incomingRouteShareInvitation;
    if (!invitation?.invitationId) return;
    Alert.alert(
      `Rota de ${invitation.participantName}`,
      `Aceitar o destino ${invitation.destination?.label || 'compartilhado'} e iniciar a navegação?`,
      [
        { text: 'Recusar', style: 'cancel', onPress: () => party.respondRouteShareInvitation(invitation.invitationId, false).catch((error) => setMessage(error.message)) },
        {
          text: 'Aceitar',
          onPress: async () => {
            try {
              const reply = await party.respondRouteShareInvitation(invitation.invitationId, true);
              if (!reply.route) return;
              setLocalRoute(reply.route);
              setPoints({ origin: reply.route.origin, destination: reply.route.destination });
              startNavigation(reply.route);
            } catch (error) {
              setMessage(error.message);
            }
          }
        }
      ]
    );
  }, [party.incomingRouteShareInvitation]);

  useEffect(() => {
    if (party.sosDelivery?.participants?.length) {
      setMessage(`SOS confirmado por ${party.sosDelivery.participants.length} participante(s).`);
    }
  }, [party.sosDelivery]);

  useEffect(() => {
    loadPartyPoints(session.roomId).then((cached) => {
      if (cached) {
        setPoints(cached);
        routeOriginRef.current = cached.origin || null;
      }
    });
  }, [session.roomId]);

  useEffect(() => {
    let active = true;
    Promise.all([loadFavoritePlaces(), loadRecentPlaces(), loadRouteOrigins(), loadRouteHistory()]).then(([savedFavorites, savedRecentPlaces, savedRouteOrigins, savedRouteHistory]) => {
      if (!active) return;
      setFavorites(savedFavorites);
      setRecentPlaces(savedRecentPlaces);
      setRouteOrigins(savedRouteOrigins);
      setRouteHistory(savedRouteHistory);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setLocalRoute(null);
    if (!party.route) return;
    setPoints({ origin: party.route.origin, destination: party.route.destination });
    routeOriginRef.current = party.route.origin || null;
    const coordinates = party.route.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude }));
    if (coordinates.length > 1) mapRef.current?.fitToCoordinates(coordinates, {
      edgePadding: { top: 48, right: 38, bottom: 48, left: 38 },
      animated: true
    });
  }, [party.route]);

  useEffect(() => {
    const requestId = ++poiRequestRef.current;
    if (!activeCategories.length) {
      setPois([]);
      setPoiMessage('Selecione uma categoria.');
      return undefined;
    }
    if (visibleRegion.latitudeDelta > 0.35 || visibleRegion.longitudeDelta > 0.35) {
      setPois([]);
      setPoiMessage('Aproxime o mapa para ver locais próximos.');
      return undefined;
    }
    if (!party.connectivity.capabilities.canLoadPois) {
      setPois([]);
      setPoiMessage(connectivityLabel(party.connectivity.level));
      return undefined;
    }
    const timeoutId = setTimeout(async () => {
      setPoiLoading(true);
      setPoiMessage('Buscando locais nesta área…');
      try {
        const body = await searchPois(visibleRegion, activeCategories);
        if (requestId !== poiRequestRef.current) return;
        const nextPois = body.results || body.pois || [];
        setPois(nextPois);
        setPoiMessage(nextPois.length ? `${nextPois.length} locais encontrados` : 'Nenhum local encontrado nesta área.');
      } catch (error) {
        if (requestId === poiRequestRef.current) setPoiMessage(error.message);
      } finally {
        if (requestId === poiRequestRef.current) setPoiLoading(false);
      }
    }, 700);
    return () => clearTimeout(timeoutId);
  }, [party.connectivity.capabilities.canLoadPois, party.connectivity.level, visibleRegion, categoryKey]);

  useEffect(() => {
    if (!location.position || (party.route && !navigationActive)) return;
    if (navigationActive) {
      const maneuver = navigationGuidance?.precisionMode && navigationGuidance.maneuverPoint
        ? navigationGuidance.maneuverPoint
        : null;
      const center = {
        latitude: maneuver ? (location.position.lat + maneuver.lat) / 2 : location.position.lat,
        longitude: maneuver ? (location.position.lng + maneuver.lng) / 2 : location.position.lng
      };
      const heading = cameraHeading(location.position, headingRef);
      const previous = lastNavigationCameraRef.current;
      const movedEnough = !previous || distanceMeters(
        { lat: previous.latitude, lng: previous.longitude },
        { lat: center.latitude, lng: center.longitude }
      ) >= 10;
      const headingChanged = heading != null && (
        previous?.heading == null || Math.abs(((heading - previous.heading + 540) % 360) - 180) >= 8
      );
      if (!movedEnough && !headingChanged) return;
      lastNavigationCameraRef.current = { ...center, heading };
      try {
        mapRef.current?.animateCamera({ center, zoom: maneuver ? 19 : 17, heading }, { duration: 250 });
      } catch (error) {
        console.warn('[MapParty] navigation camera update failed', error?.message || error);
      }
      return;
    }
    lastNavigationCameraRef.current = null;
    if (didCenterUserRef.current) return;
    didCenterUserRef.current = true;
    mapRef.current?.animateToRegion({
      latitude: location.position.lat,
      longitude: location.position.lng,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04
    }, 650);
  }, [location.position, party.route, navigationActive, navigationGuidance?.precisionMode, navigationGuidance?.maneuverPoint?.lat, navigationGuidance?.maneuverPoint?.lng]);

  useEffect(() => {
    if (!navigationActive || !location.position || !navigationRoute?.destination) return;
    const nextGuidance = buildNavigationGuidance(navigationRoute, location.position);
    if (!nextGuidance) return;
    offRouteReadingsRef.current = nextGuidance.offRoute ? offRouteReadingsRef.current + 1 : 0;
    setNavigationGuidance({
      ...nextGuidance,
      offRoute: nextGuidance.offRoute && offRouteReadingsRef.current >= 2
    });
    const stableOffRoute = nextGuidance.offRoute && offRouteReadingsRef.current >= 2;
    const cooldownElapsed = Date.now() - lastRecalculationAtRef.current >= 15_000;
    if (!nextGuidance.arrived && stableOffRoute && cooldownElapsed && !recalculationRef.current) {
      recalculateRoute({ automatic: true });
    }
    if (nextGuidance.arrived) {
      stopNavigationVoice();
      voiceHistoryRef.current = {};
      setNavigationLocked(false);
      setNavigationGuidance(null);
      setLocalRoute(null);
      setPoints({ origin: null, destination: null });
      setQuery('');
      setResults([]);
      setActiveKind('destination');
      offRouteReadingsRef.current = 0;
      setMessage('Você chegou ao destino.');
      transitionNavigationState({ type: 'navigation.cancel' });
      party.clearPersonalRoute();
    }
  }, [location.position, navigationActive, navigationRoute, party.clearPersonalRoute]);

  useEffect(() => {
    if (!navigationActive) return undefined;
    const tag = `map-party-navigation:${session.roomId}`;
    let active = true;
    activateKeepAwakeAsync(tag).catch(() => undefined).then(() => {
      if (!active) deactivateKeepAwake(tag).catch(() => undefined);
    });
    return () => {
      active = false;
      deactivateKeepAwake(tag).catch(() => undefined);
    };
  }, [navigationActive, session.roomId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returningToApp = (appStateRef.current === 'background' || appStateRef.current === 'inactive')
        && nextState === 'active';
      appStateRef.current = nextState;
      if (!returningToApp || !navigationActive || !location.position) return;
      const position = location.position;
      const maneuver = navigationGuidance?.precisionMode && navigationGuidance.maneuverPoint
        ? navigationGuidance.maneuverPoint
        : null;
      clearTimeout(restoreMapTimerRef.current);
      restoreMapTimerRef.current = setTimeout(() => {
        mapRef.current?.animateCamera({
          center: {
            latitude: maneuver ? (position.lat + maneuver.lat) / 2 : position.lat,
            longitude: maneuver ? (position.lng + maneuver.lng) / 2 : position.lng
          },
          zoom: maneuver ? 19 : 17,
          heading: cameraHeading(position, headingRef)
        }, { duration: 350 });
      }, 250);
    });
    return () => {
      subscription.remove();
      clearTimeout(restoreMapTimerRef.current);
    };
  }, [location.position, navigationActive, navigationGuidance?.precisionMode, navigationGuidance?.maneuverPoint?.lat, navigationGuidance?.maneuverPoint?.lng]);



  async function setPoint(kind, point, { confirmed = false } = {}) {
    if (navigationActive && !confirmed && kind === 'destination' && navigationRoute?.destination) {
      return addTemporaryStop(point);
    }
    if (navigationActive && !confirmed) {
      Alert.alert('Alterar rota?', 'A navegação atual será interrompida para alterar a origem, o destino ou adicionar um ponto.', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Alterar rota',
          style: 'destructive',
          onPress: () => {
            transitionNavigationState({ type: 'navigation.cancel' });
            setNavigationLocked(false);
            setPoint(kind, point, { confirmed: true });
          }
        }
      ]);
      return;
    }
    const latitude = Number(point?.lat);
    const longitude = Number(point?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      setMessage('Este local não possui uma posição válida. Escolha outro resultado.');
      return false;
    }
    point = { ...point, lat: latitude, lng: longitude };
    searchInputRef.current?.blur();
    Keyboard.dismiss();
    if (kind === 'origin') {
      if (!location.position) {
        setMessage('Aguardando uma posição do GPS para definir a origem.');
        return;
      }
      point = {
        lat: location.position.lat,
        lng: location.position.lng,
        label: 'Minha localização atual',
        source: 'geolocation'
      };
    }
    if (!navigationActive && kind === 'destination') {
      setTemporaryStop(null);
      originalNavigationRouteRef.current = null;
    }
    const currentOrigin = location.position ? {
      lat: location.position.lat,
      lng: location.position.lng,
      label: 'Minha localização atual',
      source: 'geolocation'
    } : points.origin;
    const next = {
      ...points,
      ...(kind === 'destination' && currentOrigin ? { origin: currentOrigin } : {}),
      [kind]: point
    };
    setPoints(next);
    routeOriginRef.current = next.origin || routeOriginRef.current;
    savePartyPoints(session.roomId, next);
    setResults([]);
    setQuery('');
    setShowSavedPlaces(false);
    if (point.source === 'search' || point.source === 'saved') {
      saveRecentPlace(point).then(setRecentPlaces);
    }
    setActiveKind(kind === 'origin' ? 'destination' : 'origin');
    try {
      mapRef.current?.animateToRegion({ latitude: point.lat, longitude: point.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 500);
    } catch {
      // A seleção do ponto não pode ser desfeita só porque o mapa ainda está montando.
    }
    if (kind === 'destination' && !next.origin) {
      setMessage('Destino definido. Aguardando a posição atual para calcular a rota.');
      return true;
    }
    if (next.origin && next.destination) {
      setLoading(true);
      setMessage(kind === 'destination' ? 'Destino definido. Calculando rota…' : 'Calculando rota…');
      try {
        const route = await party.publishRoute({
          profile: 'driving',
          origin: next.origin,
          destination: next.destination
        });
        const baseOfflinePackage = createOfflineRoutePackage(route);
        let offlineGraph;
        try { offlineGraph = (await prepareOfflineGraph({ ...route, offlinePackageId: baseOfflinePackage?.id }))?.graph; } catch { offlineGraph = null; }
        let offlinePackage = createOfflineRoutePackage({ ...route, offlineGraph }, { id: baseOfflinePackage?.id });
        let offlineReady = offlinePackage && await saveOfflineRoutePackage(offlinePackage);
        if (!offlineReady && offlineGraph) {
          offlinePackage = createOfflineRoutePackage(route, { id: baseOfflinePackage?.id });
          offlineReady = offlinePackage && await saveOfflineRoutePackage(offlinePackage);
        }
        const cachedRoute = offlineReady ? { ...route, offlinePackageId: offlinePackage.id } : route;
        setLocalRoute(cachedRoute);
        routeOriginRef.current = next.origin;
        saveRouteOrigin(next.origin).then(setRouteOrigins);
        saveRouteHistory(next.origin, next.destination).then(setRouteHistory);
        savePartySnapshot(session.roomId, { participants: party.participants, route: cachedRoute });
        setMessage('Rota pessoal criada. Só será compartilhada com consentimento de todos.');
      } catch (error) {
        setMessage(`Destino definido, mas não foi possível calcular a rota agora: ${error.message}`);
      } finally {
        setLoading(false);
      }
    }
    return true;
  }

  function selectSearchResult(kind, result) {
    const details = searchResultDetails(result, location.position);
    const point = {
      ...result,
      name: details.title,
      address: details.address,
      lat: Number(result?.lat),
      lng: Number(result?.lng),
      label: result?.label || details.address || details.title,
      source: 'search'
    };
    void setPoint(kind, point);
  }

  async function search() {
    if (!party.joined) return setMessage('Aguarde a conexão com a party para buscar lugares.');
    if (!party.connectivity.capabilities.canSearch) return setMessage('A conexão está limitada. A busca será liberada quando a rede melhorar.');
    if (query.trim().length < 3) return setMessage('Digite pelo menos 3 caracteres.');
    if (isFuelSearch(query) && !searchLocation) return setMessage('Aguardando a posição atual do GPS para buscar postos próximos.');
    setLoading(true);
    setMessage('Buscando…');
    try {
      const body = isFuelSearch(query)
        ? await searchNearbyPois(searchLocation, ['fuel'], 5000)
        : await searchPlaces(query, visibleRegion, searchLocation);
      setResults(body.results || []);
      setMessage(body.results?.length ? locationWarning(body.results) : 'Nenhum lugar encontrado.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitAssistant(draft = assistantDraft) {
    const text = draft.trim();
    if (!text) return;
    setAssistantDraft('');
    const localIntent = parseAssistantIntent(text, { options: results });
    const deterministicIntent = localIntent.type !== 'unknown' && localIntent.type !== 'empty';
    if (!deterministicIntent && party.connectivity.capabilities.canUseConversationalAi) {
      try {
        await submitAssistantToCloud(text);
        return;
      } catch {
        // A provider timeout, missing key or transient outage must keep the
        // short local command path available, especially on 3G/2G recovery.
      }
    }
    const intent = localIntent;
    if (intent.type === 'search_place') {
      if (!party.connectivity.capabilities.canSearch) {
        const reply = 'A conexão está limitada. Posso continuar com a rota salva e comandos básicos.';
        setAssistantReply(reply);
        await speakAssistantText(reply);
        return;
      }
      setAssistantReply(assistantReplyForIntent(intent));
      await speakAssistantText(assistantReplyForIntent(intent));
      setQuery(intent.query);
      setLoading(true);
      try {
        const isNearbyFuel = isFuelSearch(intent.query) && searchLocation;
        const body = isNearbyFuel
          ? await searchNearbyPois(searchLocation, ['fuel'], 5000)
          : await searchPlaces(intent.query, visibleRegion, searchLocation);
        const nextResults = body.results || [];
        setResults(nextResults);
        setShowSavedPlaces(true);
        const warning = locationWarning(nextResults);
        const reply = nextResults.length
          ? `${warning ? `${warning} ` : ''}Encontrei ${nextResults.length} opções. Diga primeira, segunda ou terceira.`
          : 'Não encontrei esse local perto de você.';
        setAssistantReply(reply);
        await speakAssistantText(reply);
      } catch (error) {
        setAssistantReply(error.message);
        await speakAssistantText(error.message);
      } finally {
        setLoading(false);
      }
      return;
    }
    if (intent.type === 'choose_place' && intent.option) {
      const details = searchResultDetails(intent.option, location.position);
      const point = { ...intent.option, name: details.title, address: details.address, label: intent.option.label, source: 'search' };
      const isTemporary = navigationActive && Boolean(navigationRoute?.destination);
      await setPoint('destination', point);
      const reply = isTemporary
        ? `Adicionei ${point.name || 'esse local'} como parada temporária. A rota original continua guardada. Diga retomar a rota quando quiser continuar.`
        : `${assistantReplyForIntent({ ...intent, option: point })} O destino foi definido. Diga iniciar quando quiser.`;
      setAssistantReply(reply);
      await speakAssistantText(reply);
      return;
    }
    if (intent.type === 'navigation.cancel') stopNavigation();
    if (intent.type === 'navigation.pause') transitionNavigationState({ type: 'navigation.pause' });
    if (intent.type === 'navigation.resume') {
      if (temporaryStop && originalNavigationRouteRef.current) await resumeOriginalNavigation();
      else if (navigationState.navigation === NAVIGATION_STATE.PAUSED) transitionNavigationState({ type: 'navigation.resume' });
      else if (navigationRoute) startNavigation();
      else setMessage('NÃ£o hÃ¡ uma rota anterior para retomar.');
    }
    if (intent.type === 'navigation.start') startNavigation();
    const reply = assistantReplyForIntent(intent);
    setAssistantReply(reply);
    await speakAssistantText(reply);
  }

  async function submitAssistantToCloud(text, depth = 0) {
    if (depth > 3) throw new Error('Limite de conversa atingido.');
    if (text) assistantHistoryRef.current.push({ role: 'user', text });
    const response = await askAssistant(text, assistantHistoryRef.current.slice(-10), {
      location: location.position,
      options: results
    });
    assistantHistoryRef.current.push({ role: 'model', parts: response.parts || [{ text: response.text || '' }] });
    if (!response.toolCall) {
      const reply = response.text || 'Estou pronto para ajudar. O que você gostaria de fazer?';
      setAssistantReply(reply);
      await speakAssistantText(reply);
      return;
    }
    const { name, args = {} } = response.toolCall;
    let result;
    if (name === 'search_place') {
      if (!party.connectivity.capabilities.canSearch) throw new Error('Busca indisponível nesta rede.');
      const assistantQuery = String(args.query || '');
      const body = isFuelSearch(assistantQuery) && searchLocation
        ? await searchNearbyPois(searchLocation, ['fuel'], 5000)
        : await searchPlaces(assistantQuery, visibleRegion, searchLocation);
      const nextResults = body.results || [];
      setQuery(String(args.query || ''));
      setResults(nextResults);
      setShowSavedPlaces(true);
      result = { results: nextResults.slice(0, 3) };
    } else if (name === 'choose_place' || name === 'navigation_set_destination') {
      const index = Number.isInteger(Number(args.index)) ? Number(args.index) : 0;
      const option = results[index];
      if (!option) result = { ok: false, message: 'Opção não encontrada.' };
      else {
        const details = searchResultDetails(option, location.position);
        const point = { ...option, name: details.title, address: details.address, label: option.label, source: 'search' };
        await setPoint('destination', point);
        result = { ok: true, destination: { id: point.id, name: point.name, lat: point.lat, lng: point.lng } };
      }
    } else if (name === 'navigation_start') {
      startNavigation(); result = { ok: true, state: 'navigating' };
    } else if (name === 'navigation_pause') {
      transitionNavigationState({ type: 'navigation.pause' }); result = { ok: true, state: 'paused' };
    } else if (name === 'navigation_resume') {
      if (temporaryStop && originalNavigationRouteRef.current) await resumeOriginalNavigation();
      else transitionNavigationState({ type: 'navigation.resume' });
      result = { ok: true, state: 'navigating', resumedOriginalRoute: Boolean(temporaryStop) };
    } else if (name === 'navigation_cancel') {
      stopNavigation(); result = { ok: true, state: 'idle' };
    } else if (name === 'navigation_get_status') {
      result = { ok: true, state: navigationState.navigation, destination: navigationRoute?.destination || null };
    } else {
      result = { ok: false, message: 'Ferramenta não disponível neste dispositivo.' };
    }
    assistantHistoryRef.current.push({ role: 'tool', name, result });
    return submitAssistantToCloud('', depth + 1);
  }

  function useMyLocation() {
    if (!location.position) return setMessage('Aguardando uma posição do GPS.');
    setPoint(activeKind, { lat: location.position.lat, lng: location.position.lng, label: 'Minha localização', source: 'geolocation' });
  }

  function centerOnMyLocation() {
    if (!location.position) return setMessage('Aguardando uma posição do GPS.');
    // Keep the camera centered on the same projected coordinate rendered by
    // the eagle while navigating, not on the raw GPS fix.
    const center = ownMarkerLocation || location.position;
    const camera = {
      center: { latitude: center.lat, longitude: center.lng },
      zoom: 17,
      ...(navigationActive ? { heading: cameraHeading(location.position, headingRef) } : {})
    };
    mapRef.current?.animateCamera(camera, { duration: 500 });
  }

  function startNavigation(routeOverride = null) {
    searchInputRef.current?.blur();
    Keyboard.dismiss();
    const routeToStart = routeOverride || navigationRoute;
    if (!routeToStart) return setMessage('Defina origem e destino primeiro.');
    if (!location.position) return setMessage('Aguardando uma posição do GPS para iniciar.');
    offRouteReadingsRef.current = 0;
    if (!temporaryStop) originalNavigationRouteRef.current = routeToStart;
    routeOriginRef.current = routeToStart.origin || routeOriginRef.current;
    setNavigationLocked(false);
    setNavigationGuidance(buildNavigationGuidance(routeToStart, location.position));
    transitionNavigationState({ type: 'navigation.start' });
    setMessage('Navegação iniciada. Siga a linha azul.');
    mapRef.current?.animateToRegion({ latitude: location.position.lat, longitude: location.position.lng, latitudeDelta: 0.018, longitudeDelta: 0.018 }, 500);
  }

  async function addTemporaryStop(point) {
    const latitude = Number(point?.lat);
    const longitude = Number(point?.lng);
    const original = originalNavigationRouteRef.current || navigationRoute;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !original?.destination || !location.position) {
      setMessage('Aguarde o GPS para adicionar uma parada temporÃ¡ria.');
      return false;
    }
    const stop = { ...point, lat: latitude, lng: longitude };
    setLoading(true);
    setMessage(`Calculando parada em ${stop.name || stop.label || 'novo local'}â€¦`);
    try {
      const stopRoute = await calculateRoute(location.position, stop);
      party.clearPersonalRoute();
      setTemporaryStop(stop);
      setLocalRoute(stopRoute);
      setPoints({ origin: location.position, destination: stop });
      savePartyPoints(session.roomId, { origin: location.position, destination: stop });
      setMessage('Parada temporÃ¡ria definida. A rota original permanece guardada.');
      return true;
    } catch (error) {
      setMessage(`NÃ£o foi possÃ­vel calcular a parada: ${error.message}`);
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function resumeOriginalNavigation() {
    const original = originalNavigationRouteRef.current;
    if (!original?.destination) {
      if (navigationRoute) return startNavigation(navigationRoute);
      setMessage('NÃ£o hÃ¡ uma rota anterior para retomar.');
      return;
    }
    if (!location.position) return setMessage('Aguardando uma posiÃ§Ã£o do GPS para retomar a rota.');
    setLoading(true);
    setMessage('Retomando a rota originalâ€¦');
    try {
      const route = await calculateRoute(location.position, original.destination);
      party.clearPersonalRoute();
      setTemporaryStop(null);
      setLocalRoute(route);
      setPoints({ origin: location.position, destination: original.destination });
      setNavigationGuidance(buildNavigationGuidance(route, location.position));
      transitionNavigationState({ type: 'navigation.start' });
      setMessage('Rota original retomada.');
    } catch (error) {
      setMessage(`NÃ£o foi possÃ­vel retomar a rota original: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  function stopNavigation() {
    stopNavigationVoice();
    voiceHistoryRef.current = {};
    transitionNavigationState({ type: 'navigation.cancel' });
    setNavigationLocked(false);
    setNavigationGuidance(null);
    setQuery('');
    setResults([]);
    setActiveKind('destination');
    offRouteReadingsRef.current = 0;
    party.setVisibility(false);
    party.clearPersonalRoute();
    setMessage('Navegação e compartilhamento pausados.');
  }

  function toggleLocationSharing() {
    if (locationPermissionDenied) {
      setMessage('Ative a localizacao nas configuracoes do app e tente novamente.');
      Linking.openSettings().catch(() => undefined);
      return;
    }
    const nextEnabled = !party.locationSharingEnabled;
    party.setVisibility(nextEnabled);
    if (nextEnabled && location.position) party.sendLocation(location.position);
    setMessage(nextEnabled ? 'Compartilhamento de localização retomado.' : 'Compartilhamento de localização pausado. O GPS continua disponível neste aparelho.');
  }

  function toggleRouteSharingConsent() {
    const nextEnabled = !party.routeSharingConsent;
    if (nextEnabled) {
      return Alert.alert(
        'Compartilhar rota?',
        'Sua rota só será exibida para os demais participantes quando todos autorizarem o compartilhamento.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Concordar',
            onPress: async () => {
              try {
                const reply = await party.setRouteSharingConsent(true);
                if (!reply.ready) return setMessage('Consentimento registrado; aguardando os demais participantes.');
                if (!points.origin || !points.destination) return setMessage('Compartilhamento autorizado. Defina uma rota para compartilhá-la.');
                const sharedRoute = await party.publishRoute({
                  profile: 'driving',
                  origin: points.origin,
                  destination: points.destination
                }, 'shared');
                setLocalRoute(sharedRoute);
                setMessage('Rota compartilhada após consentimento de todos.');
              } catch (error) {
                setMessage(error.message);
              }
            }
          }
        ]
      );
    }
    party.setRouteSharingConsent(false)
      .then(() => setMessage('Compartilhamento de rota desativado; sua rota permanece pessoal.'))
      .catch((error) => setMessage(error.message));
  }

  function openParticipantMenu(participant) {
    const authorized = authorizedRouteParticipantIds.has(participant.id);
    Alert.alert(participant.name, 'Escolha uma ação para este participante.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Enviar mensagem', onPress: () => setDirectRecipient(participant) },
      {
        text: authorized ? 'Bloquear rota deste usuário' : 'Autorizar rota deste usuário',
        onPress: () => party.setRoutePermission(participant.id, !authorized)
          .then(() => {
            setAuthorizedRouteParticipantIds((current) => {
              const next = new Set(current);
              if (authorized) next.delete(participant.id); else next.add(participant.id);
              return next;
            });
            setMessage(authorized ? `Rota de ${participant.name} bloqueada.` : `Rota de ${participant.name} autorizada neste aparelho.`);
          })
          .catch((error) => setMessage(error.message))
      }
    ]);
  }

  async function recalculateRoute({ automatic = false } = {}) {
    if (recalculationRef.current) return;
    if (party.joined && !party.connected && location.position && navigationRoute?.destination) {
      const fixedOrigin = routeOriginRef.current || points.origin || navigationRoute.origin;
      const destination = points.destination || navigationRoute.destination;
      const offlinePackage = await loadOfflineRoutePackage(navigationRoute.offlinePackageId);
      const offlineResult = calculatePackagedOfflineRoute(offlinePackage, location.position, destination);
      if (offlineResult.ok) {
        const cachedRoute = { ...offlineResult.route, origin: fixedOrigin, destination, offlinePackageId: offlinePackage.id };
        setLocalRoute(cachedRoute);
        savePartySnapshot(session.roomId, { participants: party.participants, route: cachedRoute });
        offRouteReadingsRef.current = 0;
        setNavigationGuidance(buildNavigationGuidance(cachedRoute, location.position));
        setMessage('Rota recalculada localmente, sem conexao.');
      } else {
        setMessage('Pacote offline indisponivel para este desvio.');
      }
      return;
    }
    if (!party.joined || !party.connected) return setMessage('Sem conexão: mantendo a rota local e a orientação pelo GPS.');
    if (!location.position || !navigationRoute?.destination) return setMessage('Localização ou destino indisponível para recálculo.');
    recalculationRef.current = true;
    lastRecalculationAtRef.current = Date.now();
    const origin = {
      lat: location.position.lat,
      lng: location.position.lng,
      label: 'Minha localização atual',
      source: 'geolocation'
    };
      const fixedOrigin = routeOriginRef.current || points.origin || navigationRoute.origin;
    const destination = points.destination || navigationRoute.destination;
    if (!fixedOrigin || !destination) {
      recalculationRef.current = false;
      return setMessage('Origem ou destino da rota original indisponível.');
    }
    transitionNavigationState({ type: 'navigation.recalculate' });
    setRecalculating(true);
    setMessage(automatic ? 'Você saiu da rota. Recalculando automaticamente…' : 'Recalculando rota…');
    try {
      const calculatedRoute = await party.publishRoute({
        profile: 'driving',
        origin,
        destination,
        routeOrigin: fixedOrigin
      }, 'personal');
      const route = calculatedRoute;
      setLocalRoute(route);
      routeOriginRef.current = fixedOrigin;
      savePartySnapshot(session.roomId, { participants: party.participants, route });
      setPoints({ origin: fixedOrigin, destination });
      savePartyPoints(session.roomId, { origin: fixedOrigin, destination });
      offRouteReadingsRef.current = 0;
      setNavigationGuidance(buildNavigationGuidance(route, location.position));
      setMessage(automatic ? 'Rota alternativa aplicada neste dispositivo.' : 'Rota recalculada neste dispositivo.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      transitionNavigationState({ type: 'navigation.recalculated' });
      recalculationRef.current = false;
      setRecalculating(false);
    }
  }

  async function shareParty() {
    const roomLine = `Sala: ${session.roomId}`;
    const message = `Estou no mapa AGUIA como ${session.name}.\n${roomLine}\nAcesse: ${SERVER_URL}`;
    await Share.share({ message });
  }

  function openRouteSharePicker() {
    if (!navigationRoute) return setMessage('Defina uma rota antes de compartilhá-la.');
    setRouteShareSelection(new Set());
    setRouteSharePickerVisible(true);
  }

  function toggleRouteShareParticipant(participantId) {
    setRouteShareSelection((current) => {
      const next = new Set(current);
      if (next.has(participantId)) next.delete(participantId); else next.add(participantId);
      return next;
    });
  }

  async function confirmRouteShare() {
    try {
      const reply = await party.requestRouteShare([...routeShareSelection]);
      setRouteSharePickerVisible(false);
      setRouteShareSelection(new Set());
      setMessage(`Convite de rota enviado para ${reply.invited?.length || 0} participante(s).`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function sendSos() {
    if (!location.position) return setMessage('Aguardando GPS para enviar SOS.');
    if (sosSending) return;
    setSosSending(true);
    setMessage('Preparando SOS criptografado...');
    try {
      const publicKey = await fetchEmergencyPublicKey();
      const packet = await createSealedEmergencyPacket(publicKey, location.position, {
        type: 'sos',
        battery: 0,
        sequence: Date.now() % 0xffffffff
      });
      const result = await party.sendEmergencyPacket(packet, { message: 'SOS — preciso de ajuda' });
      setMessage(result?.relayed === false
        ? 'SOS criptografado enviado localmente; aguardando confirmacao.'
        : 'SOS criptografado enviado; aguardando confirmacao local.');
    } catch (error) {
      setMessage(error.message || 'Nao foi possivel preparar o SOS.');
    } finally {
      setSosSending(false);
    }
  }

  async function sendDirectMessage() {
    const text = directDraft.trim();
    if (!directRecipient || !text || directSending) return;
    setDirectSending(true);
    try {
      await party.sendDirectMessage(directRecipient.id, text);
      setDirectDraft('');
      setMessage(`Mensagem enviada para ${directRecipient.name}.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setDirectSending(false);
    }
  }

  function selectSavedPlace(place) {
    Alert.alert(
      `Usar como ${activeKind === 'origin' ? 'origem' : 'destino'}?`,
      place.name || place.label || 'Endereço selecionado',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: () => setPoint(activeKind, { ...place, source: 'saved' }) }
      ]
    );
  }

  function toggleCategory(category) {
    setActiveCategories((current) => current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category]);
  }

  function usePoi(kind, poi) {
    setSelectedPoi(null);
    setPoint(kind, {
      id: poi.id,
      name: poi.name,
      address: poi.address,
      category: poi.category,
      lat: poi.lat,
      lng: poi.lng,
      label: poi.address ? `${poi.name}, ${poi.address}` : poi.name,
      source: 'search'
    });
  }

  async function toggleFavorite(place) {
    const storageId = placeStorageId(place);
    const alreadyFavorite = favorites.some((item) => item.storageId === storageId);
    const next = alreadyFavorite
      ? await removeFavoritePlace(storageId)
      : await saveFavoritePlace(place);
    setFavorites(next);
    setMessage(alreadyFavorite ? 'Local removido dos favoritos.' : 'Local adicionado aos favoritos.');
  }

  function focusCluster(cluster) {
    setSelectedPoi(null);
    mapRef.current?.fitToCoordinates(
      cluster.pois.map((poi) => ({ latitude: poi.lat, longitude: poi.lng })),
      { edgePadding: { top: 90, right: 70, bottom: 90, left: 70 }, animated: true }
    );
  }

  const routeCoordinates = useMemo(() => displayedRoute?.geometry?.coordinates?.map(([longitude, latitude]) => ({ latitude, longitude })) || [], [displayedRoute]);
  const clusteredPois = useMemo(() => clusterPois(pois, visibleRegion, {
    width: viewport.width,
    height: Math.max(1, viewport.height * 0.6)
  }), [pois, visibleRegion, viewport.height, viewport.width]);
  const favoriteIds = useMemo(() => new Set(favorites.map((place) => place.storageId)), [favorites]);
  const recentWithoutFavorites = useMemo(() => recentPlaces.filter((place) => !favoriteIds.has(place.storageId)), [favoriteIds, recentPlaces]);
  const progressPercent = Math.round((navigationGuidance?.progress || 0) * 100);
  const connection = party.offline
    ? { label: 'OFFLINE', message: 'Sem conexão. Exibindo os últimos dados salvos e tentando reconectar.', color: '#f59e0b' }
    : CONNECTION_PRESENTATION[party.connectionStatus] || CONNECTION_PRESENTATION.connecting;
  const connectivityMessage = party.connectivity.level === CONNECTIVITY_LEVEL.NORMAL || party.connectivity.level === CONNECTIVITY_LEVEL.RICH
    ? ''
    : connectivityLabel(party.connectivity.level);

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text maxFontSizeMultiplier={1.1} style={styles.clientCode}>AGUIA</Text>
        <Text maxFontSizeMultiplier={1.1} style={styles.participantCount}>{party.participants.length} participante{party.participants.length === 1 ? '' : 's'}</Text>
        <Text style={styles.title}>Map Party <Text style={styles.titleDot}>{'\u2022'}</Text> <Text style={[styles.liveText, { color: connection.color }]}>{connection.label}</Text></Text>
        <Text numberOfLines={1} style={styles.room}>{party.participants.length} participante{party.participants.length === 1 ? '' : 's'} {'\u00b7'} {session.roomId}</Text>
      </View>
      <View accessibilityLabel={`Estado da conexão: ${connection.label.toLocaleLowerCase('pt-BR')}`} style={[styles.statusDot, { backgroundColor: connection.color }]} />
       <View style={styles.headerShareColumn}>
         <Pressable accessibilityRole="button" accessibilityLabel="Compartilhar rota" disabled={navigationLocked} onPress={openRouteSharePicker} style={[styles.headerButton, navigationLocked && styles.disabled]}><Text numberOfLines={1} adjustsFontSizeToFit style={styles.headerButtonText}>Compartilhar rota</Text></Pressable>
       </View>
      <Pressable accessibilityRole="button" accessibilityLabel={speechAssistant.listening ? 'Parar de ouvir' : 'Falar com o assistente'} onPress={speechAssistant.listening ? speechAssistant.stop : speechAssistant.start} style={[styles.headerMicButton, speechAssistant.listening && styles.assistantMicButtonActive]}><Text style={styles.assistantMicText}>{speechAssistant.listening ? '■' : '🎙'}</Text></Pressable>
      <Pressable disabled={navigationLocked} onPress={onLeave} style={[styles.leaveButton, navigationLocked && styles.disabled]}><Text style={styles.leaveText}>Sair</Text></Pressable>
    </View>
    {!!(connection.message || connectivityMessage) && <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.connectionBanner}>
      <View style={[styles.connectionBannerDot, { backgroundColor: connection.color }]} />
      <Text style={styles.connectionBannerText}>{connectivityMessage || connection.message}</Text>
    </View>}

     <View style={styles.mapArea}>
       <MapView
        ref={mapRef}
        style={styles.map}
         initialRegion={INITIAL_REGION}
         mapType={Platform.OS === 'android' ? 'none' : undefined}
         minZoomLevel={2}
         maxZoomLevel={19}
         rotateEnabled
        pitchEnabled={false}
        showsCompass={false}
        showsUserLocation={false}
        showsPointsOfInterest={false}
        onRegionChangeComplete={setVisibleRegion}
        onPress={(event) => {
          if (navigationLocked) return;
          const { latitude: lat, longitude: lng } = event.nativeEvent.coordinate;
          const now = Date.now();
          const previousTap = mapTapRef.current;
          const isDoubleTap = previousTap
            && now - previousTap.at <= 450
            && distanceBetween(previousTap, { lat, lng }) <= 45;
          if (!isDoubleTap) {
            mapTapRef.current = { at: now, lat, lng };
            setMessage('Toque duas vezes rapidamente no mapa para adicionar um ponto.');
            return;
          }
          mapTapRef.current = null;
          setSelectedPoi(null);
          setShowSavedPlaces(false);
          setPoint(activeKind, { lat, lng, label: 'Ponto selecionado no mapa', source: 'map' });
        }}
      >
        {Platform.OS === 'android' && <UrlTile key={mapStyle} urlTemplate={MAP_TILE_TEMPLATES[mapStyle]} maximumZ={19} minimumZ={1} zIndex={-1} />}
        {routeCoordinates.length > 1 && <Polyline coordinates={routeCoordinates} strokeColor="#ffffff" strokeWidth={9} />}
        {routeCoordinates.length > 1 && <Polyline coordinates={routeCoordinates} strokeColor="#2563eb" strokeWidth={6} />}

        {clusteredPois.map((marker) => {
          if (marker.type === 'cluster') return <Marker
            key={marker.id}
            coordinate={marker.coordinate}
            tracksViewChanges={false}
            accessibilityRole="button"
            accessibilityLabel={clusterAccessibilityLabel(marker)}
            stopPropagation
            onPress={() => focusCluster(marker)}
          >
            <View style={styles.clusterMarker}><Text style={styles.clusterMarkerText}>{marker.count}</Text></View>
          </Marker>;
          const poi = marker.poi;
          const category = POI_CATEGORIES.find((item) => item.id === poi.category) || POI_CATEGORIES[0];
          return <Marker
            key={marker.id}
            coordinate={{ latitude: poi.lat, longitude: poi.lng }}
            tracksViewChanges={false}
            title={poi.name}
            description={poi.address || category.label}
            accessibilityRole="button"
            accessibilityLabel={`${poi.name}, ${poi.address || category.label}`}
            accessibilityHint="Toque para abrir os detalhes do local"
            stopPropagation
            onPress={() => setSelectedPoi(poi)}
          >
            <View style={[styles.poiMarker, { backgroundColor: category.color }]}><Text style={styles.poiMarkerIcon}>{category.icon}</Text></View>
          </Marker>;
        })}

        {points.origin && (!ownLocation || distanceMeters(points.origin, ownLocation) > 30) && <Marker coordinate={{ latitude: points.origin.lat, longitude: points.origin.lng }} tracksViewChanges={false} anchor={{ x: 0.5, y: 1 }} title="Origem" description={points.origin.label}>
          <MapPin color="#16a34a" label="A" />
        </Marker>}
        {points.destination && <Marker coordinate={{ latitude: points.destination.lat, longitude: points.destination.lng }} tracksViewChanges={false} anchor={{ x: 0.5, y: 1 }} title="Destino" description={points.destination.label}>
          <MapPin color="#dc2626" label="B" />
        </Marker>}
        {(() => {
          if (!ownLocation) return null;
          return <Marker
            key="self-location-eagle-view"
            coordinate={markerCoordinate(Platform.OS === 'ios' ? ownLocation : ownMarkerLocation, ownParticipantId, party.participants, true)}
            title={session.name}
            accessibilityLabel={`${session.name}, sua localização`}
            // The geographic point is the bottom-center of the eagle image.
            // Keep the name label out of the marker frame so MapKit and Google
            // Maps calculate the same anchor on both native platforms.
            anchor={EAGLE_MARKER_ANCHOR}
            centerOffset={EAGLE_MARKER_CENTER_OFFSET}
            // Keep the eagle billboarded to the screen. With `flat` enabled
            // Android rotates the bitmap together with the map camera, which
            // makes the head point sideways/down whenever the map turns.
            flat={false}
            rotation={markerRotation(ownLocation, navigationActive, headingRef)}
             tracksViewChanges
          >
            <EagleMarker name={session.name} />
          </Marker>;
        })()}
        {party.participants.filter((item) => item.location && item.id !== ownParticipantId && item.name?.trim().toLocaleLowerCase('pt-BR') !== ownParticipantName).map((item) => {
          const statusText = participantStatusText(participantStatuses.get(item.id));
          return <Marker
            key={item.id}
            coordinate={markerCoordinate(Platform.OS === 'ios' ? item.location : visualRoutePosition(displayedRoute, item.location), item.id, party.participants, Boolean(displayedRoute))}
            tracksViewChanges
            anchor={EAGLE_MARKER_ANCHOR}
            centerOffset={EAGLE_MARKER_CENTER_OFFSET}
            title={item.name}
            description={`${statusText}${item.location.estimated ? ' · posição estimada' : ''}`}
            accessibilityLabel={`${item.name}, ${statusText}${item.location.estimated ? ', posição estimada' : ''}`}
          >
            <EagleMarker name={item.name} estimated={item.location.estimated} labelBelow />
          </Marker>;
        })}
      </MapView>
      <View
       pointerEvents="box-only"
       {...speedBubbleResponder.panHandlers}
         accessibilityLabel={`Velocidade atual ${formatSpeedValue(location.position)} quilômetros por hora. Segure e arraste para reposicionar.`}
         style={[styles.speedBubble, { left: speedBubbleCustomizedRef.current ? speedBubblePosition.left : defaultSpeedBubbleLeft, top: speedBubblePosition.top }]}
       >
         <Text style={styles.speedBubbleValue}>{formatSpeedValue(location.position)}</Text>
         <Text style={styles.speedBubbleUnit}>km/h</Text>
       </View>
      {navigationActive && <View style={[styles.navigationCard, navigationGuidance?.offRoute && styles.navigationCardOffRoute]}>
        <View style={styles.navigationCardText}>
          {!!party.personalRoute && <Text accessibilityLabel="Navegação usando rota pessoal" style={styles.personalRouteBadge}>ROTA PESSOAL</Text>}
          <Text style={styles.navigationEyebrow}>{navigationGuidance?.precisionMode ? 'DETALHE DA MANOBRA' : navigationGuidance?.hasSteps && Number.isFinite(navigationGuidance.instructionDistance) ? `${navigationGuidance.instructionDistance < 12 ? 'AGORA' : `EM ${formatDistance(navigationGuidance.instructionDistance).toUpperCase()}`}` : 'NAVEGANDO'}</Text>
          <Text accessibilityLiveRegion="polite" numberOfLines={2} style={styles.navigationInstruction}>{navigationGuidance?.instruction || 'Calculando próxima orientação…'}</Text>
          <Text style={styles.navigationEta}>{navigationGuidance ? `${formatDistance(navigationGuidance.remainingMeters)} restantes · aprox. ${formatDuration(navigationGuidance.remainingSeconds)}` : 'Calculando progresso e chegada…'}</Text>
          <View accessibilityRole="progressbar" accessibilityLabel="Progresso da rota" accessibilityValue={{ min: 0, max: 100, now: progressPercent, text: `${progressPercent}% concluído` }} style={styles.navigationProgressTrack}>
            <View style={[styles.navigationProgressFill, { width: `${progressPercent}%` }]} />
          </View>
        </View>
        <View style={styles.navigationActions}>
          {navigationGuidance?.offRoute && <>
            <Text style={styles.offRouteText}>{Number.isFinite(navigationGuidance.offRouteDistance) ? `${formatDistance(navigationGuidance.offRouteDistance)} fora da rota` : 'Fora da rota'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Recalcular rota a partir da localização atual" accessibilityState={{ disabled: navigationLocked || recalculating || !party.joined || !party.connected, busy: recalculating }} disabled={navigationLocked || recalculating || !party.joined || !party.connected} onPress={recalculateRoute} style={[styles.recalculateButton, (navigationLocked || recalculating || !party.joined || !party.connected) && styles.disabled]}>
              <Text style={styles.recalculateButtonText}>{recalculating ? 'Recalculando…' : 'Recalcular'}</Text>
            </Pressable>
          </>}
          <Pressable accessibilityRole="button" accessibilityLabel="Centralizar posicao atual" onPress={centerOnMyLocation} style={styles.centerNavigation}><Text style={styles.centerNavigationText}>Centralizar</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Parar navegação" accessibilityState={{ disabled: navigationLocked }} disabled={navigationLocked} onPress={stopNavigation} style={[styles.stopNavigation, navigationLocked && styles.disabled]}><Text style={styles.stopNavigationText}>Parar</Text></Pressable>
        </View>
        <View style={styles.lockedActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Enviar SOS criptografado" accessibilityState={{ disabled: sosSending, busy: sosSending }} disabled={sosSending} onPress={sendSos} style={[styles.sosButton, sosSending && styles.disabled]}>
            <Text style={styles.sosButtonText}>{sosSending ? '...' : 'SOS'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={navigationLocked ? 'Desbloquear tela de navegação' : 'Bloquear tela de navegação'} onPress={() => setNavigationLocked((locked) => !locked)} style={styles.lockButton}>
            <View style={[styles.lockIcon, navigationLocked && styles.lockIconClosed]}>
              <View style={styles.lockBody} />
              <View style={[styles.lockShackle, navigationLocked && styles.lockShackleClosed]} />
            </View>
          </Pressable>
        </View>
      </View>}
      <View pointerEvents={navigationActive ? 'none' : 'box-none'} style={[styles.mapControls, navigationActive && styles.navigationMapControls]}>
        <View style={styles.floatingSearch}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            ref={searchInputRef}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setShowSavedPlaces(true)}
            onSubmitEditing={search}
            blurOnSubmit
            placeholder={`Buscar ${activeKind === 'origin' ? 'origem' : 'destino'}`}
            accessibilityLabel="Buscar lugar"
            accessibilityHint="Digite ao menos três caracteres e toque em Buscar"
            returnKeyType="search"
            style={styles.floatingInput}
          />
          {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Limpar busca" onPress={() => { setQuery(''); setResults([]); setShowSavedPlaces(true); }} style={styles.clearSearchButton}><Text style={styles.clearSearch}>{'\u00d7'}</Text></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="Buscar lugares" accessibilityState={{ disabled: loading || !party.joined, busy: loading }} disabled={loading || !party.joined} onPress={search} style={(loading || !party.joined) && styles.disabled}><Text style={styles.floatingSearchButton}>{loading ? '…' : 'Buscar'}</Text></Pressable>
        </View>
        <View style={styles.assistantRow}>
          <Text style={styles.assistantIcon}>◉</Text>
          <TextInput
            value={assistantDraft}
            onChangeText={setAssistantDraft}
            onSubmitEditing={submitAssistant}
            placeholder={speechAssistant.listening ? 'Ouvindo…' : 'Fale ou digite: me leve para um hotel'}
            accessibilityLabel="Assistente de navegação"
            returnKeyType="send"
            style={styles.assistantInput}
          />
          <Pressable accessibilityRole="button" accessibilityLabel={speechAssistant.listening ? 'Parar de ouvir' : 'Falar com o assistente'} onPress={speechAssistant.listening ? speechAssistant.stop : speechAssistant.start} style={[styles.assistantMicButton, speechAssistant.listening && styles.assistantMicButtonActive]}>
            <Text style={styles.assistantMicText}>{speechAssistant.listening ? '■' : '🎙'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Enviar para o assistente" disabled={!assistantDraft.trim()} onPress={submitAssistant} style={[styles.assistantButton, !assistantDraft.trim() && styles.disabled]}>
            <Text style={styles.assistantButtonText}>Enviar</Text>
          </Pressable>
        </View>
        {!!(assistantReply || speechAssistant.error) && <Text accessibilityLiveRegion="polite" style={styles.assistantReply}>{speechAssistant.error || assistantReply}</Text>}
        <View accessibilityRole="radiogroup" accessibilityLabel="Estilo do mapa" style={styles.mapStyleOptions}>
          {['simple', 'detailed'].map((style) => {
            const selected = mapStyle === style;
            return <Pressable
              key={style}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={style === 'simple' ? 'Mapa simples, sem destaque de avenidas' : 'Mapa detalhado'}
              onPress={() => setMapStyle(style)}
              style={[styles.mapStyleButton, selected && styles.mapStyleButtonActive]}
            >
              <Text style={[styles.mapStyleText, selected && styles.mapStyleTextActive]}>{style === 'simple' ? 'Simples' : 'Detalhado'}</Text>
            </Pressable>;
          })}
        </View>
        {query.trim().length > 0 && results.length > 0 && <ScrollView style={styles.floatingResults} keyboardShouldPersistTaps="always" nestedScrollEnabled>
          <Text accessibilityLiveRegion="polite" style={styles.resultsCount}>{results.length} resultado{results.length === 1 ? '' : 's'}</Text>
          {results.map((result) => {
            const details = searchResultDetails(result, location.position);
            const point = { ...result, name: details.title, address: details.address, lat: result.lat, lng: result.lng, label: result.label, source: 'search' };
            const favorite = favoriteIds.has(placeStorageId(point));
            return <View key={result.id} style={styles.resultCard}>
              <Text accessibilityRole="header" numberOfLines={1} style={styles.resultTitle}>{details.title}</Text>
              <Text numberOfLines={2} style={styles.resultAddress}>{details.address}</Text>
              <Text style={styles.resultDistance}>{details.distance}</Text>
              <View style={styles.resultActions}>
                <Pressable accessibilityRole="button" accessibilityLabel={`${favorite ? 'Remover' : 'Adicionar'} ${details.title} ${favorite ? 'dos' : 'aos'} favoritos`} accessibilityState={{ selected: favorite }} onPress={() => toggleFavorite(point)} style={({ pressed }) => [styles.favoriteButton, favorite && styles.favoriteButtonActive, pressed && styles.pressed]}>
                  <Text style={[styles.favoriteButtonText, favorite && styles.favoriteButtonTextActive]}>{favorite ? '\u2605' : '\u2606'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${details.title} como origem`} hitSlop={6} onPress={() => selectSearchResult('origin', result)} style={({ pressed }) => [styles.resultOriginButton, pressed && styles.pressed]}>
                  <Text style={styles.resultOriginText}>Usar como origem</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${details.title} como destino`} hitSlop={6} onPress={() => selectSearchResult('destination', result)} style={({ pressed }) => [styles.resultDestinationButton, pressed && styles.pressed]}>
                  <Text style={styles.resultDestinationText}>Usar como destino</Text>
                </Pressable>
              </View>
            </View>;
          })}
        </ScrollView>}
        {showSavedPlaces && !query.trim() && (favorites.length > 0 || recentWithoutFavorites.length > 0 || routeOrigins.length > 0 || routeHistory.length > 0) && <ScrollView style={styles.floatingResults} keyboardShouldPersistTaps="always" nestedScrollEnabled>
          {favorites.length > 0 && <Text style={styles.resultsCount}>Favoritos</Text>}
          {favorites.map((place) => {
            const details = searchResultDetails(place, location.position);
            return <Pressable key={`favorite:${place.storageId}`} accessibilityRole="button" accessibilityLabel={`Confirmar ${details.title} como ${activeKind === 'origin' ? 'origem' : 'destino'}`} onPress={() => selectSavedPlace(place)} style={styles.savedPlaceRow}>
              <View style={styles.savedPlaceText}><Text numberOfLines={1} style={styles.resultTitle}>{details.title}</Text><Text numberOfLines={1} style={styles.resultAddress}>{details.address} · {details.distance}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${details.title} como origem`} onPress={() => setPoint('origin', { ...place, source: 'saved' })} style={styles.savedOriginButton}><Text style={styles.savedOriginText}>A</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${details.title} como destino`} onPress={() => setPoint('destination', { ...place, source: 'saved' })} style={styles.savedDestinationButton}><Text style={styles.savedDestinationText}>B</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remover ${details.title} dos favoritos`} onPress={() => toggleFavorite(place)} style={styles.savedFavoriteButton}><Text style={styles.savedFavoriteText}>★</Text></Pressable>
            </Pressable>;
          })}
          {recentWithoutFavorites.length > 0 && <Text style={styles.resultsCount}>Recentes</Text>}
          {recentWithoutFavorites.map((place) => {
            const details = searchResultDetails(place, location.position);
            return <Pressable key={`recent:${place.storageId}`} accessibilityRole="button" accessibilityLabel={`Confirmar ${details.title} como ${activeKind === 'origin' ? 'origem' : 'destino'}`} onPress={() => selectSavedPlace(place)} style={styles.savedPlaceRow}>
              <View style={styles.savedPlaceText}><Text numberOfLines={1} style={styles.resultTitle}>{details.title}</Text><Text numberOfLines={1} style={styles.resultAddress}>{details.address} · {details.distance}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${details.title} como origem`} onPress={() => setPoint('origin', { ...place, source: 'saved' })} style={styles.savedOriginButton}><Text style={styles.savedOriginText}>A</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${details.title} como destino`} onPress={() => setPoint('destination', { ...place, source: 'saved' })} style={styles.savedDestinationButton}><Text style={styles.savedDestinationText}>B</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Adicionar ${details.title} aos favoritos`} onPress={() => toggleFavorite(place)} style={styles.savedFavoriteButton}><Text style={styles.savedFavoriteText}>☆</Text></Pressable>
            </Pressable>;
          })}
          {routeOrigins.length > 0 && <Text style={styles.resultsCount}>Origens das últimas rotas</Text>}
          {routeOrigins.map((place) => {
            const details = searchResultDetails(place, location.position);
            return <Pressable key={`route-origin:${place.storageId}`} accessibilityRole="button" accessibilityLabel={`Usar ${details.title} como origem da rota`} onPress={() => setPoint('origin', { ...place, source: 'saved' })} style={styles.savedPlaceRow}>
              <View style={styles.savedPlaceText}><Text numberOfLines={1} style={styles.resultTitle}>{details.title}</Text><Text numberOfLines={1} style={styles.resultAddress}>{details.address} · {details.distance}</Text></View>
              <Text style={styles.routeOriginBadge}>Origem</Text>
            </Pressable>;
          })}
          {routeHistory.length > 0 && <Text style={styles.resultsCount}>Últimas rotas</Text>}
          {routeHistory.map((route) => {
            const origin = searchResultDetails(route.origin, location.position);
            const destination = searchResultDetails(route.destination, location.position);
            return <View key={`route-history:${route.id}`} style={styles.routeHistoryRow}>
              <View style={styles.savedPlaceText}>
                <Text numberOfLines={1} style={styles.resultTitle}>{origin.title} → {destination.title}</Text>
                <Text numberOfLines={2} style={styles.resultAddress}>{origin.address || 'Origem'} → {destination.address || 'Destino'}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${origin.title} como origem`} onPress={() => setPoint('origin', { ...route.origin, source: 'saved' })} style={styles.savedOriginButton}><Text style={styles.savedOriginText}>A</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${destination.title} como destino`} onPress={() => setPoint('destination', { ...route.destination, source: 'saved' })} style={styles.savedDestinationButton}><Text style={styles.savedDestinationText}>B</Text></Pressable>
            </View>;
          })}
        </ScrollView>}
        {!navigationActive && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryList}>
          {POI_CATEGORIES.map((category) => {
            const active = activeCategories.includes(category.id);
            return <Pressable key={category.id} onPress={() => toggleCategory(category.id)} style={[styles.categoryChip, active && styles.categoryChipActive]}>
              <Text style={styles.categoryIcon}>{category.icon}</Text><Text style={[styles.categoryText, active && styles.categoryTextActive]}>{category.label}</Text>
            </Pressable>;
          })}
          <View style={styles.poiStatus}><Text numberOfLines={1} style={styles.poiStatusText}>{poiLoading ? 'Carregando…' : poiMessage}</Text></View>
        </ScrollView>}
      </View>
      {selectedPoi && <View style={styles.poiCard}>
        <View style={styles.poiCardText}>
          <Text numberOfLines={1} style={styles.poiName}>{selectedPoi.name}</Text>
          <Text numberOfLines={1} style={styles.poiAddress}>{selectedPoi.address || 'Local cadastrado no OpenStreetMap'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`${favoriteIds.has(placeStorageId(selectedPoi)) ? 'Remover' : 'Adicionar'} ${selectedPoi.name} ${favoriteIds.has(placeStorageId(selectedPoi)) ? 'dos' : 'aos'} favoritos`} accessibilityState={{ selected: favoriteIds.has(placeStorageId(selectedPoi)) }} onPress={() => toggleFavorite({ ...selectedPoi, label: selectedPoi.address ? `${selectedPoi.name}, ${selectedPoi.address}` : selectedPoi.name, source: 'search' })} style={styles.poiFavoriteButton}><Text style={styles.poiFavoriteText}>{favoriteIds.has(placeStorageId(selectedPoi)) ? '\u2605' : '\u2606'}</Text></Pressable>
        <Pressable onPress={() => usePoi('origin', selectedPoi)} style={styles.poiSecondaryButton}><Text style={styles.poiSecondaryText}>Origem</Text></Pressable>
        <Pressable onPress={() => usePoi('destination', selectedPoi)} style={styles.poiRouteButton}><Text style={styles.poiRouteText}>Rotas</Text></Pressable>
      </View>}
        <Pressable accessibilityLabel="Centralizar na minha localização" onPress={centerOnMyLocation} style={({ pressed }) => [styles.recenterButton, pressed && styles.pressed]}>
        <Text style={styles.recenterIcon}>{'\u2299'}</Text>
      </Pressable>
    </View>

    {!navigationActive && <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
      <View style={styles.panel}>
        <View style={styles.panelHandle} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.people}>
          <Text style={styles.peopleCount}>{party.participants.length} participante{party.participants.length === 1 ? '' : 's'}</Text>
          {party.participants.map((item) => {
            const statusText = participantStatusText(participantStatuses.get(item.id));
            const isSelf = item.id === ownParticipantId;
            return <Pressable key={item.id} disabled={isSelf} accessibilityRole="button" accessibilityLabel={isSelf ? `${item.name}, voce` : `Opções para ${item.name}`} onPress={() => openParticipantMenu(item)} style={styles.personChip}>
              <View style={[styles.personDot, { backgroundColor: item.color }]} />
              <View><Text style={styles.personName}>{item.name}</Text><Text style={styles.personMeta}>{statusText}</Text></View>
            </Pressable>;
          })}
        </ScrollView>

        {directRecipient && <View style={styles.directMessageRow}>
          <Text style={styles.directMessageTarget}>Para {directRecipient.name}</Text>
          <TextInput
            value={directDraft}
            onChangeText={setDirectDraft}
            onSubmitEditing={sendDirectMessage}
            placeholder="Digite uma mensagem"
            maxLength={500}
            returnKeyType="send"
            style={styles.directMessageInput}
          />
          <Pressable onPress={sendDirectMessage} disabled={directSending || !directDraft.trim()} style={[styles.directMessageButton, (directSending || !directDraft.trim()) && styles.disabled]}>
            <Text style={styles.directMessageButtonText}>{directSending ? '...' : 'Enviar'}</Text>
          </Pressable>
          <Pressable onPress={() => { setDirectRecipient(null); setDirectDraft(''); }} style={styles.directMessageClose}><Text style={styles.directMessageCloseText}>×</Text></Pressable>
        </View>}

        {locationPermissionDenied && <View style={styles.permissionWarning}>
          <Text style={styles.permissionWarningText}>{Platform.OS === 'ios' ? 'Permissão de localização negada no iPhone.' : 'Permissão de localização negada no Android.'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Abrir configuracoes de localizacao" onPress={toggleLocationSharing} style={styles.permissionWarningButton}>
            <Text style={styles.permissionWarningButtonText}>Permitir</Text>
          </Pressable>
        </View>}
        <View style={styles.sharingRow}>
          <View style={[styles.sharingDot, !party.locationSharingEnabled && styles.sharingDotPaused]} />
          <Text style={styles.sharingText}>{party.locationSharingEnabled ? 'Sua localização está sendo compartilhada' : 'Compartilhamento de localização pausado'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${party.locationSharingEnabled ? 'Pausar' : 'Retomar'} compartilhamento de localização`} accessibilityState={{ checked: party.locationSharingEnabled }} onPress={toggleLocationSharing} style={({ pressed }) => [styles.sharingButton, !party.locationSharingEnabled && styles.sharingButtonResume, pressed && styles.pressed]}>
            <Text style={[styles.sharingButtonText, !party.locationSharingEnabled && styles.sharingButtonTextResume]}>{party.locationSharingEnabled ? 'Pausar' : 'Retomar'}</Text>
          </Pressable>
        </View>
        <Text style={styles.message}>Toque no nome de um participante para autorizar ou bloquear a rota dele neste aparelho.</Text>

        {!navigationActive && <View style={styles.segment}>
          <Pressable onPress={() => setActiveKind('origin')} style={[styles.segmentButton, activeKind === 'origin' && styles.originActive]}><Text style={[styles.segmentText, activeKind === 'origin' && styles.activeText]}>Origem</Text></Pressable>
          <Pressable onPress={() => setActiveKind('destination')} style={[styles.segmentButton, activeKind === 'destination' && styles.destinationActive]}><Text style={[styles.segmentText, activeKind === 'destination' && styles.activeText]}>Destino</Text></Pressable>
          <Pressable onPress={useMyLocation} style={styles.locationButton}><Text style={styles.locationText}>Meu local</Text></Pressable>
        </View>}

        {party.route && <Text style={styles.routeSummary}>{formatDistance(party.route.distance)} · {formatDuration(party.route.duration)}{party.route.updatedBy?.name ? ` · por ${party.route.updatedBy.name}` : ''}{party.offline ? ' · rota em cache' : ''}</Text>}
        <View style={styles.actionRow}>
          {navigationRoute && !navigationActive && <Pressable onPress={startNavigation} style={styles.startNavigation}><Text maxFontSizeMultiplier={1.1} style={styles.startNavigationText}>Iniciar rota</Text></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="Enviar SOS criptografado" accessibilityState={{ disabled: sosSending, busy: sosSending }} disabled={sosSending} onPress={sendSos} style={[styles.sosButton, (!navigationRoute || navigationActive) && styles.sosButtonSolo, sosSending && styles.disabled]}>
            <Text maxFontSizeMultiplier={1.1} style={styles.sosButtonText}>{sosSending ? 'Enviando...' : 'SOS'}</Text>
          </Pressable>
        </View>
        <Text accessibilityLiveRegion="polite" numberOfLines={2} style={[styles.message, (party.error || message || party.offline || !party.locationSharingEnabled) && styles.warning]}>{party.error || message || (party.offline ? 'Sem conexão. Posições antigas aparecem como estimadas.' : party.locationSharingEnabled ? location.status : 'Compartilhamento pausado; movimento e GPS foram interrompidos.')}</Text>
        <Text onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright')} style={styles.attribution}>Busca: © contribuidores OpenStreetMap · rotas: OSRM</Text>
      </View>
    </KeyboardAvoidingView>}
    <Modal visible={routeSharePickerVisible} transparent animationType="fade" onRequestClose={() => setRouteSharePickerVisible(false)}>
      <View style={styles.routeShareBackdrop}>
        <View style={styles.routeShareMenu}>
          <Text style={styles.routeShareTitle}>Compartilhar rota</Text>
          <Text style={styles.routeShareHint}>Escolha um ou mais participantes. Cada pessoa confirma no próprio aparelho.</Text>
          <Pressable onPress={() => setRouteShareSelection(new Set(party.participants.filter((item) => item.id !== ownParticipantId).map((item) => item.id)))} style={styles.routeShareAllButton}>
            <Text style={styles.routeShareAllText}>Selecionar todos</Text>
          </Pressable>
          <ScrollView style={styles.routeShareList}>
            {party.participants.filter((item) => item.id !== ownParticipantId).map((item) => {
              const selected = routeShareSelection.has(item.id);
              return <Pressable key={item.id} onPress={() => toggleRouteShareParticipant(item.id)} style={styles.routeShareRow}>
                <View style={[styles.routeShareCheck, selected && styles.routeShareCheckSelected]}><Text style={styles.routeShareCheckText}>{selected ? '✓' : ''}</Text></View>
                <View><Text style={styles.routeShareName}>{item.name}</Text><Text style={styles.routeShareStatus}>{item.online === false ? 'offline' : 'conectado'}</Text></View>
              </Pressable>;
            })}
          </ScrollView>
          <View style={styles.routeShareActions}>
            <Pressable onPress={() => setRouteSharePickerVisible(false)} style={styles.routeShareCancel}><Text style={styles.routeShareCancelText}>Cancelar</Text></Pressable>
            <Pressable disabled={!routeShareSelection.size} onPress={confirmRouteShare} style={[styles.routeShareConfirm, !routeShareSelection.size && styles.disabled]}><Text style={styles.routeShareConfirmText}>Enviar convite</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f172a' },
  header: { minHeight: 66, paddingHorizontal: 14, backgroundColor: '#0b172a', flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { flex: 1, minWidth: 0 }, clientCode: { color: '#b9f227', fontSize: 8, letterSpacing: 1.4, fontWeight: '900' }, participantCount: { color: '#8ea0b9', fontSize: 10, marginTop: 2 }, title: { color: '#fff', fontSize: 16, fontWeight: '900' }, titleDot: { color: '#b9f227' }, liveText: { color: '#b9f227', fontSize: 8, letterSpacing: 1, fontWeight: '900' }, room: { display: 'none' },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  headerShareColumn: { width: 118, alignItems: 'stretch', gap: 2 },
  headerButton: { minHeight: 31, paddingHorizontal: 7, borderRadius: 10, justifyContent: 'center', backgroundColor: '#1a73e8' },
  headerButtonText: { color: '#fff', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  headerMicButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' },
  speedBadge: { minHeight: 18, paddingHorizontal: 5, borderRadius: 6, backgroundColor: '#172554', alignItems: 'center', justifyContent: 'center' }, speedBubble: { position: 'absolute', zIndex: 20, width: 88, height: 88, borderRadius: 44, backgroundColor: '#172554', borderWidth: 2, borderColor: '#bfdbfe', alignItems: 'center', justifyContent: 'center', shadowColor: '#0f172a', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 8 }, speedBubbleValue: { color: '#fff', fontSize: 30, lineHeight: 34, fontWeight: '900', textAlign: 'center' }, speedBubbleUnit: { color: '#bfdbfe', fontSize: 11, lineHeight: 14, fontWeight: '800', textAlign: 'center' },
  speedBadgeText: { color: '#bfdbfe', fontSize: 9, fontWeight: '900' },
  routeShareBackdrop: { flex: 1, backgroundColor: 'rgba(2, 8, 23, 0.62)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  routeShareMenu: { width: '100%', maxHeight: '75%', padding: 18, borderRadius: 18, backgroundColor: '#fff' },
  routeShareTitle: { color: '#0f172a', fontSize: 19, fontWeight: '900' },
  routeShareHint: { marginTop: 6, color: '#64748b', fontSize: 12, lineHeight: 17 },
  routeShareAllButton: { alignSelf: 'flex-start', marginTop: 12, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#dbeafe' },
  routeShareAllText: { color: '#1d4ed8', fontSize: 12, fontWeight: '800' },
  routeShareList: { marginTop: 8 },
  routeShareRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e8f0' },
  routeShareCheck: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: '#94a3b8', alignItems: 'center', justifyContent: 'center' },
  routeShareCheckSelected: { borderColor: '#1a73e8', backgroundColor: '#1a73e8' },
  routeShareCheckText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  routeShareName: { color: '#0f172a', fontSize: 14, fontWeight: '800' },
  routeShareStatus: { marginTop: 2, color: '#64748b', fontSize: 10 },
  routeShareActions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  routeShareCancel: { flex: 1, minHeight: 42, borderRadius: 10, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  routeShareCancelText: { color: '#334155', fontSize: 12, fontWeight: '800' },
  routeShareConfirm: { flex: 1, minHeight: 42, borderRadius: 10, backgroundColor: '#1a73e8', alignItems: 'center', justifyContent: 'center' },
  routeShareConfirmText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  leaveButton: { minHeight: 38, paddingHorizontal: 8, justifyContent: 'center' }, leaveText: { color: '#ff9b9b', fontSize: 12, fontWeight: '800' },
  connectionBanner: { minHeight: 38, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fff7ed', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#fed7aa', flexDirection: 'row', alignItems: 'center' },
  connectionBannerDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 }, connectionBannerText: { flex: 1, color: '#9a3412', fontSize: 12, fontWeight: '700' },
  mapArea: { flex: 1 }, map: { flex: 1 },
  mapControls: { position: 'absolute', top: 12, left: 12, right: 12 }, navigationMapControls: { display: 'none' },
  navigationCard: { position: 'absolute', bottom: 16, left: 12, right: 12, minHeight: 104, padding: 12, borderRadius: 16, borderLeftWidth: 4, borderLeftColor: '#b9f227', backgroundColor: '#0b172a', flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: '#0f172a', shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 7, zIndex: 5 }, lockedActions: { alignItems: 'center', gap: 7 }, lockButton: { width: 44, height: 40, borderRadius: 11, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' }, lockIcon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'flex-end' }, lockIconClosed: { transform: [{ scale: 1.05 }] }, lockBody: { width: 16, height: 12, borderRadius: 3, backgroundColor: '#b9f227' }, lockShackle: { position: 'absolute', top: 4, width: 11, height: 12, borderWidth: 3, borderBottomWidth: 0, borderColor: '#b9f227', borderTopLeftRadius: 7, borderTopRightRadius: 7, transform: [{ rotate: '180deg' }] }, lockShackleClosed: { top: 1, transform: [] },
  navigationCardOffRoute: { borderLeftColor: '#fb7185' }, navigationCardText: { flex: 1 }, personalRouteBadge: { alignSelf: 'flex-start', marginBottom: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', backgroundColor: '#dbeafe', color: '#1d4ed8', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 }, navigationEyebrow: { color: '#b9f227', fontSize: 10, fontWeight: '900', letterSpacing: 1 }, navigationInstruction: { color: '#fff', fontSize: 17, lineHeight: 21, fontWeight: '900', marginTop: 2 }, navigationEta: { color: '#a9b8ca', fontSize: 11, marginTop: 4 },
  navigationProgressTrack: { height: 4, marginTop: 8, borderRadius: 2, overflow: 'hidden', backgroundColor: '#334155' }, navigationProgressFill: { height: 4, borderRadius: 2, backgroundColor: '#b9f227' },
  navigationActions: { width: 82, alignItems: 'stretch', gap: 5 }, offRouteText: { color: '#fecdd3', fontSize: 9, lineHeight: 12, fontWeight: '800', textAlign: 'center' }, recalculateButton: { minHeight: 40, paddingHorizontal: 6, borderRadius: 9, backgroundColor: '#e11d48', alignItems: 'center', justifyContent: 'center' }, recalculateButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  stopNavigation: { minHeight: 33, paddingHorizontal: 6, borderRadius: 9, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, stopNavigationText: { color: '#0f172a', fontSize: 10, fontWeight: '900' }, centerNavigation: { minHeight: 33, paddingHorizontal: 5, borderRadius: 9, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' }, centerNavigationText: { color: '#1d4ed8', fontSize: 9, fontWeight: '900' },
  floatingSearch: { minHeight: 50, paddingHorizontal: 13, borderRadius: 25, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', shadowColor: '#0f172a', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  assistantRow: { minHeight: 43, marginTop: 7, paddingHorizontal: 10, borderRadius: 22, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', flexDirection: 'row', alignItems: 'center' }, assistantIcon: { color: '#2563eb', fontSize: 16, marginRight: 6 }, assistantInput: { flex: 1, height: 40, color: '#0f172a', fontSize: 11 }, assistantMicButton: { width: 32, height: 32, marginLeft: 4, borderRadius: 16, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' }, assistantMicButtonActive: { backgroundColor: '#fecaca' }, assistantMicText: { color: '#1d4ed8', fontSize: 14 }, assistantButton: { minHeight: 31, paddingHorizontal: 9, borderRadius: 15, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center' }, assistantButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' }, assistantReply: { marginTop: 5, paddingHorizontal: 10, color: '#1e3a8a', fontSize: 10, fontWeight: '700' },
  searchIcon: { color: '#475569', fontSize: 24, marginRight: 8 }, floatingInput: { flex: 1, height: 48, color: '#0f172a', fontSize: 15 },
  clearSearchButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, clearSearch: { color: '#64748b', fontSize: 25, lineHeight: 28 }, floatingSearchButton: { color: '#1a73e8', fontSize: 13, fontWeight: '800', paddingVertical: 12 },
  mapStyleOptions: { alignSelf: 'flex-start', flexDirection: 'row', marginTop: 7, padding: 3, borderRadius: 17, backgroundColor: 'rgba(15, 23, 42, 0.86)', gap: 3 },
  mapStyleButton: { minHeight: 30, paddingHorizontal: 12, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, mapStyleButtonActive: { backgroundColor: '#fff' },
  mapStyleText: { color: '#e2e8f0', fontSize: 11, fontWeight: '800' }, mapStyleTextActive: { color: '#0f172a' },
  floatingResults: { maxHeight: 310, marginTop: 7, backgroundColor: '#fff', borderRadius: 14, shadowColor: '#0f172a', shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  resultsCount: { paddingHorizontal: 13, paddingTop: 10, paddingBottom: 4, color: '#64748b', fontSize: 11, fontWeight: '700' },
  resultCard: { padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#cbd5e1' }, resultTitle: { color: '#0f172a', fontSize: 15, fontWeight: '800' },
  resultAddress: { marginTop: 3, color: '#475569', fontSize: 12, lineHeight: 17 }, resultDistance: { marginTop: 5, color: '#1d4ed8', fontSize: 11, fontWeight: '700' },
  resultActions: { flexDirection: 'row', gap: 8, marginTop: 10 }, resultOriginButton: { flex: 1, minHeight: 44, borderRadius: 10, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }, resultOriginText: { color: '#166534', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  resultDestinationButton: { flex: 1, minHeight: 44, borderRadius: 10, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }, resultDestinationText: { color: '#1e40af', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  favoriteButton: { width: 44, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  favoriteButtonActive: { borderColor: '#f59e0b', backgroundColor: '#fffbeb' }, favoriteButtonText: { color: '#64748b', fontSize: 22 }, favoriteButtonTextActive: { color: '#d97706' },
  savedPlaceRow: { minHeight: 62, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#cbd5e1', flexDirection: 'row', alignItems: 'center', gap: 6 },
  savedPlaceText: { flex: 1, minWidth: 0 },
  routeOriginBadge: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7, backgroundColor: '#dcfce7', color: '#166534', fontSize: 10, fontWeight: '800' }, routeHistoryRow: { minHeight: 70, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#cbd5e1', flexDirection: 'row', alignItems: 'center', gap: 6 },
  savedOriginButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center' }, savedOriginText: { color: '#166534', fontSize: 13, fontWeight: '900' },
  savedDestinationButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' }, savedDestinationText: { color: '#1e40af', fontSize: 13, fontWeight: '900' },
  savedFavoriteButton: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#fffbeb', alignItems: 'center', justifyContent: 'center' }, savedFavoriteText: { color: '#d97706', fontSize: 20 },
  categoryList: { gap: 8, paddingTop: 9, paddingBottom: 4 }, categoryChip: { height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#0f172a', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  categoryChipActive: { backgroundColor: '#e8f0fe', borderColor: '#a8c7fa' }, categoryIcon: { fontSize: 15, marginRight: 5 }, categoryText: { color: '#334155', fontSize: 12, fontWeight: '700' }, categoryTextActive: { color: '#1557b0' },
  poiStatus: { maxWidth: 190, height: 36, paddingHorizontal: 11, borderRadius: 18, backgroundColor: 'rgba(15, 23, 42, 0.78)', justifyContent: 'center' }, poiStatusText: { color: '#fff', fontSize: 10 },
  recenterButton: { position: 'absolute', right: 14, bottom: 14, width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#0f172a', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  recenterIcon: { color: '#2563eb', fontSize: 27, fontWeight: '700', lineHeight: 30 },
  pin: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#0f172a', shadowOpacity: 0.28, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  pinText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  // Keep the name inside the native marker bitmap. Android clips custom marker
  // content outside the measured view even when React Native allows overflow.
  eagleMarker: Platform.OS === 'android' ? { width: 132, height: 88, alignItems: 'center', justifyContent: 'flex-start' } : { width: 44, height: 50, alignItems: 'center', justifyContent: 'flex-start', overflow: 'visible' }, eagleMarkerEstimated: { opacity: 0.58 }, eagleMarkerImage: Platform.OS === 'android' ? { position: 'absolute', top: 0, width: 38, height: 50 } : { width: 38, height: 50 },
  personLabel: Platform.OS === 'android' ? { position: 'absolute', top: 50, left: 0, zIndex: 10, elevation: 10, width: 132, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderRadius: 4, backgroundColor: 'transparent' } : { position: 'absolute', top: 50, left: -44, width: 132, alignItems: 'center', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, backgroundColor: 'transparent' }, personLabelBelow: Platform.OS === 'android' ? { top: 70 } : {}, personLabelText: { color: '#fff', fontSize: 9, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 2 },
  clusterMarker: { minWidth: 44, height: 44, paddingHorizontal: 9, borderRadius: 22, borderWidth: 3, borderColor: '#fff', backgroundColor: '#1d4ed8', alignItems: 'center', justifyContent: 'center', shadowColor: '#0f172a', shadowOpacity: 0.3, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 5 },
  clusterMarkerText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  poiMarker: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#0f172a', shadowOpacity: 0.22, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 }, poiMarkerIcon: { fontSize: 16 },
  poiCard: { position: 'absolute', left: 12, right: 12, bottom: 12, minHeight: 62, padding: 10, borderRadius: 14, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 7, shadowColor: '#0f172a', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  poiCardText: { flex: 1 }, poiName: { color: '#0f172a', fontSize: 13, fontWeight: '800' }, poiAddress: { marginTop: 3, color: '#64748b', fontSize: 10 },
  poiFavoriteButton: { width: 44, height: 44, borderRadius: 11, backgroundColor: '#fffbeb', alignItems: 'center', justifyContent: 'center' }, poiFavoriteText: { color: '#d97706', fontSize: 20 },
  poiSecondaryButton: { height: 38, paddingHorizontal: 9, borderRadius: 10, backgroundColor: '#e2e8f0', justifyContent: 'center' }, poiSecondaryText: { color: '#334155', fontSize: 11, fontWeight: '700' },
  poiRouteButton: { height: 38, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#1a73e8', justifyContent: 'center' }, poiRouteText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  panel: { backgroundColor: '#fff', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, borderTopLeftRadius: 25, borderTopRightRadius: 25, marginTop: -12, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  panelHandle: { alignSelf: 'center', width: 34, height: 4, borderRadius: 2, backgroundColor: '#dbe3ed', marginBottom: 8 },
  people: { alignItems: 'center', gap: 6, paddingBottom: 7 }, peopleCount: { color: '#475569', fontSize: 10, fontWeight: '700' }, directMessageRow: { marginHorizontal: 14, marginTop: 8, padding: 7, borderRadius: 12, backgroundColor: '#e0f2fe', flexDirection: 'row', alignItems: 'center', gap: 6 }, directMessageTarget: { color: '#0c4a6e', fontSize: 10, fontWeight: '800' }, directMessageInput: { flex: 1, minHeight: 34, paddingHorizontal: 8, borderRadius: 8, backgroundColor: '#fff', color: '#0f172a', fontSize: 11 }, directMessageButton: { minHeight: 34, paddingHorizontal: 9, borderRadius: 8, backgroundColor: '#0284c7', alignItems: 'center', justifyContent: 'center' }, directMessageButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' }, directMessageClose: { paddingHorizontal: 4 }, directMessageCloseText: { color: '#0c4a6e', fontSize: 20 },
  personChip: { minHeight: 38, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 11, paddingHorizontal: 8, paddingVertical: 4 },
  personDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 }, personName: { fontSize: 10, color: '#334155', fontWeight: '800' }, personMeta: { marginTop: 1, color: '#64748b', fontSize: 8 },
  sharingRow: { minHeight: 46, marginBottom: 9, paddingLeft: 10, paddingRight: 4, borderRadius: 12, backgroundColor: '#f8fafc', flexDirection: 'row', alignItems: 'center', gap: 8 },
  permissionWarning: { minHeight: 46, marginBottom: 8, paddingLeft: 10, paddingRight: 4, borderRadius: 12, backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa', flexDirection: 'row', alignItems: 'center', gap: 8 }, permissionWarningText: { flex: 1, color: '#9a3412', fontSize: 10, fontWeight: '800' }, permissionWarningButton: { minHeight: 36, paddingHorizontal: 11, borderRadius: 9, backgroundColor: '#ea580c', alignItems: 'center', justifyContent: 'center' }, permissionWarningButtonText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  sharingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#16a34a' }, sharingDotPaused: { backgroundColor: '#f59e0b' }, sharingText: { flex: 1, color: '#475569', fontSize: 10, fontWeight: '700' },
  sharingButton: { minWidth: 72, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' }, sharingButtonResume: { backgroundColor: '#dcfce7' }, sharingButtonText: { color: '#b91c1c', fontSize: 11, fontWeight: '900' }, sharingButtonTextResume: { color: '#166534' },
  segment: { flexDirection: 'row', gap: 7, marginBottom: 9 }, segmentButton: { flex: 1, minHeight: 40, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  originActive: { backgroundColor: '#16a34a' }, destinationActive: { backgroundColor: '#dc2626' }, segmentText: { color: '#334155', fontSize: 13, fontWeight: '700' }, activeText: { color: '#fff' },
  locationButton: { minHeight: 40, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' }, locationText: { color: '#1d4ed8', fontSize: 12, fontWeight: '700' },
  result: { padding: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#cbd5e1' }, resultText: { color: '#334155', fontSize: 12, lineHeight: 17 }, disabled: { opacity: 0.45 },
  routeSummary: { marginTop: 7, color: '#1e40af', fontSize: 11, fontWeight: '800' }, actionRow: { flexDirection: 'row', gap: 8, marginTop: 8 }, startNavigation: { flex: 1, minHeight: 42, borderRadius: 11, backgroundColor: '#1a73e8', alignItems: 'center', justifyContent: 'center' }, startNavigationText: { color: '#fff', fontSize: 12, fontWeight: '900' }, sosButton: { flex: 1, minHeight: 42, borderRadius: 11, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' }, sosButtonSolo: { flex: 1 }, sosButtonText: { color: '#fff', fontSize: 13, fontWeight: '900' }, message: { marginTop: 6, color: '#64748b', fontSize: 10 }, warning: { color: '#b45309' },
  attribution: { marginTop: 5, color: '#64748b', fontSize: 9, textDecorationLine: 'underline' },
  pressed: { opacity: 0.72 }
});
