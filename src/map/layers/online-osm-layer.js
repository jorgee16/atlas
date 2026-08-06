import L from 'leaflet';

export function createOnlineOsmLayer() {
  return L.tileLayer(
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }
  );
}
