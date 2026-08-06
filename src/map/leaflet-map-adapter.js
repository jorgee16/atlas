import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createOnlineOsmLayer } from './layers/online-osm-layer.js';
import {
  createPmtilesVectorLayer,
  pmtilesArchiveExists
} from './layers/pmtiles-vector-layer.js';

const DEFAULT_CENTER = [51.5074, -0.1278];
const DEFAULT_ZOOM = 13;

export class LeafletMapAdapter {
  constructor({
    elementId,
    center = DEFAULT_CENTER,
    zoom = DEFAULT_ZOOM,
    offlineMapUrl = null,
    preferOffline = true
  }) {
    if (!elementId) {
      throw new TypeError(
        'LeafletMapAdapter requires a map element id.'
      );
    }

    this.map = L.map(elementId, {
      zoomControl: true,
      maxZoom: 18
    }).setView(center, zoom);

    this.onlineLayer = createOnlineOsmLayer()
      .addTo(this.map);

    this.offlineLayer = null;

    this.layerControl = L.control.layers(
      {
        '🌐 Online streets': this.onlineLayer
      },
      null,
      {
        collapsed: true
      }
    ).addTo(this.map);

    this.itineraryMarkers = [];
    this.nearbyMarkers = [];
    this.userMarker = null;
    this.userAccuracy = null;

    if (offlineMapUrl) {
      void this.#registerOfflineLayer({
        url: offlineMapUrl,
        preferOffline
      });
    }
  }

  clearItinerary() {
    this.#removeLayers(this.itineraryMarkers);
    this.itineraryMarkers = [];
  }

  clearNearby() {
    this.#removeLayers(this.nearbyMarkers);
    this.nearbyMarkers = [];
  }

  showItinerary(places, onSelect) {
    this.clearItinerary();

    const bounds = [];

    places.forEach((place, index) => {
      const marker = L.marker([place.lat, place.lon])
        .addTo(this.map)
        .bindPopup(
          `<b>${place.name}</b><br>${place.note ?? ''}`
        );

      marker.on('click', () => {
        onSelect(place, marker, index);
      });

      this.itineraryMarkers.push(marker);
      bounds.push([place.lat, place.lon]);
    });

    if (bounds.length > 1) {
      this.map.fitBounds(bounds, {
        padding: [60, 60]
      });
    } else if (bounds.length === 1) {
      this.map.setView(bounds[0], 15);
    } else {
      this.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }
  }

  focus(lat, lon, zoom = 16) {
    this.map.setView([lat, lon], zoom);
  }

  updateUserLocation(
    { latitude, longitude, accuracy },
    firstFix = false
  ) {
    const latLng = [latitude, longitude];

    if (!this.userMarker) {
      this.userMarker = L.circleMarker(latLng, {
        radius: 8,
        weight: 3,
        fillOpacity: 1
      })
        .addTo(this.map)
        .bindPopup('<b>📍 You are here</b>');
    } else {
      this.userMarker.setLatLng(latLng);
    }

    if (!this.userAccuracy) {
      this.userAccuracy = L.circle(latLng, {
        radius: accuracy,
        weight: 1,
        fillOpacity: 0.08
      }).addTo(this.map);
    } else {
      this.userAccuracy.setLatLng(latLng);
      this.userAccuracy.setRadius(accuracy);
    }

    if (firstFix) {
      this.focus(latitude, longitude, 16);
    }
  }

  addNearby(place, popupHtml) {
    const marker = L.circleMarker(
      [place.lat, place.lon],
      {
        radius: 6,
        weight: 2,
        fillOpacity: 0.75
      }
    )
      .bindPopup(popupHtml)
      .addTo(this.map);

    this.nearbyMarkers.push(marker);
  }

  invalidateSize() {
    this.map.invalidateSize();
  }

  async #registerOfflineLayer({
    url,
    preferOffline
  }) {
    const exists = await pmtilesArchiveExists(url);

    if (!exists) {
      console.info(
        'Offline map was not found; using online OpenStreetMap.'
      );
      return;
    }

    this.offlineLayer = createPmtilesVectorLayer({
      url
    });

    this.layerControl.addBaseLayer(
      this.offlineLayer,
      '📦 Offline London'
    );

    if (preferOffline) {
      this.map.removeLayer(this.onlineLayer);
      this.offlineLayer.addTo(this.map);
    }
  }

  #removeLayers(layers) {
    layers.forEach(layer => {
      this.map.removeLayer(layer);
    });
  }
}
