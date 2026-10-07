import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Alert, AppState, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, PanResponder, Platform, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text as NativeText, TextInput, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { askAssistant, calculateRoute, fetchEmergencyPublicKey, prepareOfflineGraph, reportRoutePerformance, searchNearbyPois, searchPlaces, searchPois } from '../api';
import { createSealedEmergencyPacket } from '../emergencyPacket';
import { useLocationSharing } from '../hooks/useLocationSharing';
import { useParty } from '../hooks/useParty';
import { buildNavigationGuidance, distanceMeters } from '../navigationGuidance';
import { CONNECTION_STATE, NAVIGATION_STATE, createNavigationState, transitionNavigation } from '../navigationState';
import { executeNavigationCommand } from '../navigationCommandExecutor';
import { speakAssistantText, speakNavigationGuidance, stopNavigationVoice } from '../navigationVoice';
import { assistantReplyForIntent, parseAssistantIntent } from '../assistantIntent';
import { useSpeechAssistant } from '../hooks/useSpeechAssistant';
import { addRecognitionAttention, appendRecognitionPoint, closeRecognitionTrack, createRecognitionTrack, loadFavoritePlaces, loadOfflineRoutePackage, loadPartyPoints, loadPendingRecognitionTracks, loadPendingRoutePerformance, loadRecognitionTrack, loadRecentPlaces, loadRouteHistory, loadRouteOrigins, placeStorageId, removeFavoritePlace, removePendingRecognitionTrack, removePendingRoutePerformance, saveFavoritePlace, saveOfflineRoutePackage, savePartyPoints, savePartySnapshot, savePendingRecognitionTrack, savePendingRoutePerformance, saveRecentPlace, saveRouteHistory, saveRouteOrigin } from '../offlineStore';
import { buildReturnPoints } from '../routeReturn';
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

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function zoomFromRegion(region, fallback = 18.5) {
  const latitudeDelta = Number(region?.latitudeDelta);
  if (!Number.isFinite(latitudeDelta) || latitudeDelta <= 0) return fallback;
  return Math.max(2, Math.min(19, Math.log2(360 / latitudeDelta)));
}

function formatSpeedValue(position, notBefore = 0) {
  const timestamp = Number(position?.timestamp);
  // Sem uma leitura recente não há velocidade atual confiável. Mostrar zero
  // evita deixar congelada a última velocidade enquanto o aparelho está parado
  // ou aguardando o próximo fix nativo.
  if (!Number.isFinite(timestamp) || timestamp < notBefore || Date.now() - timestamp > 4_000) return '0';
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
  cameraHeading(position, headingRef);
  // Durante a navegação a câmera já aponta para o rumo do veículo. Aplicar o
  // mesmo rumo no Marker faria a águia girar duas vezes.
  // A câmera acompanha o rumo também na tela de pesquisa; manter a águia
  // sem rotação evita que ela fique de lado quando o mapa gira.
  return 0;
}

function isUsableRoute(route) {
  const coordinates = route?.geometry?.coordinates;
  const validPoint = (point) => Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng));
  return validPoint(route?.origin)
    && validPoint(route?.destination)
    && Array.isArray(coordinates)
    && coordinates.length >= 2
    && coordinates.every((point) => Array.isArray(point)
      && point.length >= 2
      && Number.isFinite(Number(point[0]))
      && Number.isFinite(Number(point[1])));
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
  const [recognitionTrack, setRecognitionTrack] = useState(null);
  const [recognitionPoints, setRecognitionPoints] = useState([]);
  const [attentionPoints, setAttentionPoints] = useState([]);
  const [localRoute, setLocalRoute] = useState(null);
  const [temporaryStop, setTemporaryStop] = useState(null);
  const [detourSearchOpen, setDetourSearchOpen] = useState(false);
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
  const [navigationMessageMenuOpen, setNavigationMessageMenuOpen] = useState(false);
  const [navigationMessageSelection, setNavigationMessageSelection] = useState(() => new Set());
  const [navigationMessageDraft, setNavigationMessageDraft] = useState('');
  const [navigationMessageSending, setNavigationMessageSending] = useState(false);
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
  const [utilityMenuOpen, setUtilityMenuOpen] = useState(false);
  const [navigationState, transitionNavigationState] = useReducer(transitionNavigation, undefined, createNavigationState);
  const navigationActive = navigationState.navigation === NAVIGATION_STATE.NAVIGATING || navigationState.navigation === NAVIGATION_STATE.RECALCULATING;
  const [navigationLocked, setNavigationLocked] = useState(false);
  const [navigationGuidance, setNavigationGuidance] = useState(null);
  const [temporaryStopArmed, setTemporaryStopArmed] = useState(false);
  const [routeProfile, setRouteProfile] = useState('driving');
  const [completedRoute, setCompletedRoute] = useState(null);
  const [routeDisplayEnabled, setRouteDisplayEnabled] = useState(true);
  const [traveledMeters, setTraveledMeters] = useState(0);
  const [plannedTripMeters, setPlannedTripMeters] = useState(0);
  const [displaySpeedKmh, setDisplaySpeedKmh] = useState(0);
  const [mapRefreshKey, setMapRefreshKey] = useState(0);
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
  const navigationZoomRef = useRef(null);
  const navigationCameraGestureUntilRef = useRef(0);
  const lastFreeCameraPositionRef = useRef(null);
  const lastMapRegionRef = useRef(INITIAL_REGION);
  const completedOriginRef = useRef(null);
  const traveledMetersRef = useRef(0);
  const plannedTripMetersRef = useRef(0);
  const lastTraveledPositionRef = useRef(null);
  const navigationStartedAtRef = useRef(0);
  const navigationTraceRef = useRef([]);
  const temporaryStopResumeRef = useRef(false);
  const offlinePackageRequestRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);
  const restoreMapTimerRef = useRef(null);
  const speedBubbleDragStartRef = useRef({ left: 0, top: 12 });
  const speedBubbleCustomizedRef = useRef(false);
  const voiceHistoryRef = useRef({});
  const recognitionTrackRef = useRef(null);
  const lastRecognitionTimestampRef = useRef(0);
  const locationPositionRef = useRef(null);
  const assistantHistoryRef = useRef([]);
  // This hook must be initialized before any derived value reads
  // location.position. Otherwise accepting a shared route can evaluate
  // canReturnToOrigin while `location` is still in the temporal dead zone.
  const location = useLocationSharing({ enabled: true, mode: navigationActive ? 'navigation' : 'tracking', roomId: session.roomId, shareLocation: party.locationSharingEnabled, onLocation: party.sendLocation });
  const categoryKey = activeCategories.join(',');
  const navigationRoute = party.personalRoute || localRoute || party.sharedRoute || party.route;
  const returnOrigin = completedRoute?.origin
    || completedOriginRef.current
    || originalNavigationRouteRef.current?.origin;
  const returnRouteStarted = Boolean(completedRoute || navigationStartedAtRef.current > 0);
  const canReturnToOrigin = Boolean(returnOrigin && returnRouteStarted && (
    completedRoute
      || !location.position
      || distanceMeters(returnOrigin, location.position) >= 15
  ));
  // GPS local é necessário para busca por proximidade mesmo quando o usuário
  // optou por não compartilhar sua posição com a party.
  // O GPS local não pode depender do ACK do socket. A posição também é
  // necessária para centralizar, pesquisar por proximidade e montar a rota.
  locationPositionRef.current = location.position;
  useEffect(() => {
    let active = true;
    if (!party.joined) return undefined;
    createRecognitionTrack(session.roomId, session.name).then((track) => {
      if (!active) return closeRecognitionTrack(track.id);
      recognitionTrackRef.current = track;
      setRecognitionTrack(track);
      setRecognitionPoints([]);
      setAttentionPoints([]);
    }).catch(() => setMessage('Não foi possível iniciar o registro do percurso.'));
    return () => {
      active = false;
      const trackId = recognitionTrackRef.current?.id;
      if (trackId) closeRecognitionTrack(trackId).catch(() => undefined);
      recognitionTrackRef.current = null;
    };
  }, [party.joined, session.name, session.roomId]);
  useEffect(() => {
    const point = location.position;
    const trackId = recognitionTrack?.id;
    if (!trackId || !point || point.timestamp <= lastRecognitionTimestampRef.current) return;
    lastRecognitionTimestampRef.current = point.timestamp;
    appendRecognitionPoint(trackId, point).catch(() => undefined);
    setRecognitionPoints((current) => [...current.slice(-2499), point]);
  }, [location.position, recognitionTrack]);
  const displayedRoute = routeDisplayEnabled
    ? (navigationActive ? navigationRoute : (localRoute || party.sharedRoute || party.route))
    : null;
  const offlineTileTemplate = useOfflineRouteTiles(displayedRoute);
  const ownParticipantId = party.participantId || party.participants.find((item) => item.name === session.name)?.id;
  const ownParticipantName = session.name.trim().toLocaleLowerCase('pt-BR');
  const ownParticipant = party.participants.find((item) => item.id === ownParticipantId);
  const searchLocation = location.position || null;
  // A posição local é privada e deve continuar visível no próprio aparelho,
  // mesmo quando o usuário não autorizou compartilhá-la com a party.
  const ownLocation = location.position || ownParticipant?.location || null;
  // O marcador próprio representa o fix real do aparelho. A projeção na rota
  // continua sendo usada para orientação e progresso, mas não pode "puxar"
  // visualmente a águia para a rota antiga durante um recálculo.
  const ownMarkerLocation = ownLocation;
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
      const incoming = party.incomingSos;
      const sender = incoming.participantName || 'Um participante';
      const directDistance = location.position && incoming.location ? distanceMeters(location.position, incoming.location) : null;
      const formatDistance = (meters) => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
      const showPrompt = (route) => {
        const routeDistance = Number.isFinite(route?.distance) ? route.distance : directDistance;
        const distanceLine = Number.isFinite(routeDistance) ? `Distância ${route?.distance ? 'pela rota' : 'aproximada'}: ${formatDistance(routeDistance)}.` : 'Distância indisponível sem GPS.';
        Alert.alert('SOS RECEBIDO', `${sender}: ${incoming.message || 'SOS — preciso de ajuda'}\n${distanceLine}\nDeseja ir até o local?`, [
          { text: 'Agora não', style: 'cancel', onPress: () => party.respondSos(incoming.messageId, false).catch(() => undefined) },
          { text: 'Ir até o local', onPress: async () => {
            try {
              await party.respondSos(incoming.messageId, true);
              if (!route) return setMessage('Aceite confirmado, mas não foi possível calcular a rota.');
              setLocalRoute(route);
              setPoints({ origin: route.origin, destination: route.destination });
              startNavigation(route);
            } catch (error) { setMessage(error.message); }
          } }
        ]);
      };
      if (incoming.location && location.position) {
        calculateRoute(location.position, { lat: incoming.location.lat, lng: incoming.location.lng, name: `SOS de ${sender}` })
          .then(showPrompt).catch(() => showPrompt(null));
      } else showPrompt(null);
      setMessage(`SOS recebido de ${sender}. Calculando distância e rota...`);
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
              if (!isUsableRoute(reply.route)) {
                setMessage('O convite foi aceito, mas a rota recebida é inválida. Solicite o compartilhamento novamente.');
                return;
              }
              setRouteProfile(reply.route.profile === 'boat' ? 'boat' : 'driving');
              setLocalRoute(reply.route);
              setPoints({ origin: reply.route.origin, destination: reply.route.destination });
              await startNavigation(reply.route);
            } catch (error) {
              setMessage(error.message);
            }
          }
        }
      ]
    );
  }, [party.incomingRouteShareInvitation]);

  useEffect(() => {
    if (party.sosDelivery?.messageId) {
      const response = party.sosDelivery;
      setMessage(response.accepted
        ? `${response.participantName || 'Um participante'} aceitou o SOS e está indo ao local.`
        : `${response.participantName || 'Um participante'} não poderá atender ao SOS.`);
      if (response.accepted) Alert.alert('SOS ATENDIDO', `${response.participantName || 'Um participante'} aceitou ir ao local.`);
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
    const coordinates = party.route?.geometry?.coordinates;
    if (!party.route || !Array.isArray(coordinates) || coordinates.length < 2) return;
    setRouteProfile(party.route.profile || 'driving');
    setPoints({ origin: party.route.origin, destination: party.route.destination });
    routeOriginRef.current = party.route.origin || null;
    const mapCoordinates = coordinates
      .filter((coordinate) => Array.isArray(coordinate)
        && coordinate.length >= 2
        && Number.isFinite(Number(coordinate[0]))
        && Number.isFinite(Number(coordinate[1])))
      .map(([longitude, latitude]) => ({ latitude: Number(latitude), longitude: Number(longitude) }));
    if (mapCoordinates.length > 1) mapRef.current?.fitToCoordinates(mapCoordinates, {
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
    if (!navigationActive) {
      navigationZoomRef.current = null;
      return undefined;
    }
    if (navigationZoomRef.current == null) navigationZoomRef.current = 18.5;
    return undefined;
  }, [navigationActive]);

  useEffect(() => {
    if (!location.position) return;
    if (navigationActive) {
      if (Date.now() < navigationCameraGestureUntilRef.current) return;
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
        const targetZoom = maneuver ? 19 : (navigationZoomRef.current || 18.5);
        mapRef.current?.animateCamera({ center, zoom: targetZoom, heading }, { duration: 250 });
      } catch (error) {
        console.warn('[MapParty] navigation camera update failed', error?.message || error);
      }
      return;
    }
    lastNavigationCameraRef.current = null;
    const heading = cameraHeading(location.position, headingRef);
    const previous = lastFreeCameraPositionRef.current;
    const movedEnough = !previous || distanceMeters(previous, location.position) >= 3;
    const headingChanged = heading != null && (
      previous?.heading == null || Math.abs(((heading - previous.heading + 540) % 360) - 180) >= 5
    );
    if (!movedEnough && !headingChanged) return;
    lastFreeCameraPositionRef.current = { lat: location.position.lat, lng: location.position.lng, heading };
    if (!didCenterUserRef.current) {
      didCenterUserRef.current = true;
      mapRef.current?.animateCamera({
        center: { latitude: location.position.lat, longitude: location.position.lng },
        zoom: 16.5,
        heading
      }, { duration: 650 });
      return;
    }
    mapRef.current?.animateCamera({
      center: { latitude: location.position.lat, longitude: location.position.lng },
      heading
    }, { duration: 350 });
  }, [location.position, party.route, navigationActive, navigationGuidance?.precisionMode, navigationGuidance?.maneuverPoint?.lat, navigationGuidance?.maneuverPoint?.lng]);

  useEffect(() => {
    if (!navigationActive || !location.position || !navigationRoute?.destination) return;
    const lastTracePoint = navigationTraceRef.current.at(-1);
    if (!lastTracePoint || location.position.timestamp > lastTracePoint.timestamp) {
      navigationTraceRef.current = [...navigationTraceRef.current.slice(-499), location.position];
    }
    // Distância percorrida é uma medição do deslocamento real do aparelho.
    // Ela não depende da geometria, progresso ou recálculo da rota atual.
    const previousTraveledPosition = lastTraveledPositionRef.current;
    if (!previousTraveledPosition || location.position.timestamp > previousTraveledPosition.timestamp) {
      if (previousTraveledPosition) {
        const segmentMeters = distanceMeters(previousTraveledPosition, location.position);
        const elapsedSeconds = Math.max(0.1, (location.position.timestamp - previousTraveledPosition.timestamp) / 1000);
        const measuredSpeed = segmentMeters / elapsedSeconds;
        setDisplaySpeedKmh(segmentMeters >= 8 && measuredSpeed >= 1.5 ? Math.min(90, measuredSpeed * 3.6) : 0);
        // Ignore impossible GPS jumps; they must never inflate the trip total.
        if (Number.isFinite(segmentMeters) && segmentMeters >= 1 && segmentMeters / elapsedSeconds <= 100) {
          const nextTraveledMeters = traveledMetersRef.current + segmentMeters;
          traveledMetersRef.current = nextTraveledMeters;
          setTraveledMeters(nextTraveledMeters);
        }
      }
      if (!previousTraveledPosition) setDisplaySpeedKmh(0);
      lastTraveledPositionRef.current = location.position;
    }
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
      if (temporaryStop && originalNavigationRouteRef.current?.destination) {
        if (!temporaryStopResumeRef.current) {
          temporaryStopResumeRef.current = true;
          resumeOriginalNavigation().finally(() => {
            temporaryStopResumeRef.current = false;
          });
        }
        return;
      }
      const finishedRoute = originalNavigationRouteRef.current || navigationRoute;
      if (!temporaryStop && navigationStartedAtRef.current > 0 && finishedRoute?.geometry?.coordinates?.length > 1) {
        const feedback = {
          feedbackId: `route-feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          origin: finishedRoute.origin,
          destination: finishedRoute.destination,
          geometry: {
            type: 'LineString',
            coordinates: navigationTraceRef.current.length > 1
              ? navigationTraceRef.current.map((point) => [point.lng, point.lat])
              : finishedRoute.geometry.coordinates
          },
          actualDurationSeconds: Math.max(1, Math.round((Date.now() - navigationStartedAtRef.current) / 1000))
        };
        savePendingRoutePerformance(feedback).then(async () => {
          if (!party.connected) return;
          try {
            await reportRoutePerformance(feedback);
            await removePendingRoutePerformance(feedback.feedbackId);
          } catch { /* Retry when the connection is available again. */ }
        }).catch(() => undefined);
      }
      navigationStartedAtRef.current = 0;
      navigationTraceRef.current = [];
      if (finishedRoute?.origin && finishedRoute?.destination) {
        completedOriginRef.current = { ...finishedRoute.origin };
        setCompletedRoute(finishedRoute);
      }
      stopNavigationVoice();
      voiceHistoryRef.current = {};
      setNavigationLocked(false);
      setNavigationGuidance(null);
      lastTraveledPositionRef.current = null;
      setRouteDisplayEnabled(false);
      setLocalRoute(null);
      // Keep the completed route available so the next action can return to
      // its original origin instead of losing the initial point.
      setPoints({ origin: finishedRoute?.destination || null, destination: null });
      setQuery('');
      setResults([]);
      setActiveKind('destination');
      offRouteReadingsRef.current = 0;
      setMessage('Você chegou ao destino.');
      transitionNavigationState({ type: 'navigation.cancel' });
      party.clearPersonalRoute();
    }
  }, [location.position, navigationActive, navigationRoute, party.clearPersonalRoute, party.connected, temporaryStop]);

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
      if (!returningToApp || !displayedRoute || !location.position) return;
      const position = location.position;
      const maneuver = navigationGuidance?.precisionMode && navigationGuidance.maneuverPoint
        ? navigationGuidance.maneuverPoint
        : null;
      clearTimeout(restoreMapTimerRef.current);
      setMapRefreshKey((current) => current + 1);
      restoreMapTimerRef.current = setTimeout(() => {
        const savedRegion = lastMapRegionRef.current;
        if (savedRegion?.latitudeDelta && savedRegion?.longitudeDelta) {
          mapRef.current?.animateToRegion(savedRegion, 350);
          return;
        }
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
  }, [displayedRoute, location.position, navigationActive, navigationGuidance?.precisionMode, navigationGuidance?.maneuverPoint?.lat, navigationGuidance?.maneuverPoint?.lng]);



  async function setPoint(kind, point, { confirmed = false } = {}) {
    if (routeProfile === 'boat' && point?.source === 'geolocation') {
      const currentOrigin = { lat: point.lat, lng: point.lng, label: 'Minha localização atual', source: 'geolocation' };
      setPoints((current) => ({ ...current, origin: currentOrigin }));
      routeOriginRef.current = currentOrigin;
      setActiveKind('destination');
      savePartyPoints(session.roomId, { ...points, origin: currentOrigin });
      setMessage('Origem náutica atualizada para sua posição GPS.');
      return true;
    }
    if (routeProfile === 'boat' && kind === 'origin') {
      setMessage('No modo barco, a origem é sempre sua posição GPS atual.');
      return false;
    }
    if (navigationActive && navigationLocked && !confirmed) {
      setMessage('Desbloqueie o cadeado para adicionar um desvio à rota.');
      return false;
    }
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
    let currentPosition = location.position || locationPositionRef.current;
    if (!currentPosition && (kind === 'origin' || (kind === 'destination' && !points.origin))) {
      setMessage('Obtendo a posição GPS para definir a rota…');
      currentPosition = await waitForLocationFix();
    }
    if (kind === 'origin') {
      if (!currentPosition) {
        setMessage('Não foi possível obter uma posição GPS válida para definir a origem.');
        return;
      }
      point = {
        lat: currentPosition.lat,
        lng: currentPosition.lng,
        label: 'Minha localização atual',
        source: 'geolocation'
      };
    }
    if (!navigationActive && kind === 'destination') {
      setTemporaryStop(null);
      originalNavigationRouteRef.current = null;
    }
    const currentOrigin = currentPosition ? {
      lat: currentPosition.lat,
      lng: currentPosition.lng,
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
        const requestedRoute = {
          profile: routeProfile,
          origin: next.origin,
          destination: next.destination
        };
        let route;
        try {
          // O traçado local não pode depender da sincronização do socket: a
          // party pode ainda não ter recebido o primeiro GPS do aparelho.
          route = await calculateRoute(next.origin, next.destination, routeProfile);
        } catch (calculateError) {
          // Mantém compatibilidade quando o endpoint HTTP estiver indisponível.
          route = await party.publishRoute(requestedRoute);
          if (!route) throw calculateError;
        }
        // A publicação é complementar; uma recusa por falta de GPS compartilhado
        // não pode apagar a rota pessoal já calculada.
        party.publishRoute(requestedRoute).catch(() => undefined);
        const packageRequestId = ++offlinePackageRequestRef.current;
        const baseOfflinePackage = createOfflineRoutePackage(route);
        // Exibe a rota online imediatamente; a preparação offline não bloqueia
        // o traçado nem o início da navegação.
        setLocalRoute(route);
        routeOriginRef.current = next.origin;
        saveRouteOrigin(next.origin).then(setRouteOrigins);
        setRouteDisplayEnabled(true);
        saveRouteHistory(next.origin, next.destination).then(setRouteHistory).catch(() => undefined);
        savePartySnapshot(session.roomId, { participants: party.participants, route });
        void (async () => {
          let offlineGraph;
          try {
            offlineGraph = (await prepareOfflineGraph({ ...route, offlinePackageId: baseOfflinePackage?.id }))?.graph;
          } catch {
            offlineGraph = null;
          }
          if (packageRequestId !== offlinePackageRequestRef.current) return;
          let offlinePackage = createOfflineRoutePackage({ ...route, offlineGraph }, { id: baseOfflinePackage?.id });
          let offlineReady = offlinePackage && await saveOfflineRoutePackage(offlinePackage);
          if (!offlineReady && offlineGraph) {
            offlinePackage = createOfflineRoutePackage(route, { id: baseOfflinePackage?.id });
            offlineReady = offlinePackage && await saveOfflineRoutePackage(offlinePackage);
          }
          if (offlineReady && packageRequestId === offlinePackageRequestRef.current) {
            const cachedRoute = { ...route, offlinePackageId: offlinePackage.id };
            setLocalRoute(cachedRoute);
            savePartySnapshot(session.roomId, { participants: party.participants, route: cachedRoute });
          }
          // If Overpass was unavailable, the fallback graph above is already
          // usable offline. Retry silently later to enrich it with nearby OSM
          // roads, without delaying or interrupting the active route.
          if (!offlineGraph) {
            for (const delayMs of [15_000, 60_000, 180_000]) {
              await new Promise((resolve) => setTimeout(resolve, delayMs));
              if (packageRequestId !== offlinePackageRequestRef.current) return;
              try {
                offlineGraph = (await prepareOfflineGraph({ ...route, offlinePackageId: baseOfflinePackage?.id }))?.graph;
              } catch {
                offlineGraph = null;
              }
              if (!offlineGraph) continue;
              const enrichedPackage = createOfflineRoutePackage({ ...route, offlineGraph }, { id: baseOfflinePackage?.id });
              if (!enrichedPackage || !await saveOfflineRoutePackage(enrichedPackage)) continue;
              const enrichedRoute = { ...route, offlinePackageId: enrichedPackage.id };
              setLocalRoute(enrichedRoute);
              savePartySnapshot(session.roomId, { participants: party.participants, route: enrichedRoute });
              return;
            }
          }
        })();
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
    searchInputRef.current?.blur();
    Keyboard.dismiss();
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
        const reply = 'Não consegui conectar ao assistente agora. Tente falar novamente ou use um comando de navegação curto.';
        setAssistantReply(reply);
        await speakAssistantText(reply);
        return;
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

  async function useMyLocation() {
    let currentPosition = location.position || locationPositionRef.current;
    if (!currentPosition) {
      setMessage('Obtendo sua posição GPS…');
      currentPosition = await waitForLocationFix();
    }
    if (!currentPosition) return setMessage('Não foi possível obter uma posição GPS válida. Verifique a permissão de localização e tente novamente.');
    await setPoint(activeKind, { lat: currentPosition.lat, lng: currentPosition.lng, label: 'Minha localização', source: 'geolocation' });
    mapRef.current?.animateCamera({
      center: { latitude: currentPosition.lat, longitude: currentPosition.lng },
      zoom: 17,
      heading: cameraHeading(currentPosition, headingRef)
    }, { duration: 500 });
  }

  function selectRouteProfile(profile) {
    const nextProfile = profile === 'boat' ? 'boat' : 'driving';
    if (nextProfile === routeProfile) return;
    setRouteProfile(nextProfile);
    setLocalRoute(null);
    party.clearPersonalRoute();
    setRouteDisplayEnabled(false);
    if (nextProfile === 'boat') {
      setActiveKind('destination');
      if (location.position) {
        const currentOrigin = {
          lat: location.position.lat,
          lng: location.position.lng,
          label: 'Minha localização atual',
          source: 'geolocation'
        };
        setPoints((current) => ({ ...current, origin: currentOrigin }));
        routeOriginRef.current = currentOrigin;
        savePartyPoints(session.roomId, { ...points, origin: currentOrigin });
      }
    }
    setMessage(nextProfile === 'boat'
      ? 'Modo barco selecionado. A origem será sua posição atual; marque apenas o destino.'
      : 'Modo veículo selecionado. As rotas usarão as vias terrestres.');
  }

  async function centerOnMyLocation() {
    let currentPosition = location.position || locationPositionRef.current;
    if (!currentPosition) {
      setMessage('Obtendo sua posição GPS…');
      currentPosition = await waitForLocationFix();
    }
    if (!currentPosition) return setMessage('Não foi possível obter uma posição GPS válida. Verifique a permissão de localização e tente novamente.');
    // Keep the camera centered on the same projected coordinate rendered by
    // the eagle while navigating, not on the raw GPS fix.
    const center = ownMarkerLocation || currentPosition;
    const camera = {
      center: { latitude: center.lat, longitude: center.lng },
      zoom: 17,
      ...(navigationActive ? { heading: cameraHeading(currentPosition, headingRef) } : {})
    };
    mapRef.current?.animateCamera(camera, { duration: 500 });
  }

  function waitForLocationFix(timeoutMs = 30_000) {
    if (location.position || locationPositionRef.current) return Promise.resolve(location.position || locationPositionRef.current);
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (locationPositionRef.current) {
          clearInterval(timer);
          resolve(locationPositionRef.current);
        } else if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, 250);
    });
  }

  async function startNavigation(routeOverride = null) {
    searchInputRef.current?.blur();
    Keyboard.dismiss();
    let currentPosition = location.position || locationPositionRef.current;
    if (!currentPosition) {
      setMessage('Obtendo a posição GPS para iniciar…');
      currentPosition = await waitForLocationFix();
    }
    if (!currentPosition) {
      return setMessage('Não foi possível obter uma posição GPS válida. Verifique a localização do iPhone e tente novamente.');
    }
    const currentOrigin = points.origin || {
      lat: currentPosition.lat,
      lng: currentPosition.lng,
      label: 'Minha localização atual',
      source: 'geolocation'
    };
    const currentDestination = points.destination || routeOverride?.destination || navigationRoute?.destination;
    if (!points.origin && currentDestination) {
      const nextPoints = { ...points, origin: currentOrigin, destination: currentDestination };
      setPoints(nextPoints);
      routeOriginRef.current = currentOrigin;
      savePartyPoints(session.roomId, nextPoints);
    }
    let routeToStart = routeOverride || navigationRoute;
    if (!routeOverride && routeToStart && (routeToStart.profile || 'driving') !== routeProfile) routeToStart = null;
    if (!routeToStart && currentDestination) {
      setLoading(true);
      setMessage('Calculando rota para iniciar a navegação…');
      try {
        routeToStart = await calculateRoute(currentOrigin, currentDestination, routeProfile);
        if (!routeToStart) throw new Error('O serviço não retornou uma rota válida.');
        setLocalRoute(routeToStart);
        savePartyPoints(session.roomId, { origin: currentOrigin, destination: currentDestination });
      } catch (error) {
        setMessage(`Não foi possível calcular a rota: ${error.message}`);
        return;
      } finally {
        setLoading(false);
      }
    }
    if (!routeToStart) return setMessage('Defina origem e destino primeiro.');
    offRouteReadingsRef.current = 0;
    if (!temporaryStop) originalNavigationRouteRef.current = routeToStart;
    routeOriginRef.current = routeToStart.origin || routeOriginRef.current;
    setRouteDisplayEnabled(true);
    traveledMetersRef.current = 0;
    setTraveledMeters(0);
    setDisplaySpeedKmh(0);
    plannedTripMetersRef.current = Number.isFinite(routeToStart.distance) ? routeToStart.distance : 0;
    setPlannedTripMeters(plannedTripMetersRef.current);
    navigationStartedAtRef.current = Date.now();
    navigationTraceRef.current = [currentPosition];
    lastTraveledPositionRef.current = currentPosition;
    setTemporaryStopArmed(false);
    setNavigationLocked(false);
    setNavigationGuidance(buildNavigationGuidance(routeToStart, currentPosition));
    transitionNavigationState({ type: 'navigation.start' });
    setMessage('Navegação iniciada. Siga a linha azul.');
    mapRef.current?.animateCamera({ center: { latitude: currentPosition.lat, longitude: currentPosition.lng }, zoom: 18.5 }, { duration: 500 });
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
      const stopRoute = await calculateRoute(location.position, stop, navigationRoute?.profile || routeProfile);
      party.clearPersonalRoute();
      temporaryStopResumeRef.current = false;
      setTemporaryStop(stop);
      const detourTotal = traveledMetersRef.current + (Number.isFinite(stopRoute?.distance) ? stopRoute.distance : 0);
      if (detourTotal > plannedTripMetersRef.current) {
        plannedTripMetersRef.current = detourTotal;
        setPlannedTripMeters(detourTotal);
      }
      setLocalRoute(stopRoute);
      setPoints({ origin: location.position, destination: stop });
      setTemporaryStopArmed(false);
      setDetourSearchOpen(false);
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
      const route = await calculateRoute(location.position, original.destination, original.profile || routeProfile);
      party.clearPersonalRoute();
      setTemporaryStop(null);
      setLocalRoute(route);
      setRouteDisplayEnabled(true);
      setPoints({ origin: location.position, destination: original.destination });
      setNavigationGuidance(buildNavigationGuidance(route, location.position));
      const resumedTotal = traveledMetersRef.current + (Number.isFinite(route?.distance) ? route.distance : 0);
      if (resumedTotal > plannedTripMetersRef.current) {
        plannedTripMetersRef.current = resumedTotal;
        setPlannedTripMeters(resumedTotal);
      }
      navigationStartedAtRef.current = Date.now();
      navigationTraceRef.current = [location.position];
      lastTraveledPositionRef.current = location.position;
      setTemporaryStopArmed(false);
      transitionNavigationState({ type: 'navigation.start' });
      setMessage('Rota original retomada.');
    } catch (error) {
      setMessage(`NÃ£o foi possÃ­vel retomar a rota original: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function startReturnNavigation() {
    const current = location.position || locationPositionRef.current;
    if (!current) return setMessage('Aguardando uma posição GPS para iniciar a volta.');
    const previous = completedRoute || (completedOriginRef.current ? { origin: completedOriginRef.current } : originalNavigationRouteRef.current);
    const points = buildReturnPoints(previous, current);
    if (!points) return setMessage('O ponto inicial da rota anterior não está disponível.');
    const { origin, destination } = points;
    setLoading(true);
    setMessage('Calculando a rota de volta…');
    try {
      const route = { ...(await calculateRoute(origin, destination, previous?.profile || routeProfile)), origin, destination };
      setLocalRoute(route);
      setPoints({ origin, destination });
      savePartyPoints(session.roomId, { origin, destination });
      setCompletedRoute(null);
      completedOriginRef.current = null;
      originalNavigationRouteRef.current = route;
      routeOriginRef.current = origin;
      setNavigationGuidance(buildNavigationGuidance(route, current));
      setRouteDisplayEnabled(true);
      traveledMetersRef.current = 0;
      setTraveledMeters(0);
      plannedTripMetersRef.current = Number.isFinite(route.distance) ? route.distance : 0;
      setPlannedTripMeters(plannedTripMetersRef.current);
      navigationStartedAtRef.current = Date.now();
      navigationTraceRef.current = [current];
      lastTraveledPositionRef.current = current;
      setTemporaryStopArmed(false);
      transitionNavigationState({ type: 'navigation.start' });
      setMessage('Rota de volta iniciada.');
    } catch (error) {
      setMessage(`Não foi possível calcular a rota de volta: ${error.message}`);
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
    setTemporaryStopArmed(false);
    temporaryStopResumeRef.current = false;
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
                  profile: routeProfile,
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
      const fixedOrigin = originalNavigationRouteRef.current?.origin
      || routeOriginRef.current
      || points.origin
      || navigationRoute.origin;
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
    const fixedOrigin = originalNavigationRouteRef.current?.origin
      || routeOriginRef.current
      || points.origin
      || navigationRoute.origin;
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
        profile: navigationRoute?.profile || routeProfile,
        origin,
        destination,
        routeOrigin: fixedOrigin
      }, 'personal');
      const route = { ...calculatedRoute, origin: fixedOrigin, destination };
      setLocalRoute(route);
      routeOriginRef.current = fixedOrigin;
      if (originalNavigationRouteRef.current) {
        originalNavigationRouteRef.current = {
          ...originalNavigationRouteRef.current,
          origin: fixedOrigin,
          destination
        };
      }
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
      const result = await party.sendEmergencyPacket(packet, { message: 'SOS — preciso de ajuda', location: location.position });
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

  function toggleNavigationMessageRecipient(participantId) {
    setNavigationMessageSelection((current) => {
      const next = new Set(current);
      if (next.has(participantId)) next.delete(participantId);
      else next.add(participantId);
      return next;
    });
  }

  function toggleAllNavigationMessageRecipients(participants) {
    setNavigationMessageSelection((current) => current.size === participants.length
      ? new Set()
      : new Set(participants.map((participant) => participant.id)));
  }

  async function sendNavigationMessage() {
    const text = navigationMessageDraft.trim();
    const participants = party.participants.filter((item) => item.id !== ownParticipantId);
    const targetIds = [...navigationMessageSelection].filter((id) => participants.some((item) => item.id === id));
    if (!text || !targetIds.length || navigationMessageSending) return;
    setNavigationMessageSending(true);
    try {
      const results = await Promise.allSettled(targetIds.map((id) => party.sendDirectMessage(id, text)));
      const failed = results.filter((result) => result.status === 'rejected').length;
      if (failed) setMessage(`Mensagem enviada para ${targetIds.length - failed} participante(s); ${failed} falha(s).`);
      else setMessage(`Mensagem enviada para ${targetIds.length} participante(s).`);
      if (!failed) {
        setNavigationMessageDraft('');
        setNavigationMessageSelection(new Set());
        setNavigationMessageMenuOpen(false);
      }
    } finally {
      setNavigationMessageSending(false);
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

  function saveAttentionPoint(type, point) {
    const trackId = recognitionTrackRef.current?.id;
    if (!trackId || !point) return setMessage('Aguarde o primeiro ponto GPS do percurso.');
    const locationPoint = { ...point, userName: session.name };
    addRecognitionAttention(trackId, locationPoint, type).then((item) => {
      if (!item) return;
      setAttentionPoints((current) => [...current, item]);
      const reusablePlace = {
        id: `attention:${item.id}`,
        name: `Ponto: ${type}`,
        label: `Ponto: ${type} · ${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}`,
        lat: item.lat,
        lng: item.lng,
        source: 'saved'
      };
      saveFavoritePlace(reusablePlace).then(setFavorites).catch(() => undefined);
      setMessage(`Ponto marcado e salvo nos locais para usar como destino: ${type}.`);
    }).catch(() => setMessage('Não foi possível salvar o ponto.'));
  }

  function chooseAttentionPoint(point = location.position) {
    if (!point) return setMessage('Aguardando uma posição do GPS.');
    Alert.alert('Marcar ponto de atenção', 'O que existe neste local?', [
      { text: 'Buraco', onPress: () => saveAttentionPoint('buraco', point) },
      { text: 'Casa/construção', onPress: () => saveAttentionPoint('casa', point) },
      { text: 'Estrada não mapeada', onPress: () => saveAttentionPoint('estrada-nao-mapeada', point) },
      { text: 'Outro', onPress: () => saveAttentionPoint('outro', point) },
      { text: 'Cancelar', style: 'cancel' }
    ]);
  }

  function openNavigationMapMenu(point) {
    if (navigationLocked) return;
    Alert.alert('Ponto no mapa', 'Escolha o que deseja fazer neste local.', [
      {
        text: 'Marcar desvio',
        onPress: () => {
          setTemporaryStopArmed(true);
          addTemporaryStop(point).catch((error) => setMessage(`Não foi possível adicionar o desvio: ${error.message}`));
        }
      },
      {
        text: 'Procurar End. Desvio',
        onPress: () => {
          setActiveKind('destination');
          setDetourSearchOpen(true);
          setQuery('');
          setResults([]);
          setShowSavedPlaces(false);
          setMessage('Digite o endereço do desvio e selecione o resultado. A rota passará pelo desvio e manterá o destino original.');
          setTimeout(() => searchInputRef.current?.focus?.(), 100);
        }
      },
      { text: 'Marcar ponto de atenção', onPress: () => chooseAttentionPoint(point) },
      { text: 'Cancelar', style: 'cancel' }
    ]);
  }

  async function publishRecognitionTrack() {
    const trackId = recognitionTrackRef.current?.id;
    if (!trackId) return setMessage('O registro ainda não foi iniciado.');
    try {
      const track = await loadRecognitionTrack(trackId);
      if (!track || track.points.length < 2) return setMessage('Registre pelo menos dois pontos GPS antes de publicar.');
      const compactPoints = track.points.length > 1200 ? track.points.filter((_point, index) => index % Math.ceil(track.points.length / 1200) === 0) : track.points;
      const payload = { trackId: track.id, userName: track.userName, startedAt: track.startedAt, endedAt: Date.now(), points: compactPoints, attentionPoints: track.attentionPoints };
      await savePendingRecognitionTrack(payload);
      if (!party.connected) return setMessage('Percurso salvo no aparelho. Será publicado quando a conexão voltar.');
      await party.publishExplorationTrack(payload);
      await removePendingRecognitionTrack(payload.trackId);
      await Share.share({ message: `AGUIA-PERCURSO:v1\n${JSON.stringify(payload)}` });
      setMessage(`Percurso publicado com ${compactPoints.length} pontos e ${track.attentionPoints.length} marcações.`);
    } catch (error) { setMessage(error.message || 'Não foi possível publicar o percurso.'); }
  }

  useEffect(() => {
    if (!party.connected || !party.joined) return undefined;
    let active = true;
    loadPendingRecognitionTracks().then(async (pending) => {
      for (const payload of pending) {
        if (!active) return;
        try {
          await party.publishExplorationTrack(payload);
          await removePendingRecognitionTrack(payload.trackId);
          if (active) setMessage(`Percurso offline publicado: ${payload.points.length} pontos.`);
        } catch { break; }
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [party.connected, party.joined, party.publishExplorationTrack]);

  useEffect(() => {
    if (!party.connected || !party.joined) return undefined;
    let active = true;
    loadPendingRoutePerformance().then(async (pending) => {
      for (const feedback of pending) {
        if (!active) return;
        try {
          await reportRoutePerformance(feedback);
          await removePendingRoutePerformance(feedback.feedbackId);
        } catch { break; }
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [party.connected, party.joined]);

  const routeCoordinates = useMemo(() => {
    const coordinates = displayedRoute?.geometry?.coordinates;
    if (!Array.isArray(coordinates)) return [];
    return coordinates
      .filter((coordinate) => Array.isArray(coordinate)
        && coordinate.length >= 2
        && Number.isFinite(Number(coordinate[0]))
        && Number.isFinite(Number(coordinate[1])))
      .map(([longitude, latitude]) => ({ latitude: Number(latitude), longitude: Number(longitude) }));
  }, [displayedRoute]);
  const recognitionCoordinates = useMemo(() => recognitionPoints.map((point) => ({ latitude: point.lat, longitude: point.lng })), [recognitionPoints]);
  const receivedRecognitionTracks = party.explorationTracks || [];
  const clusteredPois = useMemo(() => clusterPois(pois, visibleRegion, {
    width: viewport.width,
    height: Math.max(1, viewport.height * 0.6)
  }), [pois, visibleRegion, viewport.height, viewport.width]);
  const favoriteIds = useMemo(() => new Set(favorites.map((place) => place.storageId)), [favorites]);
  const recentWithoutFavorites = useMemo(() => recentPlaces.filter((place) => !favoriteIds.has(place.storageId)), [favoriteIds, recentPlaces]);
  const progressPercent = Math.round((navigationGuidance?.progress || 0) * 100);
  const trafficSummary = navigationRoute?.traffic?.status === 'congestion' ? ' · trânsito colaborativo' : '';
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
        key={mapRefreshKey}
        ref={mapRef}
        style={styles.map}
        initialRegion={lastMapRegionRef.current}
         provider={Platform.OS === 'ios' ? PROVIDER_DEFAULT : undefined}
         mapType={Platform.OS === 'android' ? 'none' : 'standard'}
         minZoomLevel={2}
        maxZoomLevel={19}
         zoomEnabled
        rotateEnabled
        pitchEnabled={false}
        showsCompass={false}
        showsUserLocation={false}
        showsPointsOfInterest={false}
         onRegionChangeComplete={(region, details) => {
           lastMapRegionRef.current = region;
           if (navigationActive) {
             navigationZoomRef.current = zoomFromRegion(region, navigationZoomRef.current || 18.5);
             if (details?.isGesture) {
               navigationCameraGestureUntilRef.current = Date.now() + 1200;
               const previous = lastNavigationCameraRef.current;
               lastNavigationCameraRef.current = {
                 latitude: region.latitude,
                 longitude: region.longitude,
                 heading: previous?.heading ?? null
               };
             }
           }
           setVisibleRegion(region);
         }}
        onLongPress={(event) => {
          if (navigationLocked) return;
          const { latitude: lat, longitude: lng } = event.nativeEvent.coordinate;
          const point = { lat, lng, timestamp: Date.now(), accuracy: 0, label: 'Ponto selecionado no mapa', source: 'map' };
          if (navigationActive) openNavigationMapMenu(point);
          else chooseAttentionPoint(point);
        }}
        onPress={(event) => {
          if (navigationLocked) return;
          if (navigationActive) return;
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
          const pointKind = navigationActive || routeProfile === 'boat' ? 'destination' : activeKind;
          if (navigationActive && !temporaryStopArmed) {
            setMessage('Toque em “Adicionar desvio” com o cadeado aberto antes de marcar o ponto.');
            return;
          }
          setPoint(pointKind, { lat, lng, label: 'Ponto selecionado no mapa', source: 'map' });
          if (navigationActive) setTemporaryStopArmed(false);
        }}
      >
        {Platform.OS === 'android' && <>
          <UrlTile key={`online:${mapStyle}:${mapRefreshKey}`} urlTemplate={MAP_TILE_TEMPLATES[mapStyle]} maximumZ={19} minimumZ={1} zIndex={-1} />
          {mapStyle === 'simple' && offlineTileTemplate && <UrlTile
            key={`offline:${offlineTileTemplate}:${mapRefreshKey}`}
            urlTemplate={offlineTileTemplate}
            maximumZ={17}
            minimumZ={11}
            zIndex={0}
          />}
        </>}
        {recognitionCoordinates.length > 1 && <Polyline coordinates={recognitionCoordinates} strokeColor="#16a34a" strokeWidth={4} lineDashPattern={[8, 5]} />}
        {receivedRecognitionTracks.filter((track) => track.trackId !== recognitionTrack?.id).map((track) => <Polyline key={`exploration:${track.trackId}`} coordinates={track.points.map((point) => ({ latitude: point.lat, longitude: point.lng }))} strokeColor="#7c3aed" strokeWidth={4} lineDashPattern={[10, 6]} />)}
        {routeCoordinates.length > 1 && <Polyline coordinates={routeCoordinates} strokeColor="#ffffff" strokeWidth={9} />}
        {routeCoordinates.length > 1 && <Polyline coordinates={routeCoordinates} strokeColor="#2563eb" strokeWidth={6} />}

        {attentionPoints.map((point) => <Marker key={point.id} coordinate={{ latitude: point.lat, longitude: point.lng }} title={point.type} description={point.note || `Marcado por ${point.userName || session.name}`} tracksViewChanges={false}>
          <View style={styles.attentionMarker}><Text style={styles.attentionMarkerText}>!</Text></View>
        </Marker>)}
        {receivedRecognitionTracks.filter((track) => track.trackId !== recognitionTrack?.id).flatMap((track) => (track.attentionPoints || []).map((point) => <Marker key={`remote-attention:${track.trackId}:${point.id}`} coordinate={{ latitude: point.lat, longitude: point.lng }} title={point.type} description={point.note || `Percurso de ${track.userName}`} tracksViewChanges={false}>
          <View style={[styles.attentionMarker, styles.remoteAttentionMarker]}><Text style={styles.attentionMarkerText}>!</Text></View>
        </Marker>))}

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
             coordinate={markerCoordinate(ownMarkerLocation, ownParticipantId, party.participants, true)}
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
             coordinate={markerCoordinate(item.location, item.id, party.participants)}
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
      {navigationActive && <View
        pointerEvents="box-only"
        {...speedBubbleResponder.panHandlers}
        accessibilityLabel={`Velocidade atual ${formatSpeedValue(location.position)} quilômetros por hora. Segure e arraste para reposicionar.`}
        style={[styles.speedBubble, { left: speedBubbleCustomizedRef.current ? speedBubblePosition.left : defaultSpeedBubbleLeft, top: speedBubblePosition.top }]}
      >
        <Text style={styles.speedBubbleValue}>{Number.isFinite(displaySpeedKmh) ? String(Math.round(displaySpeedKmh)) : '0'}</Text>
        <Text style={styles.speedBubbleUnit}>km/h</Text>
      </View>}
      {navigationActive && <View style={[styles.navigationCard, navigationGuidance?.offRoute && styles.navigationCardOffRoute, { minHeight: 86, padding: 9 }]}>
        <View style={styles.navigationCardText}>
           <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.navigationTraveled}>Distância percorrida: {Number.isFinite(traveledMeters) ? formatDistance(traveledMeters) : '--'} / {Number.isFinite(plannedTripMeters) && plannedTripMeters > 0 ? formatDistance(plannedTripMeters) : '--'}</Text>
          {!!party.personalRoute && <Text accessibilityLabel="Navegação usando rota pessoal" style={styles.personalRouteBadge}>ROTA PESSOAL</Text>}
          <Text style={styles.navigationEyebrow}>{navigationGuidance?.precisionMode ? 'DETALHE DA MANOBRA' : navigationGuidance?.hasSteps && Number.isFinite(navigationGuidance.instructionDistance) ? `${navigationGuidance.instructionDistance < 12 ? 'AGORA' : `EM ${formatDistance(navigationGuidance.instructionDistance).toUpperCase()}`}` : 'NAVEGANDO'}</Text>
          <Text accessibilityLiveRegion="polite" numberOfLines={2} style={styles.navigationInstruction}>{navigationGuidance?.instruction || 'Calculando próxima orientação…'}</Text>
          <Text style={styles.navigationEta}>{navigationGuidance ? `${formatDistance(navigationGuidance.remainingMeters)} restantes · aprox. ${formatDuration(navigationGuidance.remainingSeconds)}` : 'Calculando progresso e chegada…'}</Text>
          <View accessibilityRole="progressbar" accessibilityLabel="Progresso da rota" accessibilityValue={{ min: 0, max: 100, now: progressPercent, text: `${progressPercent}% concluído` }} style={styles.navigationProgressTrack}>
            <View style={[styles.navigationProgressFill, { width: `${progressPercent}%` }]} />
          </View>
           {(() => {
             const messageParticipants = party.participants.filter((item) => item.id !== ownParticipantId);
             const allMessageParticipantsSelected = messageParticipants.length > 0 && navigationMessageSelection.size === messageParticipants.length;
             return <View style={styles.navigationMessageArea}>
               <Pressable accessibilityRole="button" accessibilityLabel="Enviar mensagem" onPress={() => setNavigationMessageMenuOpen((open) => !open)} style={styles.navigationMessageButton}>
                 <Text style={styles.navigationMessageButtonText}>Enviar mensagem</Text>
               </Pressable>
               {navigationMessageMenuOpen && <View style={styles.navigationMessageMenu}>
                 <Text style={styles.navigationMessageTitle}>Destinatários</Text>
                 {!messageParticipants.length && <Text style={styles.navigationMessageEmpty}>Nenhum participante disponível.</Text>}
                 {!!messageParticipants.length && <Pressable onPress={() => toggleAllNavigationMessageRecipients(messageParticipants)} style={styles.navigationMessageOption}>
                   <Text style={styles.navigationMessageCheck}>{allMessageParticipantsSelected ? '✓' : '○'}</Text>
                   <Text numberOfLines={1} style={styles.navigationMessageOptionText}>Todos</Text>
                 </Pressable>}
                 <ScrollView style={styles.navigationMessageList} nestedScrollEnabled>
                   {messageParticipants.map((item) => {
                     const selected = navigationMessageSelection.has(item.id);
                     return <Pressable key={item.id} onPress={() => toggleNavigationMessageRecipient(item.id)} style={styles.navigationMessageOption}>
                       <Text style={styles.navigationMessageCheck}>{selected ? '✓' : '○'}</Text>
                       <Text numberOfLines={1} style={styles.navigationMessageOptionText}>{item.name}</Text>
                     </Pressable>;
                   })}
                 </ScrollView>
                 {!!navigationMessageSelection.size && <View style={styles.navigationMessageCompose}>
                   <TextInput value={navigationMessageDraft} onChangeText={setNavigationMessageDraft} onSubmitEditing={sendNavigationMessage} placeholder="Mensagem" maxLength={500} returnKeyType="send" style={styles.navigationMessageInput} />
                   <Pressable onPress={sendNavigationMessage} disabled={navigationMessageSending || !navigationMessageDraft.trim()} style={[styles.navigationMessageSend, (navigationMessageSending || !navigationMessageDraft.trim()) && styles.disabled]}>
                     <Text style={styles.navigationMessageSendText}>{navigationMessageSending ? '...' : 'Enviar'}</Text>
                   </Pressable>
                 </View>}
               </View>}
             </View>;
           })()}
           {!navigationActive && directRecipient && <View style={styles.navigationDirectRow}>
            <Text numberOfLines={1} style={styles.navigationDirectTarget}>{directRecipient.name}</Text>
            <TextInput
              value={directDraft}
              onChangeText={setDirectDraft}
              onSubmitEditing={sendDirectMessage}
              placeholder="Mensagem"
              maxLength={500}
              returnKeyType="send"
              style={styles.navigationDirectInput}
            />
            <Pressable onPress={sendDirectMessage} disabled={directSending || !directDraft.trim()} style={[styles.navigationDirectButton, (directSending || !directDraft.trim()) && styles.disabled]}>
              <Text style={styles.navigationDirectButtonText}>{directSending ? '...' : 'Enviar'}</Text>
            </Pressable>
            <Pressable accessibilityLabel="Fechar mensagem" onPress={() => { setDirectRecipient(null); setDirectDraft(''); }} style={styles.navigationDirectClose}>
              <Text style={styles.navigationDirectCloseText}>×</Text>
            </Pressable>
          </View>}
        </View>
        <View style={styles.navigationActions}>
          {navigationGuidance?.offRoute && <>
            <Text style={styles.offRouteText}>{Number.isFinite(navigationGuidance.offRouteDistance) ? `${formatDistance(navigationGuidance.offRouteDistance)} fora da rota` : 'Fora da rota'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Recalcular rota a partir da localização atual" accessibilityState={{ disabled: navigationLocked || recalculating || !party.joined || !party.connected, busy: recalculating }} disabled={navigationLocked || recalculating || !party.joined || !party.connected} onPress={recalculateRoute} style={[styles.recalculateButton, (navigationLocked || recalculating || !party.joined || !party.connected) && styles.disabled]}>
              <Text style={styles.recalculateButtonText}>{recalculating ? 'Recalculando…' : 'Recalcular'}</Text>
            </Pressable>
          </>}
          {!navigationLocked && <Pressable accessibilityRole="button" accessibilityLabel="Adicionar desvio temporário à rota" onPress={() => { setTemporaryStopArmed(true); setMessage('Desvio ativado. Toque e segure no mapa para escolher a ação.'); }} style={styles.detourButton}>
            <Text style={styles.detourButtonText}>{temporaryStopArmed ? 'Segure no mapa' : 'Adicionar desvio'}</Text>
          </Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="Centralizar posição atual" onPress={centerOnMyLocation} style={styles.centerNavigation}><Text numberOfLines={2} style={styles.centerNavigationText}>Centra{`\n`}lizar</Text></Pressable>
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
      <View pointerEvents={navigationActive && !detourSearchOpen ? 'none' : 'box-none'} style={[styles.mapControls, navigationActive && !detourSearchOpen && styles.navigationMapControls]}>
        <View style={styles.floatingSearch}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            ref={searchInputRef}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setShowSavedPlaces(true)}
            onSubmitEditing={() => { Keyboard.dismiss(); search(); }}
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
         {utilityMenuOpen && <View style={styles.utilityMenu}>
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Estilo do mapa: ${mapStyle === 'simple' ? 'simples' : 'detalhado'}. Toque para alternar.`}
          onPress={() => setMapStyle((current) => current === 'simple' ? 'detailed' : 'simple')}
          style={styles.mapStyleToggle}
        >
          <Text style={styles.mapStyleToggleText}>Mapa: {mapStyle === 'simple' ? 'Simples' : 'Detalhado'}</Text>
        </Pressable>
        <View style={styles.recognitionRow}>
          <Text style={styles.recognitionText}>Percurso: {recognitionPoints.length} GPS · {attentionPoints.length} pontos</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Marcar ponto de atenção no local atual" onPress={() => chooseAttentionPoint()} style={styles.recognitionButton}><Text style={styles.recognitionButtonText}>Marcar</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Publicar percurso e pontos" onPress={publishRecognitionTrack} style={styles.recognitionPublishButton}><Text style={styles.recognitionButtonText}>Publicar</Text></Pressable>
        </View>
         </View>}
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
        {utilityMenuOpen && <View style={styles.utilityMenu}>
          <Text style={styles.routeProfileTitle}>Tipo de deslocamento</Text>
          <View style={styles.routeProfileRow}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: routeProfile === 'driving' }} onPress={() => selectRouteProfile('driving')} style={[styles.routeProfileButton, routeProfile === 'driving' && styles.routeProfileButtonActive]}>
              <Text style={[styles.routeProfileText, routeProfile === 'driving' && styles.routeProfileTextActive]}>Veículo</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: routeProfile === 'boat' }} onPress={() => selectRouteProfile('boat')} style={[styles.routeProfileButton, routeProfile === 'boat' && styles.routeProfileButtonActive]}>
              <Text style={[styles.routeProfileText, routeProfile === 'boat' && styles.routeProfileTextActive]}>Barco</Text>
            </Pressable>
          </View>
          {routeProfile === 'boat' && <Text style={styles.routeProfileHint}>A origem é o GPS atual. Use dois toques no mapa para marcar apenas o destino.</Text>}
        {!navigationActive && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryList}>
          {POI_CATEGORIES.map((category) => {
            const active = activeCategories.includes(category.id);
            return <Pressable key={category.id} onPress={() => toggleCategory(category.id)} style={[styles.categoryChip, active && styles.categoryChipActive]}>
              <Text style={styles.categoryIcon}>{category.icon}</Text><Text style={[styles.categoryText, active && styles.categoryTextActive]}>{category.label}</Text>
            </Pressable>;
          })}
          <View style={styles.poiStatus}><Text numberOfLines={1} style={styles.poiStatusText}>{poiLoading ? 'Carregando…' : poiMessage}</Text></View>
        </ScrollView>}
        </View>}
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

    {!navigationActive && <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={8}>
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
        <View style={[styles.sharingRow, styles.hidden]}>
          <View style={[styles.sharingDot, !party.locationSharingEnabled && styles.sharingDotPaused]} />
          <Text style={styles.sharingText}>{party.locationSharingEnabled ? 'Sua localização está sendo compartilhada' : 'Compartilhamento de localização pausado'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${party.locationSharingEnabled ? 'Pausar' : 'Retomar'} compartilhamento de localização`} accessibilityState={{ checked: party.locationSharingEnabled }} onPress={toggleLocationSharing} style={({ pressed }) => [styles.sharingButton, !party.locationSharingEnabled && styles.sharingButtonResume, pressed && styles.pressed]}>
            <Text style={[styles.sharingButtonText, !party.locationSharingEnabled && styles.sharingButtonTextResume]}>{party.locationSharingEnabled ? 'Pausar' : 'Retomar'}</Text>
          </Pressable>
        </View>
        <Text style={styles.message}>Toque no nome de um participante para autorizar ou bloquear a rota dele neste aparelho.</Text>

        {!navigationActive && <View style={styles.segment}>
          {routeProfile !== 'boat' && <Pressable onPress={() => setActiveKind('origin')} style={[styles.segmentButton, activeKind === 'origin' && styles.originActive]}><Text style={[styles.segmentText, activeKind === 'origin' && styles.activeText]}>Origem</Text></Pressable>}
          {routeProfile === 'boat' && <View style={styles.boatOriginBadge}><Text style={styles.boatOriginText}>Origem: GPS atual</Text></View>}
          <Pressable onPress={() => setActiveKind('destination')} style={[styles.segmentButton, activeKind === 'destination' && styles.destinationActive]}><Text style={[styles.segmentText, activeKind === 'destination' && styles.activeText]}>Destino</Text></Pressable>
           <Pressable onPress={useMyLocation} style={styles.locationButton}><Text style={styles.locationText}>Meu local</Text></Pressable>
           <Pressable accessibilityRole="button" accessibilityLabel={utilityMenuOpen ? 'Fechar opções adicionais' : 'Abrir opções adicionais'} accessibilityState={{ expanded: utilityMenuOpen }} onPress={() => setUtilityMenuOpen((open) => !open)} style={[styles.utilityMenuButton, utilityMenuOpen && styles.utilityMenuButtonActive]}><Text style={styles.utilityMenuButtonText}>{utilityMenuOpen ? '−' : '+'}</Text></Pressable>
        </View>}

        {party.route && <Text style={styles.routeSummary}>{formatDistance(party.route.distance)} · {formatDuration(party.route.duration)}{party.route.updatedBy?.name ? ` · por ${party.route.updatedBy.name}` : ''}{party.offline ? ' · rota em cache' : ''}{trafficSummary}</Text>}
        <View style={styles.actionRow}>
          {!navigationActive && temporaryStop && originalNavigationRouteRef.current?.destination && <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retomar destino original após a parada"
            accessibilityState={{ disabled: loading, busy: loading }}
            disabled={loading}
            onPress={resumeOriginalNavigation}
            style={[styles.startNavigation, loading && styles.disabled]}
          >
            <Text maxFontSizeMultiplier={1.1} style={styles.startNavigationText}>{loading ? 'Calculando rota…' : 'Retomar destino original'}</Text>
          </Pressable>}
          {!navigationActive && canReturnToOrigin && <Pressable
            accessibilityRole="button"
            accessibilityLabel="Iniciar rota de volta ao ponto inicial"
            accessibilityState={{ disabled: loading, busy: loading }}
            disabled={loading}
            onPress={startReturnNavigation}
            style={[styles.startNavigation, loading && styles.disabled]}
          >
            <Text maxFontSizeMultiplier={1.1} style={styles.startNavigationText}>{loading ? 'Calculando rota…' : 'Voltar ao início'}</Text>
          </Pressable>}
          {!navigationActive && <Pressable
            accessibilityRole="button"
            accessibilityLabel={navigationRoute || (points.origin && points.destination) ? 'Iniciar navegação' : 'Iniciar navegação, aguardando origem e destino'}
            accessibilityState={{ disabled: loading, busy: loading }}
            disabled={loading}
            onPress={startNavigation}
            style={[styles.startNavigation, loading && styles.disabled]}
          >
            <Text maxFontSizeMultiplier={1.1} style={styles.startNavigationText}>{loading ? 'Calculando rota…' : navigationRoute ? 'Iniciar rota' : 'Calcular e iniciar'}</Text>
          </Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="Enviar SOS criptografado" accessibilityState={{ disabled: sosSending, busy: sosSending }} disabled={sosSending} onPress={sendSos} style={[styles.sosButton, (!navigationRoute || navigationActive) && styles.sosButtonSolo, sosSending && styles.disabled]}>
            <Text maxFontSizeMultiplier={1.1} style={styles.sosButtonText}>{sosSending ? 'Enviando...' : 'SOS'}</Text>
          </Pressable>
          <View style={styles.sharingInline}>
            <View style={[styles.sharingDot, !party.locationSharingEnabled && styles.sharingDotPaused]} />
            <Text numberOfLines={1} style={styles.sharingText}>{party.locationSharingEnabled ? 'Posição ativa' : 'Posição pausada'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`${party.locationSharingEnabled ? 'Pausar' : 'Retomar'} compartilhamento de localização`} onPress={toggleLocationSharing} style={({ pressed }) => [styles.sharingButton, !party.locationSharingEnabled && styles.sharingButtonResume, pressed && styles.pressed]}>
              <Text style={[styles.sharingButtonText, !party.locationSharingEnabled && styles.sharingButtonTextResume]}>{party.locationSharingEnabled ? 'Pausar' : 'Retomar'}</Text>
            </Pressable>
          </View>
        </View>
        <Text accessibilityLiveRegion="polite" numberOfLines={2} style={[styles.message, (party.error || message || party.offline || !party.locationSharingEnabled) && styles.warning]}>{party.error || message || (party.offline ? 'Sem conexão. Posições antigas aparecem como estimadas.' : location.status)}</Text>
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
  headerMicButton: { display: 'none' },
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
  navigationActions: { width: 82, alignItems: 'stretch', gap: 5 }, offRouteText: { color: '#fecdd3', fontSize: 9, lineHeight: 12, fontWeight: '800', textAlign: 'center' }, recalculateButton: { minHeight: 40, paddingHorizontal: 6, borderRadius: 9, backgroundColor: '#e11d48', alignItems: 'center', justifyContent: 'center' }, recalculateButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' }, detourButton: { minHeight: 34, paddingHorizontal: 5, borderRadius: 9, backgroundColor: '#0ea5e9', alignItems: 'center', justifyContent: 'center' }, detourButtonText: { color: '#fff', fontSize: 9, fontWeight: '900', textAlign: 'center' },
  stopNavigation: { minHeight: 33, paddingHorizontal: 6, borderRadius: 9, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, stopNavigationText: { color: '#0f172a', fontSize: 10, fontWeight: '900' }, centerNavigation: { width: 62, minHeight: 36, paddingHorizontal: 0, borderRadius: 9, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' }, centerNavigationText: { color: '#1d4ed8', fontSize: 11, lineHeight: 12, fontWeight: '900', textAlign: 'center', includeFontPadding: false },
  floatingSearch: { minHeight: 50, paddingHorizontal: 13, borderRadius: 25, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', shadowColor: '#0f172a', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  assistantRow: { minHeight: 43, marginTop: 7, paddingHorizontal: 10, borderRadius: 22, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', flexDirection: 'row', alignItems: 'center' }, assistantIcon: { color: '#2563eb', fontSize: 16, marginRight: 6 }, assistantInput: { flex: 1, height: 40, color: '#0f172a', fontSize: 11 }, assistantMicButton: { width: 32, height: 32, marginLeft: 4, borderRadius: 16, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' }, assistantMicButtonActive: { backgroundColor: '#fecaca' }, assistantMicText: { color: '#1d4ed8', fontSize: 14 }, assistantButton: { minHeight: 31, paddingHorizontal: 9, borderRadius: 15, backgroundColor: '#2563eb', alignItems: 'center', justifyContent: 'center' }, assistantButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' }, assistantReply: { marginTop: 5, paddingHorizontal: 10, color: '#1e3a8a', fontSize: 10, fontWeight: '700' },
  searchIcon: { color: '#475569', fontSize: 24, marginRight: 8 }, floatingInput: { flex: 1, height: 48, color: '#0f172a', fontSize: 15 },
  clearSearchButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, clearSearch: { color: '#64748b', fontSize: 25, lineHeight: 28 }, floatingSearchButton: { color: '#1a73e8', fontSize: 13, fontWeight: '800', paddingVertical: 12 },
  mapStyleOptions: { alignSelf: 'flex-start', flexDirection: 'row', marginTop: 7, padding: 3, borderRadius: 17, backgroundColor: 'rgba(15, 23, 42, 0.86)', gap: 3 }, mapStyleToggle: { alignSelf: 'flex-start', marginTop: 6, minHeight: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: 'rgba(15, 23, 42, 0.86)', justifyContent: 'center' }, mapStyleToggleText: { color: '#e2e8f0', fontSize: 10, fontWeight: '800' }, recognitionRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, padding: 6, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.95)' }, recognitionText: { flex: 1, color: '#334155', fontSize: 10, fontWeight: '800' }, recognitionButton: { minHeight: 28, paddingHorizontal: 9, borderRadius: 8, backgroundColor: '#fef3c7', alignItems: 'center', justifyContent: 'center' }, recognitionPublishButton: { minHeight: 28, paddingHorizontal: 9, borderRadius: 8, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' }, recognitionButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' }, attentionMarker: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#dc2626', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }, remoteAttentionMarker: { backgroundColor: '#7c3aed' }, attentionMarkerText: { color: '#fff', fontSize: 15, fontWeight: '900' },
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
  sharingRow: { minHeight: 46, marginBottom: 9, paddingLeft: 10, paddingRight: 4, borderRadius: 12, backgroundColor: '#f8fafc', flexDirection: 'row', alignItems: 'center', gap: 8 }, sharingInline: { flex: 1, minHeight: 36, paddingHorizontal: 7, borderRadius: 10, backgroundColor: '#f8fafc', flexDirection: 'row', alignItems: 'center', gap: 5 }, hidden: { display: 'none' },
  permissionWarning: { minHeight: 46, marginBottom: 8, paddingLeft: 10, paddingRight: 4, borderRadius: 12, backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa', flexDirection: 'row', alignItems: 'center', gap: 8 }, permissionWarningText: { flex: 1, color: '#9a3412', fontSize: 10, fontWeight: '800' }, permissionWarningButton: { minHeight: 36, paddingHorizontal: 11, borderRadius: 9, backgroundColor: '#ea580c', alignItems: 'center', justifyContent: 'center' }, permissionWarningButtonText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  sharingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#16a34a' }, sharingDotPaused: { backgroundColor: '#f59e0b' }, sharingText: { flex: 1, color: '#475569', fontSize: 10, fontWeight: '700' },
  sharingButton: { minWidth: 72, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' }, sharingButtonResume: { backgroundColor: '#dcfce7' }, sharingButtonText: { color: '#b91c1c', fontSize: 11, fontWeight: '900' }, sharingButtonTextResume: { color: '#166534' },
  segment: { flexDirection: 'row', gap: 7, marginBottom: 9 }, segmentButton: { flex: 1, minHeight: 40, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' }, boatOriginBadge: { flex: 1, minHeight: 40, paddingHorizontal: 8, borderRadius: 10, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center' }, boatOriginText: { color: '#166534', fontSize: 10, fontWeight: '900', textAlign: 'center' },
  originActive: { backgroundColor: '#16a34a' }, destinationActive: { backgroundColor: '#dc2626' }, segmentText: { color: '#334155', fontSize: 13, fontWeight: '700' }, activeText: { color: '#fff' },
  locationButton: { minHeight: 40, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' }, locationText: { color: '#1d4ed8', fontSize: 12, fontWeight: '700' }, utilityMenuButton: { width: 40, minHeight: 40, borderRadius: 10, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }, utilityMenuButtonActive: { backgroundColor: '#dbeafe' }, utilityMenuButtonText: { color: '#1e40af', fontSize: 25, lineHeight: 28, fontWeight: '700' }, utilityMenu: { marginBottom: 8, padding: 8, borderRadius: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' }, routeProfileTitle: { color: '#334155', fontSize: 10, fontWeight: '900', marginBottom: 5 }, routeProfileRow: { flexDirection: 'row', gap: 6, marginBottom: 5 }, routeProfileButton: { minHeight: 32, flex: 1, borderRadius: 8, backgroundColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }, routeProfileButtonActive: { backgroundColor: '#1d4ed8' }, routeProfileText: { color: '#334155', fontSize: 11, fontWeight: '900' }, routeProfileTextActive: { color: '#fff' }, routeProfileHint: { color: '#64748b', fontSize: 9, lineHeight: 12, marginBottom: 5 },
  result: { padding: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#cbd5e1' }, resultText: { color: '#334155', fontSize: 12, lineHeight: 17 }, disabled: { opacity: 0.45 },
  routeSummary: { marginTop: 7, color: '#1e40af', fontSize: 11, fontWeight: '800' }, actionRow: { flexDirection: 'row', gap: 6, marginTop: 8 }, startNavigation: { flex: 1, minHeight: 38, borderRadius: 10, backgroundColor: '#1a73e8', alignItems: 'center', justifyContent: 'center' }, startNavigationText: { color: '#fff', fontSize: 12, fontWeight: '900' }, sosButton: { width: 52, minWidth: 52, minHeight: 36, borderRadius: 9, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' }, sosButtonSolo: { width: 60 }, sosButtonText: { color: '#fff', fontSize: 12, fontWeight: '900' }, message: { marginTop: 6, color: '#64748b', fontSize: 10 }, warning: { color: '#b45309' },
  attribution: { marginTop: 5, color: '#64748b', fontSize: 9, textDecorationLine: 'underline' },
  pressed: { opacity: 0.72 },
  personalRouteBadge: { display: 'none' }, navigationEyebrow: { display: 'none' },
  navigationCardText: { flex: 1, position: 'relative' }, navigationTraveled: { color: '#fff', fontSize: 12, lineHeight: 15, fontWeight: '900', marginBottom: 3, flexShrink: 0 },
  navigationPeopleRow: { gap: 5, paddingTop: 5, paddingRight: 4 }, navigationPersonButton: { maxWidth: 120, minHeight: 24, paddingHorizontal: 7, borderRadius: 7, backgroundColor: '#334155', justifyContent: 'center' }, navigationPersonButtonActive: { backgroundColor: '#0284c7' }, navigationPersonText: { color: '#e2e8f0', fontSize: 9, fontWeight: '800' }, navigationDirectRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 5 }, navigationDirectTarget: { maxWidth: 70, color: '#bae6fd', fontSize: 9, fontWeight: '800' }, navigationDirectInput: { flex: 1, minHeight: 27, paddingHorizontal: 6, borderRadius: 6, backgroundColor: '#fff', color: '#0f172a', fontSize: 10 }, navigationDirectButton: { minHeight: 27, paddingHorizontal: 7, borderRadius: 6, backgroundColor: '#0284c7', alignItems: 'center', justifyContent: 'center' }, navigationDirectButtonText: { color: '#fff', fontSize: 9, fontWeight: '900' }, navigationDirectClose: { paddingHorizontal: 2 }, navigationDirectCloseText: { color: '#bae6fd', fontSize: 18 }, navigationMessageArea: { position: 'relative', marginTop: 5, zIndex: 60 }, navigationMessageButton: { alignSelf: 'flex-start', minHeight: 24, paddingHorizontal: 8, borderRadius: 7, backgroundColor: '#334155', justifyContent: 'center' }, navigationMessageButtonText: { color: '#e2e8f0', fontSize: 9, fontWeight: '900' }, navigationMessageMenu: { position: 'absolute', left: 0, right: 0, bottom: 29, padding: 7, borderRadius: 8, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#475569', zIndex: 70, elevation: 12 }, navigationMessageTitle: { color: '#bae6fd', fontSize: 9, fontWeight: '900', marginBottom: 3 }, navigationMessageEmpty: { color: '#cbd5e1', fontSize: 9, paddingVertical: 4 }, navigationMessageList: { maxHeight: 110 }, navigationMessageOption: { minHeight: 24, flexDirection: 'row', alignItems: 'center', paddingVertical: 2 }, navigationMessageCheck: { width: 20, color: '#7dd3fc', fontSize: 14, fontWeight: '900', textAlign: 'center' }, navigationMessageOptionText: { flex: 1, color: '#f8fafc', fontSize: 10, fontWeight: '700' }, navigationMessageCompose: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 }, navigationMessageInput: { flex: 1, minHeight: 28, paddingHorizontal: 7, borderRadius: 6, backgroundColor: '#fff', color: '#0f172a', fontSize: 10 }, navigationMessageSend: { minHeight: 28, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#0284c7', alignItems: 'center', justifyContent: 'center' }, navigationMessageSendText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  navigationEta: { color: '#a9b8ca', fontSize: 10, marginTop: 3, paddingRight: '42%' },
  navigationProgressTrack: { position: 'absolute', right: 0, bottom: 0, width: '38%', height: 4, marginTop: 0, borderRadius: 2, overflow: 'hidden', backgroundColor: '#334155' },
  centerNavigationText: { color: '#1d4ed8', fontSize: 11, lineHeight: 12, fontWeight: '900', textAlign: 'center', includeFontPadding: false }
});
