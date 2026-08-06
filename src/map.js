import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export class MapController {
  constructor(elementId) {
    this.map = L.map(elementId, {zoomControl:true}).setView([51.5074, -0.1278], 13);
    this.streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);
    L.control.layers({'🗺️ Streets':this.streets}, null, {collapsed:true}).addTo(this.map);
    this.itineraryMarkers = [];
    this.nearbyMarkers = [];
    this.userMarker = null;
    this.userAccuracy = null;
  }

  clearItinerary() { this.itineraryMarkers.forEach(m => this.map.removeLayer(m)); this.itineraryMarkers = []; }
  clearNearby() { this.nearbyMarkers.forEach(m => this.map.removeLayer(m)); this.nearbyMarkers = []; }

  showItinerary(places, onSelect) {
    this.clearItinerary();
    const bounds = [];
    places.forEach((place, index) => {
      const marker = L.marker([place.lat, place.lon]).addTo(this.map)
        .bindPopup(`<b>${place.name}</b><br>${place.note}`);
      marker.on('click', () => onSelect(place, marker, index));
      this.itineraryMarkers.push(marker);
      bounds.push([place.lat, place.lon]);
    });
    if (bounds.length > 1) this.map.fitBounds(bounds, {padding:[60,60]});
    else if (bounds.length === 1) this.map.setView(bounds[0], 15);
    else this.map.setView([51.5074,-0.1278],13);
  }

  focus(lat, lon, zoom=16) { this.map.setView([lat, lon], zoom); }

  updateUserLocation({latitude, longitude, accuracy}, firstFix) {
    const ll = [latitude, longitude];
    if (!this.userMarker) {
      this.userMarker = L.circleMarker(ll, {radius:8, weight:3, fillOpacity:1}).addTo(this.map).bindPopup('<b>📍 You are here</b>');
    } else this.userMarker.setLatLng(ll);
    if (!this.userAccuracy) this.userAccuracy = L.circle(ll, {radius:accuracy, weight:1, fillOpacity:.08}).addTo(this.map);
    else {this.userAccuracy.setLatLng(ll); this.userAccuracy.setRadius(accuracy);}
    if (firstFix) this.focus(latitude, longitude, 16);
  }

  addNearby(place, popupHtml) {
    const marker = L.circleMarker([place.lat, place.lon], {radius:6, weight:2, fillOpacity:.75})
      .bindPopup(popupHtml).addTo(this.map);
    this.nearbyMarkers.push(marker);
  }
}
