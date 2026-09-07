import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { calculateRoute, searchPlaces, searchPois } from '../api';
import { useLocationSharing } from '../hooks/useLocationSharing';
import { useParty } from '../hooks/useParty';
import { buildNavigationGuidance } from '../navigationGuidance';
import { loadFavoritePlaces, loadPartyPoints, loadRecentPlaces, placeStorageId, removeFavoritePlace, saveFavoritePlace, savePartyPoints, saveRecentPlace } from '../offlineStore';
import { buildParticipantRouteStatus } from '../partyNavigation';
import { clusterAccessibilityLabel, clusterPois } from '../poiClustering';

const INITIAL_REGION = { latitude: -14.2, longitude: -51.9, latitudeDelta: 35, longitudeDelta: 35 };
const POI_CATEGORIES = [
  { id: 'restaurant', label: 'Restaurantes', icon: '🍴', color: '#ea4335' },
  { id: 'fuel', label: 'Postos', icon: '⛽', color: '#1a73e8' }
];

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

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
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
  const title = result.name || parts.shift() || 'Local sem nome';
  const address = result.address || parts.join(', ') || 'Endereço não informado';
  const distanceMeters = Number.isFinite(result.distanceMeters)
    ? result.distanceMeters
    : currentLocation ? distanceBetween(currentLocation, result) : null;
  const distance = Number.isFinite(distanceMeters)
    ? `${formatDistance(distanceMeters)} de você`
    : 'Distância indisponível';
  return { title, address, distance };
}

function distanceBetween(first, second) {
  if (!first || !second) return 0;
  const latitude = (second.lat - first.lat) * Math.PI / 180;
  const longitude = (second.lng - first.lng) * Math.PI / 180;
  const a = Math.sin(latitude / 2) ** 2
    + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function PartyScreen({ session, onLeave }) {
  const mapRef = useRef(null);
  const viewport = useWindowDimensions();
  const party = useParty(session.roomId, session.name);
  const location = useLocationSharing({ enabled: true, onLocation: party.sendLocation });
  const [points, setPoints] = useState({ origin: null, destination: null });
  const [activeKind, setActiveKind] = useState('origin');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [recentPlaces, setRecentPlaces] = useState([]);
  const [showSavedPlaces, setShowSavedPlaces] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [visibleRegion, setVisibleRegion] = useState(INITIAL_REGION);
  const [activeCategories, setActiveCategories] = useState(POI_CATEGORIES.map((item) => item.id));
  const [pois, setPois] = useState([]);
  const [poiLoading, setPoiLoading] = useState(false);
  const [poiMessage, setPoiMessage] = useState('Aproxime o mapa para ver locais próximos.');
  const [selectedPoi, setSelectedPoi] = useState(null);
  const [navigationActive, setNavigationActive] = useState(false);
  const [navigationGuidance, setNavigationGuidance] = useState(null);
  const [recalculating, setRecalculating] = useState(false);
  const poiRequestRef = useRef(0);
  const didCenterUserRef = useRef(false);
  const offRouteReadingsRef = useRef(0);
  const categoryKey = activeCategories.join(',');
  const navigationRoute = party.personalRoute || party.route;
  const displayedRoute = navigationActive ? navigationRoute : party.route;
  const participantStatuses = useMemo(() => new Map(party.participants.map((participant) => [
    participant.id,
    buildParticipantRouteStatus(
      participant,
      participant.id === party.participantId && party.personalRoute ? party.personalRoute : party.route
    )
  ])), [party.participantId, party.participants, party.personalRoute, party.route]);

  useEffect(() => {
    loadPartyPoints(session.roomId).then((cached) => {
      if (cached) setPoints(cached);
    });
  }, [session.roomId]);

  useEffect(() => {
    let active = true;
    Promise.all([loadFavoritePlaces(), loadRecentPlaces()]).then(([savedFavorites, savedRecentPlaces]) => {
      if (!active) return;
      setFavorites(savedFavorites);
      setRecentPlaces(savedRecentPlaces);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!party.route) return;
    setPoints({ origin: party.route.origin, destination: party.route.destination });
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
  }, [visibleRegion, categoryKey]);

  useEffect(() => {
    if (!location.position || party.route || didCenterUserRef.current) return;
    didCenterUserRef.current = true;
    mapRef.current?.animateToRegion({
      latitude: location.position.lat,
      longitude: location.position.lng,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04
    }, 650);
  }, [location.position, party.route]);

  useEffect(() => {
    if (!navigationActive || !location.position || !navigationRoute?.destination) return;
    const nextGuidance = buildNavigationGuidance(navigationRoute, location.position);
    if (!nextGuidance) return;
    offRouteReadingsRef.current = nextGuidance.offRoute ? offRouteReadingsRef.current + 1 : 0;
    setNavigationGuidance({
      ...nextGuidance,
      offRoute: nextGuidance.offRoute && offRouteReadingsRef.current >= 2
    });
    mapRef.current?.animateToRegion({
      latitude: location.position.lat,
      longitude: location.position.lng,
      latitudeDelta: 0.018,
      longitudeDelta: 0.018
    }, 450);
    if (nextGuidance.arrived) {
      setMessage('Você chegou ao destino.');
      setNavigationActive(false);
      party.clearPersonalRoute();
    }
  }, [location.position, navigationActive, navigationRoute, party.clearPersonalRoute]);

  async function setPoint(kind, point) {
    const next = { ...points, [kind]: point };
    setPoints(next);
    savePartyPoints(session.roomId, next);
    setResults([]);
    setQuery('');
    setShowSavedPlaces(false);
    if (point.source === 'search' || point.source === 'saved') {
      saveRecentPlace(point).then(setRecentPlaces);
    }
    setActiveKind(kind === 'origin' ? 'destination' : 'origin');
    mapRef.current?.animateToRegion({ latitude: point.lat, longitude: point.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 500);
    if (next.origin && next.destination) {
      setLoading(true);
      setMessage('Calculando rota…');
      try {
        const route = await calculateRoute(next.origin, next.destination);
        await party.publishRoute(route);
        setMessage('Rota compartilhada.');
      } catch (error) {
        setMessage(error.message);
      } finally {
        setLoading(false);
      }
    }
  }

  async function search() {
    if (!party.joined) return setMessage('Aguarde a conexão com a party para buscar lugares.');
    if (query.trim().length < 3) return setMessage('Digite pelo menos 3 caracteres.');
    setLoading(true);
    setMessage('Buscando…');
    try {
      const body = await searchPlaces(query, visibleRegion, location.position);
      setResults(body.results || []);
      setMessage(body.results?.length ? '' : 'Nenhum lugar encontrado.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function useMyLocation() {
    if (!location.position) return setMessage('Aguardando uma posição do GPS.');
    setPoint(activeKind, { lat: location.position.lat, lng: location.position.lng, label: 'Minha localização', source: 'geolocation' });
  }

  function centerOnMyLocation() {
    if (!location.position) return setMessage('Aguardando uma posição do GPS.');
    mapRef.current?.animateToRegion({ latitude: location.position.lat, longitude: location.position.lng, latitudeDelta: 0.015, longitudeDelta: 0.015 }, 500);
  }

  function startNavigation() {
    if (!navigationRoute) return setMessage('Defina origem e destino primeiro.');
    if (!location.position) return setMessage('Aguardando uma posição do GPS para iniciar.');
    offRouteReadingsRef.current = 0;
    setNavigationGuidance(buildNavigationGuidance(navigationRoute, location.position));
    setNavigationActive(true);
    setMessage('Navegação iniciada. Siga a linha azul.');
    mapRef.current?.animateToRegion({ latitude: location.position.lat, longitude: location.position.lng, latitudeDelta: 0.018, longitudeDelta: 0.018 }, 500);
  }

  function stopNavigation() {
    setNavigationActive(false);
    offRouteReadingsRef.current = 0;
    party.clearPersonalRoute();
    setMessage('Navegação pausada.');
  }

  function toggleLocationSharing() {
    const nextEnabled = !party.locationSharingEnabled;
    party.setLocationSharing(nextEnabled);
    if (nextEnabled && location.position) party.sendLocation(location.position);
    setMessage(nextEnabled ? 'Compartilhamento de localização retomado.' : 'Compartilhamento de localização pausado. O GPS continua disponível neste aparelho.');
  }

  async function recalculateRoute() {
    if (!party.joined) return setMessage('Aguarde a reconexão para recalcular a rota.');
    if (!location.position || !party.route?.destination) return setMessage('Localização ou destino indisponível para recálculo.');
    const origin = {
      lat: location.position.lat,
      lng: location.position.lng,
      label: 'Minha localização atual',
      source: 'geolocation'
    };
    const destination = party.route.destination;
    setRecalculating(true);
    setMessage('Recalculando rota…');
    try {
      const route = await calculateRoute(origin, destination);
      await party.publishRoute(route, 'personal');
      const nextPoints = { origin, destination };
      setPoints(nextPoints);
      savePartyPoints(session.roomId, nextPoints);
      offRouteReadingsRef.current = 0;
      setNavigationGuidance(buildNavigationGuidance(route, location.position));
      setMessage('Rota recalculada e compartilhada.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setRecalculating(false);
    }
  }

  async function shareParty() {
    await Share.share({ message: `Entre na minha Map Party com o código: ${session.roomId}` });
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

  const routeCoordinates = displayedRoute?.geometry?.coordinates?.map(([longitude, latitude]) => ({ latitude, longitude })) || [];
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

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <View style={styles.headerText}>
        <Text style={styles.title}>Map Party <Text style={styles.titleDot}>•</Text> <Text style={[styles.liveText, { color: connection.color }]}>{connection.label}</Text></Text>
        <Text numberOfLines={1} style={styles.room}>{party.participants.length} participante{party.participants.length === 1 ? '' : 's'} · {session.roomId}</Text>
      </View>
      <View accessibilityLabel={`Estado da conexão: ${connection.label.toLocaleLowerCase('pt-BR')}`} style={[styles.statusDot, { backgroundColor: connection.color }]} />
      <Pressable accessibilityRole="button" accessibilityLabel="Compartilhar party" onPress={shareParty} style={styles.headerButton}><Text style={styles.headerButtonText}>Convidar</Text></Pressable>
      <Pressable onPress={onLeave} style={styles.leaveButton}><Text style={styles.leaveText}>Sair</Text></Pressable>
    </View>
    {!!connection.message && <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.connectionBanner}>
      <View style={[styles.connectionBannerDot, { backgroundColor: connection.color }]} />
      <Text style={styles.connectionBannerText}>{connection.message}</Text>
    </View>}

    <View style={styles.mapArea}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={INITIAL_REGION}
        showsUserLocation={!!location.position}
        showsPointsOfInterest={false}
        onRegionChangeComplete={setVisibleRegion}
        onPress={(event) => {
          setSelectedPoi(null);
          setShowSavedPlaces(false);
          const { latitude: lat, longitude: lng } = event.nativeEvent.coordinate;
          setPoint(activeKind, { lat, lng, label: 'Ponto selecionado no mapa', source: 'map' });
        }}
      >
        {routeCoordinates.length > 1 && <Polyline coordinates={routeCoordinates} strokeColor="#ffffff" strokeWidth={9} />}
        {routeCoordinates.length > 1 && <Polyline coordinates={routeCoordinates} strokeColor="#2563eb" strokeWidth={6} />}

        {clusteredPois.map((marker) => {
          if (marker.type === 'cluster') return <Marker
            key={marker.id}
            coordinate={marker.coordinate}
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

        {points.origin && <Marker coordinate={{ latitude: points.origin.lat, longitude: points.origin.lng }} anchor={{ x: 0.5, y: 1 }} title="Origem" description={points.origin.label}>
          <MapPin color="#16a34a" label="A" />
        </Marker>}
        {points.destination && <Marker coordinate={{ latitude: points.destination.lat, longitude: points.destination.lng }} anchor={{ x: 0.5, y: 1 }} title="Destino" description={points.destination.label}>
          <MapPin color="#dc2626" label="B" />
        </Marker>}
        {party.participants.filter((item) => item.location).map((item) => {
          const statusText = participantStatusText(participantStatuses.get(item.id));
          return <Marker
            key={item.id}
            coordinate={{ latitude: item.location.lat, longitude: item.location.lng }}
            title={item.name}
            description={`${statusText}${item.location.estimated ? ' · posição estimada' : ''}`}
            accessibilityLabel={`${item.name}, ${statusText}${item.location.estimated ? ', posição estimada' : ''}`}
          >
            <View style={[styles.personMarker, { backgroundColor: item.color, opacity: item.location.estimated ? 0.58 : 1 }]}>
              <Text style={styles.personMarkerText}>{item.name.slice(0, 1).toUpperCase()}</Text>
            </View>
          </Marker>;
        })}
      </MapView>
      {navigationActive && <View style={[styles.navigationCard, navigationGuidance?.offRoute && styles.navigationCardOffRoute]}>
        <View style={styles.navigationCardText}>
          {!!party.personalRoute && <Text accessibilityLabel="Navegação usando rota pessoal" style={styles.personalRouteBadge}>ROTA PESSOAL</Text>}
          <Text style={styles.navigationEyebrow}>{navigationGuidance?.hasSteps && Number.isFinite(navigationGuidance.instructionDistance) ? `${navigationGuidance.instructionDistance < 12 ? 'AGORA' : `EM ${formatDistance(navigationGuidance.instructionDistance).toUpperCase()}`}` : 'NAVEGANDO'}</Text>
          <Text accessibilityLiveRegion="polite" numberOfLines={2} style={styles.navigationInstruction}>{navigationGuidance?.instruction || 'Calculando próxima orientação…'}</Text>
          <Text style={styles.navigationEta}>{navigationGuidance ? `${formatDistance(navigationGuidance.remainingMeters)} restantes · aprox. ${formatDuration(navigationGuidance.remainingSeconds)}` : 'Calculando progresso e chegada…'}</Text>
          <View accessibilityRole="progressbar" accessibilityLabel="Progresso da rota" accessibilityValue={{ min: 0, max: 100, now: progressPercent, text: `${progressPercent}% concluído` }} style={styles.navigationProgressTrack}>
            <View style={[styles.navigationProgressFill, { width: `${progressPercent}%` }]} />
          </View>
        </View>
        <View style={styles.navigationActions}>
          {navigationGuidance?.offRoute && <>
            <Text style={styles.offRouteText}>{Number.isFinite(navigationGuidance.offRouteDistance) ? `${formatDistance(navigationGuidance.offRouteDistance)} fora da rota` : 'Fora da rota'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Recalcular rota a partir da localização atual" accessibilityState={{ disabled: recalculating || !party.joined, busy: recalculating }} disabled={recalculating || !party.joined} onPress={recalculateRoute} style={[styles.recalculateButton, (recalculating || !party.joined) && styles.disabled]}>
              <Text style={styles.recalculateButtonText}>{recalculating ? 'Recalculando…' : 'Recalcular'}</Text>
            </Pressable>
          </>}
          <Pressable accessibilityRole="button" accessibilityLabel="Parar navegação" onPress={stopNavigation} style={styles.stopNavigation}><Text style={styles.stopNavigationText}>Parar</Text></Pressable>
        </View>
      </View>}
      <View pointerEvents="box-none" style={styles.mapControls}>
        <View style={styles.floatingSearch}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setShowSavedPlaces(true)}
            onSubmitEditing={search}
            placeholder={`Buscar ${activeKind === 'origin' ? 'origem' : 'destino'}`}
            accessibilityLabel="Buscar lugar"
            accessibilityHint="Digite ao menos três caracteres e toque em Buscar"
            returnKeyType="search"
            style={styles.floatingInput}
          />
          {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Limpar busca" onPress={() => { setQuery(''); setResults([]); setShowSavedPlaces(true); }} style={styles.clearSearchButton}><Text style={styles.clearSearch}>×</Text></Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="Buscar lugares" accessibilityState={{ disabled: loading || !party.joined, busy: loading }} disabled={loading || !party.joined} onPress={search} style={(loading || !party.joined) && styles.disabled}><Text style={styles.floatingSearchButton}>{loading ? '…' : 'Buscar'}</Text></Pressable>
        </View>
        {query.trim().length > 0 && results.length > 0 && <ScrollView style={styles.floatingResults} keyboardShouldPersistTaps="handled">
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
                  <Text style={[styles.favoriteButtonText, favorite && styles.favoriteButtonTextActive]}>{favorite ? '★' : '☆'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${details.title} como origem`} onPress={() => setPoint('origin', point)} style={({ pressed }) => [styles.resultOriginButton, pressed && styles.pressed]}>
                  <Text style={styles.resultOriginText}>Usar como origem</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${details.title} como destino`} onPress={() => setPoint('destination', point)} style={({ pressed }) => [styles.resultDestinationButton, pressed && styles.pressed]}>
                  <Text style={styles.resultDestinationText}>Usar como destino</Text>
                </Pressable>
              </View>
            </View>;
          })}
        </ScrollView>}
        {showSavedPlaces && !query.trim() && (favorites.length > 0 || recentWithoutFavorites.length > 0) && <ScrollView style={styles.floatingResults} keyboardShouldPersistTaps="handled">
          {favorites.length > 0 && <Text style={styles.resultsCount}>Favoritos</Text>}
          {favorites.map((place) => {
            const details = searchResultDetails(place, location.position);
            return <View key={`favorite:${place.storageId}`} style={styles.savedPlaceRow}>
              <View style={styles.savedPlaceText}><Text numberOfLines={1} style={styles.resultTitle}>{details.title}</Text><Text numberOfLines={1} style={styles.resultAddress}>{details.address} · {details.distance}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${details.title} como origem`} onPress={() => setPoint('origin', { ...place, source: 'saved' })} style={styles.savedOriginButton}><Text style={styles.savedOriginText}>A</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${details.title} como destino`} onPress={() => setPoint('destination', { ...place, source: 'saved' })} style={styles.savedDestinationButton}><Text style={styles.savedDestinationText}>B</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remover ${details.title} dos favoritos`} onPress={() => toggleFavorite(place)} style={styles.savedFavoriteButton}><Text style={styles.savedFavoriteText}>★</Text></Pressable>
            </View>;
          })}
          {recentWithoutFavorites.length > 0 && <Text style={styles.resultsCount}>Recentes</Text>}
          {recentWithoutFavorites.map((place) => {
            const details = searchResultDetails(place, location.position);
            return <View key={`recent:${place.storageId}`} style={styles.savedPlaceRow}>
              <View style={styles.savedPlaceText}><Text numberOfLines={1} style={styles.resultTitle}>{details.title}</Text><Text numberOfLines={1} style={styles.resultAddress}>{details.address} · {details.distance}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${details.title} como origem`} onPress={() => setPoint('origin', { ...place, source: 'saved' })} style={styles.savedOriginButton}><Text style={styles.savedOriginText}>A</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Usar ${details.title} como destino`} onPress={() => setPoint('destination', { ...place, source: 'saved' })} style={styles.savedDestinationButton}><Text style={styles.savedDestinationText}>B</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Adicionar ${details.title} aos favoritos`} onPress={() => toggleFavorite(place)} style={styles.savedFavoriteButton}><Text style={styles.savedFavoriteText}>☆</Text></Pressable>
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
        <Pressable accessibilityRole="button" accessibilityLabel={`${favoriteIds.has(placeStorageId(selectedPoi)) ? 'Remover' : 'Adicionar'} ${selectedPoi.name} ${favoriteIds.has(placeStorageId(selectedPoi)) ? 'dos' : 'aos'} favoritos`} accessibilityState={{ selected: favoriteIds.has(placeStorageId(selectedPoi)) }} onPress={() => toggleFavorite({ ...selectedPoi, label: selectedPoi.address ? `${selectedPoi.name}, ${selectedPoi.address}` : selectedPoi.name, source: 'search' })} style={styles.poiFavoriteButton}><Text style={styles.poiFavoriteText}>{favoriteIds.has(placeStorageId(selectedPoi)) ? '★' : '☆'}</Text></Pressable>
        <Pressable onPress={() => usePoi('origin', selectedPoi)} style={styles.poiSecondaryButton}><Text style={styles.poiSecondaryText}>Origem</Text></Pressable>
        <Pressable onPress={() => usePoi('destination', selectedPoi)} style={styles.poiRouteButton}><Text style={styles.poiRouteText}>Rotas</Text></Pressable>
      </View>}
      <Pressable accessibilityLabel="Centralizar na minha localização" onPress={centerOnMyLocation} style={({ pressed }) => [styles.recenterButton, pressed && styles.pressed]}>
        <Text style={styles.recenterIcon}>◎</Text>
      </Pressable>
    </View>

    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
      <View style={styles.panel}>
        <View style={styles.panelHandle} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.people}>
          <Text style={styles.peopleCount}>{party.participants.length} participante{party.participants.length === 1 ? '' : 's'}</Text>
          {party.participants.map((item) => {
            const statusText = participantStatusText(participantStatuses.get(item.id));
            return <View key={item.id} accessibilityLabel={`${item.name}, ${statusText}`} style={styles.personChip}>
              <View style={[styles.personDot, { backgroundColor: item.color }]} />
              <View><Text style={styles.personName}>{item.name}</Text><Text style={styles.personMeta}>{statusText}</Text></View>
            </View>;
          })}
        </ScrollView>

        <View style={styles.sharingRow}>
          <View style={[styles.sharingDot, !party.locationSharingEnabled && styles.sharingDotPaused]} />
          <Text style={styles.sharingText}>{party.locationSharingEnabled ? 'Sua localização está sendo compartilhada' : 'Compartilhamento de localização pausado'}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${party.locationSharingEnabled ? 'Pausar' : 'Retomar'} compartilhamento de localização`} accessibilityState={{ checked: party.locationSharingEnabled }} onPress={toggleLocationSharing} style={({ pressed }) => [styles.sharingButton, !party.locationSharingEnabled && styles.sharingButtonResume, pressed && styles.pressed]}>
            <Text style={[styles.sharingButtonText, !party.locationSharingEnabled && styles.sharingButtonTextResume]}>{party.locationSharingEnabled ? 'Pausar' : 'Retomar'}</Text>
          </Pressable>
        </View>

        {!navigationActive && <View style={styles.segment}>
          <Pressable onPress={() => setActiveKind('origin')} style={[styles.segmentButton, activeKind === 'origin' && styles.originActive]}><Text style={[styles.segmentText, activeKind === 'origin' && styles.activeText]}>Origem</Text></Pressable>
          <Pressable onPress={() => setActiveKind('destination')} style={[styles.segmentButton, activeKind === 'destination' && styles.destinationActive]}><Text style={[styles.segmentText, activeKind === 'destination' && styles.activeText]}>Destino</Text></Pressable>
          <Pressable onPress={useMyLocation} style={styles.locationButton}><Text style={styles.locationText}>Meu local</Text></Pressable>
        </View>}

        {party.route && <Text style={styles.routeSummary}>{formatDistance(party.route.distance)} · {formatDuration(party.route.duration)}{party.route.updatedBy?.name ? ` · por ${party.route.updatedBy.name}` : ''}{party.offline ? ' · rota em cache' : ''}</Text>}
        {party.route && !navigationActive && <Pressable onPress={startNavigation} style={styles.startNavigation}><Text style={styles.startNavigationText}>Iniciar rota</Text></Pressable>}
        <Text accessibilityLiveRegion="polite" numberOfLines={2} style={[styles.message, (party.error || message || party.offline || !party.locationSharingEnabled) && styles.warning]}>{party.error || message || (party.offline ? 'Sem conexção. Posições antigas aparecem como estimadas.' : party.locationSharingEnabled ? location.status : 'Compartilhamento pausado; o GPS permanece disponível localmente.')}</Text>
        <Text onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright')} style={styles.attribution}>Busca: © contribuidores OpenStreetMap · rotas: OSRM</Text>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f172a' },
  header: { minHeight: 66, paddingHorizontal: 14, backgroundColor: '#0b172a', flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { flex: 1 }, title: { color: '#fff', fontSize: 18, fontWeight: '900' }, titleDot: { color: '#b9f227' }, liveText: { color: '#b9f227', fontSize: 9, letterSpacing: 1, fontWeight: '900' }, room: { color: '#8ea0b9', fontSize: 11, marginTop: 2 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  headerButton: { minHeight: 38, paddingHorizontal: 11, borderRadius: 12, justifyContent: 'center', backgroundColor: '#1a73e8' },
  headerButtonText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  leaveButton: { minHeight: 38, paddingHorizontal: 8, justifyContent: 'center' }, leaveText: { color: '#ff9b9b', fontSize: 12, fontWeight: '800' },
  connectionBanner: { minHeight: 38, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fff7ed', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#fed7aa', flexDirection: 'row', alignItems: 'center' },
  connectionBannerDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 }, connectionBannerText: { flex: 1, color: '#9a3412', fontSize: 12, fontWeight: '700' },
  mapArea: { flex: 1 }, map: { flex: 1 },
  mapControls: { position: 'absolute', top: 12, left: 12, right: 12 },
  navigationCard: { position: 'absolute', top: 78, left: 12, right: 12, minHeight: 104, padding: 12, borderRadius: 16, borderLeftWidth: 4, borderLeftColor: '#b9f227', backgroundColor: '#0b172a', flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: '#0f172a', shadowOpacity: 0.28, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 7, zIndex: 5 },
  navigationCardOffRoute: { borderLeftColor: '#fb7185' }, navigationCardText: { flex: 1 }, personalRouteBadge: { alignSelf: 'flex-start', marginBottom: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', backgroundColor: '#dbeafe', color: '#1d4ed8', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 }, navigationEyebrow: { color: '#b9f227', fontSize: 10, fontWeight: '900', letterSpacing: 1 }, navigationInstruction: { color: '#fff', fontSize: 17, lineHeight: 21, fontWeight: '900', marginTop: 2 }, navigationEta: { color: '#a9b8ca', fontSize: 11, marginTop: 4 },
  navigationProgressTrack: { height: 4, marginTop: 8, borderRadius: 2, overflow: 'hidden', backgroundColor: '#334155' }, navigationProgressFill: { height: 4, borderRadius: 2, backgroundColor: '#b9f227' },
  navigationActions: { width: 96, alignItems: 'stretch', gap: 6 }, offRouteText: { color: '#fecdd3', fontSize: 9, lineHeight: 12, fontWeight: '800', textAlign: 'center' }, recalculateButton: { minHeight: 44, paddingHorizontal: 8, borderRadius: 11, backgroundColor: '#e11d48', alignItems: 'center', justifyContent: 'center' }, recalculateButtonText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  stopNavigation: { minHeight: 40, paddingHorizontal: 10, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, stopNavigationText: { color: '#0f172a', fontSize: 12, fontWeight: '900' },
  floatingSearch: { minHeight: 50, paddingHorizontal: 13, borderRadius: 25, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', shadowColor: '#0f172a', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  searchIcon: { color: '#475569', fontSize: 24, marginRight: 8 }, floatingInput: { flex: 1, height: 48, color: '#0f172a', fontSize: 15 },
  clearSearchButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, clearSearch: { color: '#64748b', fontSize: 25, lineHeight: 28 }, floatingSearchButton: { color: '#1a73e8', fontSize: 13, fontWeight: '800', paddingVertical: 12 },
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
  personMarker: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#0f172a', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  personMarkerText: { color: '#fff', fontSize: 12, fontWeight: '900' },
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
  people: { alignItems: 'center', gap: 8, paddingBottom: 9 }, peopleCount: { color: '#475569', fontSize: 11, fontWeight: '700' },
  personChip: { minHeight: 44, flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 5 },
  personDot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 }, personName: { fontSize: 11, color: '#334155', fontWeight: '800' }, personMeta: { marginTop: 1, color: '#64748b', fontSize: 9 },
  sharingRow: { minHeight: 46, marginBottom: 9, paddingLeft: 10, paddingRight: 4, borderRadius: 12, backgroundColor: '#f8fafc', flexDirection: 'row', alignItems: 'center', gap: 8 },
  sharingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#16a34a' }, sharingDotPaused: { backgroundColor: '#f59e0b' }, sharingText: { flex: 1, color: '#475569', fontSize: 10, fontWeight: '700' },
  sharingButton: { minWidth: 72, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' }, sharingButtonResume: { backgroundColor: '#dcfce7' }, sharingButtonText: { color: '#b91c1c', fontSize: 11, fontWeight: '900' }, sharingButtonTextResume: { color: '#166534' },
  segment: { flexDirection: 'row', gap: 7, marginBottom: 9 }, segmentButton: { flex: 1, minHeight: 40, borderRadius: 10, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  originActive: { backgroundColor: '#16a34a' }, destinationActive: { backgroundColor: '#dc2626' }, segmentText: { color: '#334155', fontSize: 13, fontWeight: '700' }, activeText: { color: '#fff' },
  locationButton: { minHeight: 40, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#dbeafe', alignItems: 'center', justifyContent: 'center' }, locationText: { color: '#1d4ed8', fontSize: 12, fontWeight: '700' },
  result: { padding: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#cbd5e1' }, resultText: { color: '#334155', fontSize: 12, lineHeight: 17 }, disabled: { opacity: 0.45 },
  routeSummary: { marginTop: 8, color: '#1e40af', fontSize: 13, fontWeight: '800' }, startNavigation: { marginTop: 8, minHeight: 42, borderRadius: 11, backgroundColor: '#1a73e8', alignItems: 'center', justifyContent: 'center' }, startNavigationText: { color: '#fff', fontSize: 14, fontWeight: '900' }, message: { marginTop: 6, color: '#64748b', fontSize: 11 }, warning: { color: '#b45309' },
  attribution: { marginTop: 5, color: '#64748b', fontSize: 9, textDecorationLine: 'underline' },
  pressed: { opacity: 0.72 }
});
