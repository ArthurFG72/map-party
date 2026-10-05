export function buildReturnPoints(completedRoute, currentPosition) {
  const destination = completedRoute?.origin;
  if (!destination || !currentPosition) return null;
  return {
    origin: { lat: currentPosition.lat, lng: currentPosition.lng, label: 'Minha localização atual', source: 'geolocation' },
    destination: { ...destination }
  };
}
