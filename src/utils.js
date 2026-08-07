export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

export function iconFor(type) {
  return {anchor:'📍',hotel:'🏨',food:'🍴',shop:'🛍️',event:'🎭',walk:'🚶',airport:'✈️',cafe:'☕',restaurant:'🍴',pub:'🍺',attraction:'🏛️'}[type] ?? '📍';
}

export function googleWalkingDirections(destination) {
  const value =
    Number.isFinite(destination?.lat) &&
    Number.isFinite(destination?.lon)
      ? `${destination.lat},${destination.lon}`
      : destination?.name ?? destination;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(String(value))}&travelmode=walking`;
}
