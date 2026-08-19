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
import {
  adaptiveNavigationZoom
} from './navigation-camera.js';

const DEFAULT_CENTER = [39.5, -8.0];
const DEFAULT_ZOOM = 7;
const MIN_HEADING_SPEED_METERS_PER_SECOND = 0.8;
const DRIVING_ZOOM = 18;
const DRIVE_MAX_POSITION_PREDICTION_SECONDS = 1.2;
const WALK_MAX_POSITION_PREDICTION_SECONDS = 0.55;
const WALK_MIN_PREDICTION_SPEED_METERS_PER_SECOND = 0.45;
const EARTH_RADIUS_METERS = 6378137;

function normalizeBearing(value) {
  return (
    (Number(value) % 360) + 360
  ) % 360;
}

function smoothingFactor(rate, deltaSeconds) {
  return 1 - Math.exp(-rate * deltaSeconds);
}

function gpsAccuracyConfidence(accuracy) {
  if (!Number.isFinite(accuracy)) {
    return 0.35;
  }

  return Math.max(
    0.12,
    Math.min(
      1,
      30 / Math.max(accuracy, 10)
    )
  );
}

function predictPosition(
  position,
  speed,
  heading,
  seconds
) {
  if (
    !position ||
    !Number.isFinite(speed) ||
    speed <= 0 ||
    !Number.isFinite(heading) ||
    seconds <= 0
  ) {
    return position;
  }

  const distance =
    speed * seconds;

  const headingRadians =
    heading * Math.PI / 180;

  const latRadians =
    position.lat * Math.PI / 180;

  const north =
    Math.cos(headingRadians) * distance;

  const east =
    Math.sin(headingRadians) * distance;

  const latitudeDelta =
    north /
    EARTH_RADIUS_METERS *
    180 /
    Math.PI;

  const longitudeDelta =
    east /
    (
      EARTH_RADIUS_METERS *
      Math.cos(latRadians)
    ) *
    180 /
    Math.PI;

  return {
    lat: position.lat + latitudeDelta,
    lon: position.lon + longitudeDelta
  };
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
    preferOffline = false
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
      maxZoom: 19,
      zoomSnap: 0.25,
      zoomDelta: 0.25,
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
    this.navigationRouteProgress = null;
    this.navigationCameraZoom = null;
    this.navigationCameraTimestamp = null;
    this.maneuverLayers = [];
    this.userMarker = null;
    this.userAccuracy = null;
    this.navigationTravelMode = null;

    // Raw GPS coordinates remain untouched for navigation.
    // These values are only used for smooth map rendering.
    this.renderedUserPosition = null;
    this.targetUserPosition = null;
    this.userPositionAnimationFrame = null;
    this.userPositionAnimationTimestamp = null;

    this.gpsDiagnosticsElement = null;
    this.gpsDiagnosticsVisible = false;
    this.gpsDiagnosticsFrameCount = 0;
    this.gpsDiagnosticsLastFrameTimestamp = null;
    this.gpsDiagnosticsFps = 0;
    this.gpsDiagnosticsFixCount = 0;
    this.gpsDiagnosticsFixWindowStart = null;
    this.gpsDiagnosticsHz = 0;
    this.gpsDiagnosticsPredictionSeconds = 0;

    this.gpsDiagnosticsElement =
      document.createElement('div');

    this.gpsDiagnosticsElement.className =
      'atlas-gps-diagnostics';

    this.gpsDiagnosticsElement.hidden = true;

    this.gpsDiagnosticsElement.innerHTML = `
      <strong>GPS diagnostics</strong>
      <span>FPS 0</span>
      <span>GPS 0.0 Hz</span>
      <span>Acc —</span>
      <span>Speed —</span>
      <span>Head —</span>
      <span>Pred 0.00 s</span>
    `;

    this.map
      .getContainer()
      .appendChild(
        this.gpsDiagnosticsElement
      );

    this.latestUserSpeed = null;
    this.latestUserHeading = null;
    this.latestUserFixTimestamp = null;

    // Camera follows the same continuously rendered position
    // as the vehicle marker instead of raw GPS fixes.
    this.followHeadingUp = false;
    this.followZoom = DRIVING_ZOOM;
    this.lastFollowRequestTimestamp = null;

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
    this.navigationRouteProgress = null;
    this.navigationCameraZoom = null;
    this.navigationCameraTimestamp = null;
    this.maneuverLayers = [];
  }

  showItinerary(places, onSelect) {
    this.clearItinerary();

    const bounds = [];

    places.forEach((place, index) => {
      const icon = L.divIcon({
        className: '',
        html: `
          <div style="
            width:34px;
            height:34px;
            display:grid;
            place-items:center;
            background:#2563eb;
            color:#fff;
            border:3px solid #fff;
            border-radius:50% 50% 50% 0;
            transform:rotate(-45deg);
            box-shadow:0 3px 10px rgba(0,0,0,.32);
            font:700 14px/1 system-ui,sans-serif;
          ">
            <span style="transform:rotate(45deg);">${index + 1}</span>
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
        popupAnchor: [0, -36]
      });

      const marker = L.marker(
        [place.lat, place.lon],
        {
          icon,
          zIndexOffset: 200
        }
      )
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

  focusItineraryPlace(
    place,
    {
      zoom = 16
    } = {}
  ) {
    if (
      !Number.isFinite(place?.lat) ||
      !Number.isFinite(place?.lon)
    ) {
      return false;
    }

    const container =
      this.map.getContainer();

    const height =
      container?.clientHeight ||
      this.map.getSize().y;

    // Put the selected point around the upper third of the map.
    // This leaves the lower area free for the Trip workspace.
    const verticalOffset =
      Math.max(
        120,
        Math.round(height * 0.28)
      );

    this.map.setView(
      [place.lat, place.lon],
      zoom,
      {
        animate: false
      }
    );

    this.map.panBy(
      [0, verticalOffset],
      {
        animate: false
      }
    );

    let selectedMarker = null;

    for (const marker of this.itineraryMarkers) {
      // Restore every itinerary marker first. The currently selected stop
      // is represented by Atlas's blue selection pin instead.
      marker.setOpacity?.(1);
      marker.closePopup?.();

      const latLng = marker.getLatLng?.();

      if (
        latLng &&
        Math.abs(latLng.lat - place.lat) < 0.000001 &&
        Math.abs(latLng.lng - place.lon) < 0.000001
      ) {
        selectedMarker = marker;
      }
    }

    if (selectedMarker) {
      // Avoid rendering the normal itinerary marker underneath the
      // dedicated blue selection pin.
      selectedMarker.setOpacity?.(0);
    }

    return true;
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

    const bearing =
      headingUp &&
      Number.isFinite(heading)
        ? normalizeBearing(heading)
        : 0;

    if (
      headingUp &&
      Number.isFinite(heading)
    ) {
      this.map.setHeading?.(
        heading,
        {
          ease: 0.16,
          deadzone: 0.4
        }
      );
    } else {
      this.setBearing(0);
    }

    this.followHeadingUp =
      headingUp;

    const now = performance.now();

    const requestedZoom =
      this.navigationTravelMode
        ? adaptiveNavigationZoom({
            travelMode: this.navigationTravelMode,
            speed: position?.speed,
            preferredZoom: zoom,
            progress: this.navigationRouteProgress
          })
        : headingUp
          ? zoom
          : 16;

    if (this.navigationCameraZoom === null) {
      this.navigationCameraZoom = requestedZoom;
    } else {
      const elapsedSeconds =
        this.navigationCameraTimestamp === null
          ? 0.2
          : Math.min(
              0.5,
              Math.max(
                0.016,
                (now - this.navigationCameraTimestamp) / 1000
              )
            );

      const zoomEase =
        smoothingFactor(2.6, elapsedSeconds);

      this.navigationCameraZoom +=
        (requestedZoom - this.navigationCameraZoom) *
        zoomEase;
    }

    this.navigationCameraTimestamp = now;

    this.followZoom =
      Math.round(
        this.navigationCameraZoom * 4
      ) / 4;

    this.lastFollowRequestTimestamp = now;

    // Only commit quarter-zoom steps after the smoothed camera target
    // has moved far enough. This prevents GPS speed noise from making
    // the map continuously hunt in and out.
    if (
      Math.abs(
        this.map.getZoom() -
        this.followZoom
      ) >= 0.24
    ) {
      this.map.setZoom(
        this.followZoom,
        {
          animate: true
        }
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

    const diagnosticsNow =
      performance.now();

    if (
      this.gpsDiagnosticsFixWindowStart === null
    ) {
      this.gpsDiagnosticsFixWindowStart =
        diagnosticsNow;
    }

    this.gpsDiagnosticsFixCount += 1;

    const diagnosticsFixElapsed =
      diagnosticsNow -
      this.gpsDiagnosticsFixWindowStart;

    if (diagnosticsFixElapsed >= 1000) {
      this.gpsDiagnosticsHz =
        this.gpsDiagnosticsFixCount /
        (diagnosticsFixElapsed / 1000);

      this.gpsDiagnosticsFixCount = 0;
      this.gpsDiagnosticsFixWindowStart =
        diagnosticsNow;
    }

    this.targetUserPosition = {
      lat: latitude,
      lon: longitude
    };

    this.latestUserSpeed =
      Number.isFinite(speed)
        ? speed
        : null;

    this.latestUserHeading =
      Number.isFinite(heading)
        ? normalizeBearing(heading)
        : null;

    this.latestUserFixTimestamp =
      performance.now();

    this.#renderGpsDiagnostics();

    const renderedHeading =
      Number.isFinite(heading)
        ? heading + this.#mapBearing()
        : heading;

    const icon =
      this.navigationTravelMode === 'drive'
        ? createDriveLocationIcon({
            heading: renderedHeading
          })
        : createUserLocationIcon({
            heading: renderedHeading,
            showHeading
          });

    if (!this.userMarker) {
      this.renderedUserPosition = {
        lat: latitude,
        lon: longitude
      };

      this.userMarker = L.marker(
        latLng,
        {
          icon,
          zIndexOffset: 1000
        }
      )
        .addTo(this.map)
        .bindPopup('<b>📍 You are here</b>');
    } else {
      // Heading/icon can react immediately while position
      // continues smoothly toward the latest GPS fix.
      this.userMarker.setIcon(icon);
    }

    if (!this.userAccuracy) {
      this.userAccuracy = L.circle(
        latLng,
        {
          radius: accuracy,
          weight: 1,
          fillOpacity: 0.08
        }
      ).addTo(this.map);
    } else {
      this.userAccuracy.setRadius(accuracy);
    }

    if (firstFix) {
      this.renderedUserPosition = {
        lat: latitude,
        lon: longitude
      };

      this.userMarker.setLatLng(latLng);
      this.userAccuracy.setLatLng(latLng);

      this.focus(
        latitude,
        longitude,
        16
      );
    } else {
      this.#startUserPositionAnimation();
    }
  }

  #startUserPositionAnimation() {
    if (
      this.userPositionAnimationFrame !== null
    ) {
      return;
    }

    this.userPositionAnimationTimestamp = null;

    this.userPositionAnimationFrame =
      requestAnimationFrame(
        timestamp =>
          this.#animateUserPosition(timestamp)
      );
  }

  #animateUserPosition(timestamp) {
    if (
      this.gpsDiagnosticsLastFrameTimestamp === null
    ) {
      this.gpsDiagnosticsLastFrameTimestamp =
        timestamp;
    }

    this.gpsDiagnosticsFrameCount += 1;

    const diagnosticsFrameElapsed =
      timestamp -
      this.gpsDiagnosticsLastFrameTimestamp;

    if (diagnosticsFrameElapsed >= 1000) {
      this.gpsDiagnosticsFps =
        this.gpsDiagnosticsFrameCount /
        (diagnosticsFrameElapsed / 1000);

      this.gpsDiagnosticsFrameCount = 0;
      this.gpsDiagnosticsLastFrameTimestamp =
        timestamp;

      this.#renderGpsDiagnostics();
    }

    if (
      !this.renderedUserPosition ||
      !this.targetUserPosition ||
      !this.userMarker
    ) {
      this.userPositionAnimationFrame = null;
      this.userPositionAnimationTimestamp = null;
      return;
    }

    if (
      this.userPositionAnimationTimestamp === null
    ) {
      this.userPositionAnimationTimestamp =
        timestamp;
    }

    const deltaSeconds =
      Math.min(
        (
          timestamp -
          this.userPositionAnimationTimestamp
        ) / 1000,
        0.1
      );

    this.userPositionAnimationTimestamp =
      timestamp;

    const maxPredictionSeconds =
      this.navigationTravelMode === 'drive'
        ? DRIVE_MAX_POSITION_PREDICTION_SECONDS
        : this.navigationTravelMode === 'walk'
          ? WALK_MAX_POSITION_PREDICTION_SECONDS
          : 0;

    const minimumPredictionSpeed =
      this.navigationTravelMode === 'drive'
        ? MIN_HEADING_SPEED_METERS_PER_SECOND
        : WALK_MIN_PREDICTION_SPEED_METERS_PER_SECOND;

    const predictionEnabled =
      maxPredictionSeconds > 0 &&
      Number.isFinite(this.latestUserSpeed) &&
      this.latestUserSpeed >=
        minimumPredictionSpeed &&
      Number.isFinite(this.latestUserHeading);

    const predictionSeconds =
      predictionEnabled &&
      this.latestUserFixTimestamp !== null
        ? Math.min(
            maxPredictionSeconds,
            Math.max(
              0,
              (
                performance.now() -
                this.latestUserFixTimestamp
              ) / 1000
            )
          )
        : 0;

    this.gpsDiagnosticsPredictionSeconds =
      predictionSeconds;

    const predictedTarget =
      predictionEnabled
        ? predictPosition(
            this.targetUserPosition,
            this.latestUserSpeed,
            this.latestUserHeading,
            predictionSeconds
          )
        : this.targetUserPosition;

    // Softer than the previous value of ~4-5.
    // Prediction keeps the target moving, so we no longer
    // need to race toward every GPS fix.
    const baseSmoothingRate =
      this.navigationTravelMode === 'drive'
        ? 2.8
        : 3.2;

    const accuracyConfidence =
      gpsAccuracyConfidence(
        this.lastUserPosition?.accuracy
      );

    const smoothingRate =
      baseSmoothingRate *
      accuracyConfidence;

    const amount =
      smoothingFactor(
        smoothingRate,
        deltaSeconds
      );

    this.renderedUserPosition.lat +=
      (
        predictedTarget.lat -
        this.renderedUserPosition.lat
      ) * amount;

    this.renderedUserPosition.lon +=
      (
        predictedTarget.lon -
        this.renderedUserPosition.lon
      ) * amount;

    const renderedLatLng = [
      this.renderedUserPosition.lat,
      this.renderedUserPosition.lon
    ];

    this.userMarker.setLatLng(
      renderedLatLng
    );

    this.userAccuracy?.setLatLng(
      renderedLatLng
    );

    this.#followRenderedUserPosition();

    const latDifference =
      Math.abs(
        predictedTarget.lat -
        this.renderedUserPosition.lat
      );

    const lonDifference =
      Math.abs(
        predictedTarget.lon -
        this.renderedUserPosition.lon
      );

    const stillPredicting =
      predictionEnabled &&
      predictionSeconds <
        maxPredictionSeconds;


    if (
      !stillPredicting &&
      latDifference < 0.0000001 &&
      lonDifference < 0.0000001
    ) {
      this.renderedUserPosition = {
        ...predictedTarget
      };

      this.userMarker.setLatLng([
        this.renderedUserPosition.lat,
        this.renderedUserPosition.lon
      ]);

      this.userAccuracy?.setLatLng([
        this.renderedUserPosition.lat,
        this.renderedUserPosition.lon
      ]);

      this.userPositionAnimationFrame = null;
      this.userPositionAnimationTimestamp = null;
      return;
    }

    this.userPositionAnimationFrame =
      requestAnimationFrame(
        nextTimestamp =>
          this.#animateUserPosition(
            nextTimestamp
          )
      );
  }

  #followRenderedUserPosition() {
    if (
      !this.renderedUserPosition ||
      this.lastFollowRequestTimestamp === null
    ) {
      return;
    }

    // followPosition() is called continuously while Navigation
    // follow mode is active. If it stops being called, don't
    // keep dragging the map back to the vehicle indefinitely.
    const followAge =
      performance.now() -
      this.lastFollowRequestTimestamp;

    if (followAge > 1800) {
      return;
    }

    const zoom =
      this.followZoom;

    let targetCenter =
      L.latLng(
        this.renderedUserPosition.lat,
        this.renderedUserPosition.lon
      );

    if (this.followHeadingUp) {
      const height =
        this.map.getSize().y;

      const verticalOffset =
        Math.min(
          140,
          height * 0.18
        );

      const projected =
        this.map.project(
          targetCenter,
          zoom
        );

      targetCenter =
        this.map.unproject(
          projected.subtract([
            0,
            verticalOffset
          ]),
          zoom
        );
    }

    // Tiny frame-by-frame pans are already smooth.
    // Do NOT start a new Leaflet animation every frame.
    this.map.panTo(
      targetCenter,
      {
        animate: false,
        noMoveStart: true
      }
    );
  }

  setNavigationTravelMode(mode = null) {
    if (mode !== null && mode !== 'drive' && mode !== 'walk') {
      throw new TypeError('Navigation travel mode must be drive, walk, or null.');
    }

    if (this.navigationTravelMode !== mode) {
      this.navigationCameraZoom = null;
      this.navigationCameraTimestamp = null;
    }

    this.navigationTravelMode = mode;

    if (mode === null) {
      this.navigationRouteProgress = null;
    }

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

    /*
     * Transit previews preserve the TfL leg structure instead of
     * flattening the complete journey into one Atlas-blue line.
     *
     * Drive/Walk continue through the normal route renderer below.
     */
    if (
      route?.kind === 'transit' &&
      Array.isArray(route?.transitJourney?.sequence)
    ) {
      const sequence =
        route.transitJourney.sequence;

      const transitColour = step => {
        if (step?.kind === 'walk') {
          return '#8f99a8';
        }

        const line =
          String(step?.line ?? '')
            .trim()
            .toLowerCase();

        const mode =
          String(step?.mode ?? '')
            .trim()
            .toLowerCase();

        // London Underground line colours.
        if (line.includes('jubilee')) return '#7c878e';
        if (line.includes('piccadilly')) return '#003688';
        if (line.includes('district')) return '#00782a';
        if (line.includes('central')) return '#e32017';
        if (line.includes('circle')) return '#ffd300';
        if (line.includes('victoria')) return '#0098d4';
        if (line.includes('northern')) return '#000000';
        if (line.includes('metropolitan')) return '#9b0056';
        if (line.includes('bakerloo')) return '#894e24';

        if (
          line.includes('waterloo') &&
          line.includes('city')
        ) {
          return '#95cdba';
        }

        if (
          line.includes('hammersmith') ||
          line.includes('h&c')
        ) {
          return '#f3a9bb';
        }

        // Other TfL modes.
        if (
          mode === 'bus' ||
          mode === 'public-bus'
        ) {
          return '#dc241f';
        }

        if (mode === 'dlr') {
          return '#00afad';
        }

        if (mode === 'overground') {
          return '#ee7c0e';
        }

        if (mode === 'elizabeth-line') {
          return '#6950a1';
        }

        if (mode === 'national-rail') {
          return '#003b70';
        }

        if (mode === 'tram') {
          return '#84b817';
        }

        if (mode === 'tube') {
          return '#0019a8';
        }

        return '#315efb';
      };

      let journeyBounds = null;

      for (const step of sequence) {
        const stepPoints =
          (step?.points ?? [])
            .filter(point =>
              Number.isFinite(point?.lat) &&
              Number.isFinite(point?.lon)
            );

        if (stepPoints.length < 2) {
          continue;
        }

        const stepLatLngs =
          stepPoints.map(
            point => [point.lat, point.lon]
          );

        // White casing keeps every transport colour readable
        // against both light and dark map tiles.
        const stepCasing = L.polyline(
          stepLatLngs,
          {
            color: '#ffffff',
            weight: 9,
            opacity: 0.90,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false
          }
        ).addTo(this.map);

        const stepLine = L.polyline(
          stepLatLngs,
          {
            color: transitColour(step),
            weight:
              step.kind === 'walk'
                ? 4
                : 5,
            opacity:
              step.kind === 'walk'
                ? 0.82
                : 0.97,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
            dashArray:
              step.kind === 'walk'
                ? '5 7'
                : null
          }
        ).addTo(this.map);

        this.routeLayers.push(
          stepCasing,
          stepLine
        );

        const bounds =
          stepLine.getBounds();

        if (bounds.isValid()) {
          if (!journeyBounds) {
            journeyBounds = bounds;
          } else {
            journeyBounds.extend(bounds);
          }
        }
      }

      // Transit preview does not use normal drive/walk progress layers.
      this.routeCasing = null;
      this.traveledRouteLine = null;
      this.remainingRouteLine = null;

      this.#addRouteConnector(
        origin,
        sequence[0]?.points?.[0] ?? null
      );

      const lastStep =
        sequence.at(-1);

      this.#addRouteConnector(
        lastStep?.points?.at?.(-1) ?? null,
        destination
      );

      if (journeyBounds?.isValid?.()) {
        this.map.fitBounds(
          journeyBounds,
          {
            paddingTopLeft: [28, 112],
            paddingBottomRight: [28, 196],
            maxZoom: 16
          }
        );
      }

      return;
    }

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
    this.navigationRouteProgress =
      progress ?? null;

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

  setGpsDiagnosticsVisible(visible) {
    this.gpsDiagnosticsVisible =
      Boolean(visible);

    if (!this.gpsDiagnosticsElement) {
      return;
    }

    this.gpsDiagnosticsElement.hidden =
      !this.gpsDiagnosticsVisible;
  }

  isGpsDiagnosticsVisible() {
    return this.gpsDiagnosticsVisible;
  }

  resetGpsDiagnostics() {
    this.gpsDiagnosticsFixCount = 0;
    this.gpsDiagnosticsFixWindowStart = null;
    this.gpsDiagnosticsHz = 0;
    this.gpsDiagnosticsPredictionSeconds = 0;

    this.lastUserPosition = null;
    this.latestUserSpeed = null;
    this.latestUserHeading = null;

    if (!this.gpsDiagnosticsElement) {
      return;
    }

    this.gpsDiagnosticsElement.innerHTML = `
      <strong>GPS diagnostics</strong>
      <span>FPS ${this.gpsDiagnosticsFps.toFixed(0)}</span>
      <span>GPS —</span>
      <span>Acc —</span>
      <span>Speed —</span>
      <span>Head —</span>
      <span>Pred —</span>
    `;
  }

  #renderGpsDiagnostics() {
    if (!this.gpsDiagnosticsElement) {
      return;
    }

    this.gpsDiagnosticsElement.hidden =
      !this.gpsDiagnosticsVisible;

    if (!this.gpsDiagnosticsVisible) {
      return;
    }

    const accuracy =
      this.lastUserPosition?.accuracy;

    const speed =
      this.latestUserSpeed;

    const heading =
      this.latestUserHeading;

    this.gpsDiagnosticsElement.innerHTML = `
      <strong>GPS diagnostics</strong>
      <span>FPS ${this.gpsDiagnosticsFps.toFixed(0)}</span>
      <span>GPS ${this.gpsDiagnosticsHz.toFixed(1)} Hz</span>
      <span>Acc ${
        Number.isFinite(accuracy)
          ? `${Math.round(accuracy)} m`
          : '—'
      }</span>
      <span>Speed ${
        Number.isFinite(speed)
          ? `${speed.toFixed(1)} m/s`
          : '—'
      }</span>
      <span>Head ${
        Number.isFinite(heading)
          ? `${Math.round(heading)}°`
          : '—'
      }</span>
      <span>Pred ${this.gpsDiagnosticsPredictionSeconds.toFixed(2)} s</span>
    `;
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
