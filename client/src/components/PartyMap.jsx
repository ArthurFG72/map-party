import L from 'leaflet';
import { useEffect } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';

const vehicleMarkerIcon = L.icon({
  iconUrl: '/vehicle-marker.svg',
  iconSize: [22, 29],
  iconAnchor: [11, 14],
  popupAnchor: [0, -14]
});

function ClickHandler({ mode, onPick }) {
  useMapEvents({ click: (event) => mode && onPick({ lat: event.latlng.lat, lng: event.latlng.lng }) });
  return null;
}

function FitRoute({ route }) {
  const map = useMap();
  useEffect(() => {
    if (!route?.geometry) return;
    const bounds = L.geoJSON(route.geometry).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [map, route]);
  return null;
}

function FocusPoint({ point }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.flyTo([point.lat, point.lng], Math.max(map.getZoom(), 14));
  }, [map, point]);
  return null;
}

function ageLabel(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'agora';
  if (seconds < 60) return `há ${seconds}s`;
  return `há ${Math.round(seconds / 60)} min`;
}

export default function PartyMap({ participants, route, points, focusPoint, selectionMode, onPick }) {
  return <MapContainer center={[-14.2, -51.9]} zoom={4} className={selectionMode ? 'cursor-crosshair' : ''}>
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    />
    <ClickHandler mode={selectionMode} onPick={onPick} />
    <FitRoute route={route} />
    <FocusPoint point={focusPoint} />
    {route?.geometry && <GeoJSON key={route.revision || route.updatedAt} data={route.geometry} style={{ color: '#2563eb', weight: 6, opacity: 0.8 }} />}
    {points.origin && <CircleMarker center={[points.origin.lat, points.origin.lng]} radius={8} pathOptions={{ color: 'white', weight: 3, fillColor: '#16a34a', fillOpacity: 1 }}><Tooltip permanent direction="top">Origem</Tooltip></CircleMarker>}
    {points.destination && <CircleMarker center={[points.destination.lat, points.destination.lng]} radius={8} pathOptions={{ color: 'white', weight: 3, fillColor: '#dc2626', fillOpacity: 1 }}><Tooltip permanent direction="top">Destino</Tooltip></CircleMarker>}
    {participants.filter((item) => item.location).map((item) => <Marker
      key={item.id} position={[item.location.lat, item.location.lng]} icon={vehicleMarkerIcon}
    >
      <Tooltip direction="bottom" offset={[0, 10]}>{item.name}</Tooltip>
      <Popup><strong>{item.name}</strong><br />Precisão: {Math.round(item.location.accuracy)} m<br />Atualizado {ageLabel(item.location.timestamp)}</Popup>
    </Marker>)}
  </MapContainer>;
}
