import {
  StatusController
} from './ui/status-controller.js';
import {
  PanelController
} from './ui/panel-controller.js';
import {
  MapContextController
} from './ui/map-context-controller.js';
import {
  DraggableBottomSheet
} from './ui/draggable-bottom-sheet.js';
import './ui/draggable-bottom-sheet.css';
import data from '../data/london.json';

import {
  FollowModeController
} from './features/follow/follow-mode-controller.js';

import {
  NearbyFeature
} from './features/nearby/nearby-feature.js';
import { MapController, LeafletMapAdapter } from './map.js';
import {GpsController} from './gps.js';
import {
  TripFeature
} from './features/trip/trip-feature.js';

export function createApp(root) {
  root.innerHTML = `
    <div class="app">
      <main class="map-wrap">
        <div id="map" class="map"></div>

        <header class="map-header">
          <div class="brand-inline">
            <span class="brand-mark">🌍</span>
            <div>
              <strong id="map-context-title">Roam</strong>
              <small id="map-context-subtitle">Exploring London</small>
            </div>
          </div>

          <div class="map-header-actions">
            <button
              id="followBtn"
              class="icon-btn on"
              type="button"
              aria-label="Stop following my location"
              title="Stop following"
            >
              👁
            </button>

            <button
              id="gpsBtn"
              class="icon-btn"
              type="button"
              aria-label="Toggle GPS"
              title="Toggle GPS"
            >
              📍
            </button>
          </div>
        </header>

        <div class="map-actions">
          <button
            id="searchAreaBtn"
            class="search-area-btn"
            type="button"
            hidden
          >
            Search this area
          </button>

          <button
            id="recenterBtn"
            class="map-action"
            type="button"
            aria-label="Recenter on my location"
            title="Recenter on my location"
          >
            🎯
          </button>
        </div>

        <div class="status-toast" id="status" aria-live="polite">
          <b>Select a stop</b>
          <span>Choose an itinerary location to explore.</span>
        </div>

        <div class="attribution-note">© OpenStreetMap contributors</div>
      </main>

      <aside class="sidebar bottom-sheet" id="bottomSheet">
        <button id="sheetToggle" class="sheet-handle" type="button" aria-label="Expand or collapse panel">
          <span></span>
        </button>

        <div class="sidebar-head">
          <div class="brand desktop-brand"><h1>🌍 Roam</h1><p>Interactive travel exploration</p></div>
          <div class="toolbar">
            <select id="daySelect" aria-label="Select itinerary day"></select>
            <button id="nearBtn" type="button">Nearby</button>
          </div>
          <div class="chips" aria-label="Nearby place filters">
            <button class="chip on" data-cat="all" type="button">All</button>
            <button class="chip" data-cat="cafe" type="button">☕ Cafés</button>
            <button class="chip" data-cat="restaurant" type="button">🍴 Food</button>
            <button class="chip" data-cat="pub" type="button">🍺 Pubs</button>
            <button class="chip" data-cat="attraction" type="button">🏛️ Attractions</button>
          </div>
        </div>

        <div class="list" id="list"></div>
      </aside>
    </div>`;

  const bottomSheet = root.querySelector('#bottomSheet');

  const panelController = new PanelController({
    sheet: bottomSheet
  });
  const statusController =
    new StatusController({
      element: root.querySelector('#status'),
      hideAfterMs: 2500
    });

  const status = (title, subtitle = '') => {
    statusController.show(title, subtitle);
  };

  let draggableSheet = null;

  const expandSheet = () => {
    panelController.expand();
  };
  const mapAdapter = new LeafletMapAdapter({
    elementId: 'map',
    offlineMapUrl:
      `${import.meta.env.BASE_URL}regions/london/map.pmtiles`,
    preferOffline: false
  });

  const map = new MapController({
    adapter: mapAdapter
  });

  const mapContext = new MapContextController({
    titleElement:
      root.querySelector('#map-context-title'),
    subtitleElement:
      root.querySelector('#map-context-subtitle')
  });

  const followMode = new FollowModeController({
    map,
    mapContext,
    followButton:
      root.querySelector('#followBtn'),
    recenterButton:
      root.querySelector('#recenterBtn'),
    status
  });

  const searchAreaButton =
    root.querySelector('#searchAreaBtn');

  let mapCenterAnchor = null;
  let searchAreaTimer = null;


  map.onMoveEnd(({ lat, lon, zoom }) => {
    mapCenterAnchor = {
      lat,
      lon,
      name: 'this map area'
    };

    followMode.updateMapCenter({
      lat,
      lon,
      zoom
    });

    if (followMode.isFollowing()) {
      return;
    }

    searchAreaButton.hidden = true;

    window.clearTimeout(searchAreaTimer);

    searchAreaTimer = window.setTimeout(() => {
      searchAreaButton.hidden = false;
    }, 500);
  });

  searchAreaButton.addEventListener('click', async () => {
    if (!mapCenterAnchor) {
      return;
    }

    expandSheet();
    searchAreaButton.hidden = true;

    await nearbyFeature.search(mapCenterAnchor);
  });
  const appState = {
    userPosition: null
  };


  let nearbyFeature = null;

  const tripFeature = new TripFeature({
    map,
    panelController,
    listElement: root.querySelector('#list'),
    daySelectElement:
      root.querySelector('#daySelect'),
    status,
    onPlaceSelected: place => {
      nearbyFeature?.search(place);
    }
  });

  nearbyFeature = new NearbyFeature({
    map,
    panelController,
    listElement: root.querySelector('#list'),
    chipElements:
      root.querySelectorAll('.chip'),
    status
  });

  const gps = new GpsController({
    onStatus: status,
    onUpdate: position => {
      const firstFix = !appState.userPosition;
      appState.userPosition = {
        name: 'My location',
        lat: position.latitude,
        lon: position.longitude,
        heading: position.heading,
        speed: position.speed
      };

      map.updateUserLocation(position, firstFix);
      followMode.updatePosition(position);

      status(
        '📍 You are here',
        `Accuracy: ${Math.round(position.accuracy)} m`
      );
    }
  });

  tripFeature.load(data, {
    initialDay: '12',
    snap: 'half'
  });

  draggableSheet = new DraggableBottomSheet({
    sheet: bottomSheet,
    handle: root.querySelector('#sheetToggle'),
    initialSnap: 'half',
    onSettled: () => {
      window.setTimeout(
        () => map.invalidateSize(),
        300
      );
    }
  });

  panelController.attachDraggableSheet(
    draggableSheet
  );


  root.querySelector('#nearBtn').addEventListener('click', () => {
    expandSheet();
    if (tripFeature.selected) nearbyFeature.search(tripFeature.selected);
    else if (appState.userPosition) nearbyFeature.search(appState.userPosition);
    else status('Nearby unavailable', 'Select a stop or enable GPS first.');
  });


  root.querySelector('#gpsBtn').addEventListener('click', event => {
    if (gps.enabled) {
      gps.stop();
      event.currentTarget.classList.remove('on');
      event.currentTarget.textContent='📍';
      status('GPS disabled','Your location is no longer being tracked.');
    } else {
      gps.start();
      event.currentTarget.classList.add('on');
      event.currentTarget.textContent='●';
    }
  });




  return {
    map,
    panelController,
    tripFeature,
    nearbyFeature,
    statusController,
    gps
  };
}
