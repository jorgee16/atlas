import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createOnlineOsmLayer } from './layers/online-osm-layer.js';
import {
  createPmtilesVectorLayer,
  pmtilesArchiveExists
} from './layers/pmtiles-vector-layer.js';
import { escapeHtml } from '../utils.js';

const DEFAULT_CENTER = [39.5, -8.0];
const DEFAULT_ZOOM = 7;
const MIN_HEADING_SPEED_METERS_PER_SECOND = 0.8;

function createUserLocationIcon({
  heading,
  showHeading
}) {
  const rotation = Number.isFinite(heading) ? heading : 0;

  const html = showHeading
    ? `
      <div
        style="
          position:relative;
          width:42px;
          height:42px;
          transform:rotate(${rotation}deg);
          transition:transform 220ms ease;
        "
      >
        <div
          style="
            position:absolute;
            top:0;
            left:50%;
            width:0;
            height:0;
            transform:translateX(-50%);
            border-left:9px solid transparent;
            border-right:9px solid transparent;
            border-bottom:22px solid #2563eb;
            filter:drop-shadow(0 2px 3px rgba(0,0,0,.28));
          "
        ></div>

        <div
          style="
            position:absolute;
            left:50%;
            bottom:5px;
            width:18px;
            height:18px;
            transform:translateX(-50%);
            background:#2563eb;
            border:3px solid #fff;
            border-radius:50%;
            box-shadow:0 2px 8px rgba(0,0,0,.28);
          "
        ></div>
      </div>
    `
    : `
      <div
        style="
          width:20px;
          height:20px;
          background:#2563eb;
          border:4px solid #fff;
          border-radius:50%;
          box-shadow:0 2px 9px rgba(0,0,0,.30);
        "
      ></div>
    `;

  return L.divIcon({
    className: '',
    html,
    iconSize: showHeading ? [42, 42] : [20, 20],
    iconAnchor: showHeading ? [21, 34] : [10, 10],
    popupAnchor: [0, -20]
  });
}

export class LeafletMapAdapter {
  constructor({
    elementId,
    center = DEFAULT_CENTER,
    zoom = DEFAULT_ZOOM,
    offlineMapUrl = null,
    preferOffline = true
  }) {
    this.selectionPin = null;
    this.selectionPinTimer = null;
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
    this.offlineRegionId = null;
    this.offlineRequestVersion = 0;

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
      void this.setRegion(
        {
          id: 'initial-offline-map',
          name: 'Region',
          mapUrl: offlineMapUrl
        },
        { preferOffline }
      );
    }
  }

  async setRegion(
    region,
    {
      preferOffline = false
    } = {}
  ) {
    const regionId = region?.id ?? null;
    const mapUrl =
      region?.mapUrl ??
      region?.assets?.map ??
      null;

    if (
      regionId &&
      regionId === this.offlineRegionId &&
      this.offlineLayer
    ) {
      return true;
    }

    const requestVersion =
      ++this.offlineRequestVersion;

    this.#clearOfflineLayer();

    if (!mapUrl) {
      return false;
    }

    const resolvedUrl =
      this.#resolveAssetUrl(mapUrl);

    const exists =
      await pmtilesArchiveExists(
        resolvedUrl
      );

    if (
      requestVersion !==
      this.offlineRequestVersion
    ) {
      return false;
    }

    if (!exists) {
      console.info(
        `${region.name} has no available offline map; using online OpenStreetMap.`
      );
      return false;
    }

    this.offlineLayer =
      createPmtilesVectorLayer({
        url: resolvedUrl
      });

    this.offlineRegionId = regionId;

    this.layerControl.addBaseLayer(
      this.offlineLayer,
      `📦 Offline ${region.name}`
    );

    if (preferOffline) {
      this.map.removeLayer(
        this.onlineLayer
      );

      this.offlineLayer.addTo(this.map);
    }

    return true;
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
          `<b>${escapeHtml(place.name)}</b><br>${escapeHtml(place.note ?? '')}`
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
    {
      latitude,
      longitude,
      accuracy,
      heading = null,
      speed = null
    },
    firstFix = false
  ) {
    const latLng = [latitude, longitude];

    const showHeading =
      Number.isFinite(heading) &&
      Number.isFinite(speed) &&
      speed >= MIN_HEADING_SPEED_METERS_PER_SECOND;

    const icon = createUserLocationIcon({
      heading,
      showHeading
    });

    if (!this.userMarker) {
      this.userMarker = L.marker(latLng, {
        icon,
        zIndexOffset: 1000
      })
        .addTo(this.map)
        .bindPopup('<b>📍 You are here</b>');
    } else {
      this.userMarker.setLatLng(latLng);
      this.userMarker.setIcon(icon);
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

  showSelectionPin(lat, lon) {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      throw new TypeError(
        'showSelectionPin requires lat and lon.'
      );
    }

    if (this.selectionPin) {
      this.selectionPin.setLatLng([
        lat,
        lon
      ]);

      return;
    }

    const icon = L.divIcon({
      className: '',
      html:
        '<div class="bookmark-selection-pin"></div>',
      iconSize: [34, 38],
      iconAnchor: [17, 34]
    });

    this.selectionPin = L.marker(
      [lat, lon],
      {
        icon,
        interactive: false,
        keyboard: false
      }
    ).addTo(this.map);
  }

  clearSelectionPin() {
    if (!this.selectionPin) {
      return;
    }

    this.map.removeLayer(
      this.selectionPin
    );

    this.selectionPin = null;
  }

  onMapClick(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError(
        'onMapClick requires a callback.'
      );
    }

    this.map.on('click', event => {
      callback({
        lat: event.latlng.lat,
        lon: event.latlng.lng
      });
    });
  }

  onUserMoveStart(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError(
        'onUserMoveStart requires a callback.'
      );
    }

    const container = this.map.getContainer();

    this.map.on('dragstart', callback);

    container.addEventListener(
      'wheel',
      callback,
      { passive: true }
    );

    container.addEventListener(
      'dblclick',
      callback
    );

    container.addEventListener(
      'touchstart',
      event => {
        if (event.touches.length >= 2) {
          callback();
        }
      },
      { passive: true }
    );

    container.addEventListener(
      'click',
      event => {
        if (
          event.target.closest(
            '.leaflet-control-zoom'
          )
        ) {
          callback();
        }
      }
    );
  }

  onMoveEnd(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('onMoveEnd requires a callback.');
    }

    this.map.on('moveend', () => {
      const center = this.map.getCenter();

      callback({
        lat: center.lat,
        lon: center.lng,
        zoom: this.map.getZoom()
      });
    });
  }

  #clearOfflineLayer() {
    if (!this.offlineLayer) {
      this.offlineRegionId = null;
      return;
    }

    if (this.map.hasLayer(this.offlineLayer)) {
      this.map.removeLayer(this.offlineLayer);
    }

    this.layerControl.removeLayer(
      this.offlineLayer
    );

    if (!this.map.hasLayer(this.onlineLayer)) {
      this.onlineLayer.addTo(this.map);
    }

    this.offlineLayer = null;
    this.offlineRegionId = null;
  }

  #resolveAssetUrl(url) {
    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    const relativeUrl =
      String(url).replace(/^\//, '');

    return `${import.meta.env.BASE_URL}${relativeUrl}`;
  }

  #removeLayers(layers) {
    layers.forEach(layer => {
      this.map.removeLayer(layer);
    });
  }
}
