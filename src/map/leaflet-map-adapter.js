import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@tomickigrzegorz/leaflet-rotate';
import { createOnlineOsmLayer } from './layers/online-osm-layer.js';
import {
  createPmtilesVectorLayer,
  pmtilesArchiveExists
} from './layers/pmtiles-vector-layer.js';
import { escapeHtml } from '../utils.js';
import {
  maneuverIconSvg
} from '../features/navigation/maneuver-icons.js';
import {
  routeBearingFromProgress,
  splitRouteAtProgress
} from '../features/navigation/navigation-route-visuals.js';

const DEFAULT_CENTER = [39.5, -8.0];
const DEFAULT_ZOOM = 7;
const MIN_HEADING_SPEED_METERS_PER_SECOND = 0.8;
const DRIVING_ZOOM = 17;

function normalizeBearing(value) {
  return (
    (Number(value) % 360) + 360
  ) % 360;
}

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

function createDriveLocationIcon({ heading }) {
  const rotation = Number.isFinite(heading) ? heading : 0;
  const html = `
    <div style="width:38px;height:38px;display:grid;place-items:center;background:#fff;border-radius:50%;box-shadow:0 2px 9px rgba(0,0,0,.30);transform:rotate(${rotation}deg);transition:transform 220ms ease;">
      <svg width="25" height="25" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.4 20.1 20 12 16.4 3.9 20 12 2.4Z" fill="#2563eb"/>
      </svg>
    </div>`;

  return L.divIcon({
    className: '',
    html,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
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
      maxZoom: 18,
      rotate: true,
      rotateControl: false,
      dragRotate: false,
      touchRotate: false,
      shiftKeyRotate: false,
      bearing: 0
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
    this.routeLayers = [];
    this.routeCasing = null;
    this.traveledRouteLine = null;
    this.remainingRouteLine = null;
    this.routeBearing = null;
    this.maneuverLayers = [];
    this.userMarker = null;
    this.userAccuracy = null;
    this.navigationTravelMode = null;

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

  clearRoute() {
    this.#removeLayers(this.routeLayers);
    this.#removeLayers(this.maneuverLayers);
    this.routeLayers = [];
    this.routeCasing = null;
    this.traveledRouteLine = null;
    this.remainingRouteLine = null;
    this.routeBearing = null;
    this.maneuverLayers = [];
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

  followPosition(
    position,
    {
      zoom = DRIVING_ZOOM,
      headingUp = false
    } = {}
  ) {
    const heading =
      Number.isFinite(position?.heading) &&
      (
        !Number.isFinite(position?.speed) ||
        position.speed >=
          MIN_HEADING_SPEED_METERS_PER_SECOND
      )
        ? position.heading
        : this.routeBearing;

    const bearing = headingUp &&
      Number.isFinite(heading)
        ? normalizeBearing(heading)
        : 0;

    if (headingUp && Number.isFinite(heading)) {
      this.map.setHeading?.(heading, {
        ease: 0.24,
        deadzone: 0.75
      });
    } else {
      this.setBearing(0);
    }

    this.map.setView(
      [position.lat, position.lon],
      headingUp ? zoom : 16,
      { animate: false }
    );

    if (headingUp) {
      const height =
        this.map.getSize().y;

      this.map.panBy(
        [
          0,
          -Math.min(140, height * 0.18)
        ],
        { animate: false }
      );
    }

    return headingUp
      ? normalizeBearing(-bearing)
      : 0;
  }

  setBearing(bearing = 0) {
    const normalized =
      normalizeBearing(bearing);

    this.map.stopHeadingUp?.();
    this.map.setBearing?.(normalized);
    this.#refreshUserLocationIcon();

    return normalized;
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

    this.lastUserPosition = {
      latitude,
      longitude,
      accuracy,
      heading,
      speed
    };

    const renderedHeading =
      Number.isFinite(heading)
        ? heading + this.#mapBearing()
        : heading;

    const icon = this.navigationTravelMode === 'drive'
      ? createDriveLocationIcon({ heading: renderedHeading })
      : createUserLocationIcon({
          heading: renderedHeading,
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

  setNavigationTravelMode(mode = null) {
    if (mode !== null && mode !== 'drive' && mode !== 'walk') {
      throw new TypeError('Navigation travel mode must be drive, walk, or null.');
    }

    this.navigationTravelMode = mode;
    this.#refreshUserLocationIcon();
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

  showRoute(
    route,
    {
      origin = null,
      destination = null
    } = {}
  ) {
    const points = route?.points ?? [];

    if (
      points.length < 1 ||
      points.some(point =>
        !Number.isFinite(point?.lat) ||
        !Number.isFinite(point?.lon)
      )
    ) {
      throw new TypeError(
        'showRoute requires valid route points.'
      );
    }

    this.clearRoute();

    const latLngs = points.map(
      point => [point.lat, point.lon]
    );

    const casing = L.polyline(
      latLngs,
      {
        color: '#ffffff',
        weight: 9,
        opacity: 0.92,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false
      }
    ).addTo(this.map);

    const traveledLine = L.polyline(
      [],
      {
        color: '#737b8c',
        weight: 5,
        opacity: 0.88,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false
      }
    ).addTo(this.map);

    const routeLine = L.polyline(
      latLngs,
      {
        color: '#315efb',
        weight: 5,
        opacity: 0.96,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false
      }
    ).addTo(this.map);

    this.routeLayers.push(
      casing,
      traveledLine,
      routeLine
    );

    this.routeCasing = casing;
    this.traveledRouteLine = traveledLine;
    this.remainingRouteLine = routeLine;

    this.#addRouteConnector(
      origin,
      route.originSnap?.point
    );

    this.#addRouteConnector(
      route.destinationSnap?.point,
      destination
    );

    const bounds = routeLine.getBounds();

    if (bounds.isValid()) {
      this.map.fitBounds(bounds, {
        paddingTopLeft: [28, 112],
        paddingBottomRight: [28, 196],
        maxZoom: 16
      });
    }
  }

  updateRouteProgress(route, progress) {
    if (
      !this.traveledRouteLine ||
      !this.remainingRouteLine
    ) {
      return;
    }

    const points = route?.points ?? [];
    const split = splitRouteAtProgress(
      points,
      progress
    );

    this.traveledRouteLine.setLatLngs(
      split.traveled.map(
        point => [point.lat, point.lon]
      )
    );

    this.remainingRouteLine.setLatLngs(
      split.remaining.map(
        point => [point.lat, point.lon]
      )
    );

    this.routeBearing =
      routeBearingFromProgress(
        points,
        progress
      );
  }

  showManeuvers(
    maneuvers,
    activeIndex = 0
  ) {
    this.#removeLayers(this.maneuverLayers);
    this.maneuverLayers = [];

    if (!Array.isArray(maneuvers)) {
      return;
    }

    const upcoming = maneuvers
      .slice(Math.max(0, activeIndex))
      .filter(maneuver =>
        maneuver?.type !== 'depart'
      )
      .slice(0, 3)
      .filter(maneuver =>
        Number.isFinite(
          maneuver?.location?.lat
        ) &&
        Number.isFinite(
          maneuver?.location?.lon
        )
      );

    upcoming.forEach((maneuver, index) => {
      const active = index === 0;
      const size = active ? 44 : 34;

      const icon = L.divIcon({
        className: '',
        html: `
          <div class="route-maneuver-marker${active ? ' active' : ''}">
            ${maneuverIconSvg(
              maneuver,
              {
                className:
                  'maneuver-icon route-maneuver-icon'
              }
            )}
          </div>
        `,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
      });

      const marker = L.marker(
        [
          maneuver.location.lat,
          maneuver.location.lon
        ],
        {
          icon,
          interactive: false,
          keyboard: false,
          zIndexOffset: active ? 900 : 700
        }
      ).addTo(this.map);

      this.maneuverLayers.push(marker);
    });
  }

  invalidateSize() {
    this.map.invalidateSize();
  }

  showSelectionPin(
    lat,
    lon,
    popupContent = null
  ) {
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

      this.#setSelectionPopup(
        popupContent
      );

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
        interactive: true,
        keyboard: false
      }
    ).addTo(this.map);

    this.#setSelectionPopup(
      popupContent
    );
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

  closeSelectionPopup() {
    this.selectionPin?.closePopup();
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

  #setSelectionPopup(content) {
    this.selectionPin.unbindPopup();

    if (!content) {
      return;
    }

    this.selectionPin
      .bindPopup(content, {
        className:
          'map-selection-leaflet-popup map-selection-leaflet-popup-v2',
        maxWidth: 224,
        minWidth: 224,
        offset: [0, -10],
        autoPan: true,
        keepInView: true,
        autoPanPaddingTopLeft: [20, 104],
        autoPanPaddingBottomRight: [20, 176]
      })
      .openPopup();
  }

  #resolveAssetUrl(url) {
    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    const relativeUrl =
      String(url).replace(/^\//, '');

    return `${import.meta.env.BASE_URL}${relativeUrl}`;
  }

  #addRouteConnector(from, to) {
    if (
      !Number.isFinite(from?.lat) ||
      !Number.isFinite(from?.lon) ||
      !Number.isFinite(to?.lat) ||
      !Number.isFinite(to?.lon)
    ) {
      return;
    }

    const connector = L.polyline(
      [
        [from.lat, from.lon],
        [to.lat, to.lon]
      ],
      {
        color: '#65708a',
        weight: 3,
        opacity: 0.8,
        dashArray: '5 7',
        interactive: false
      }
    ).addTo(this.map);

    this.routeLayers.push(connector);
  }

  #removeLayers(layers) {
    layers.forEach(layer => {
      this.map.removeLayer(layer);
    });
  }

  #mapBearing() {
    return Number.isFinite(
      this.map.getBearing?.()
    )
      ? this.map.getBearing()
      : 0;
  }

  #refreshUserLocationIcon() {
    const position = this.lastUserPosition;

    if (!position || !this.userMarker) {
      return;
    }

    const showHeading =
      Number.isFinite(position.heading) &&
      Number.isFinite(position.speed) &&
      position.speed >=
        MIN_HEADING_SPEED_METERS_PER_SECOND;

    const renderedHeading = Number.isFinite(position.heading)
      ? position.heading + this.#mapBearing()
      : position.heading;

    this.userMarker.setIcon(
      this.navigationTravelMode === 'drive'
        ? createDriveLocationIcon({ heading: renderedHeading })
        : createUserLocationIcon({
            heading: renderedHeading,
            showHeading
          })
    );
  }
}
