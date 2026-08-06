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
import { MapController, LeafletMapAdapter } from './map.js';
import {GpsController} from './gps.js';
import {
  TripFeature
} from './features/trip/trip-feature.js';
import {queryNearby, nearbyCardHtml} from './nearby.js';
import {escapeHtml, formatDistance, googleWalkingDirections} from './utils.js';

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
  const statusElement = root.querySelector('#status');
  let statusTimer = null;

  const status = (title, subtitle) => {
    statusElement.querySelector('b').textContent = title;
    statusElement.querySelector('span').textContent = subtitle;
    statusElement.classList.add('visible');
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => statusElement.classList.remove('visible'), 2500);
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

  const searchAreaButton =
    root.querySelector('#searchAreaBtn');

  let mapCenterAnchor = null;
  let searchAreaTimer = null;

  map.onUserMoveStart(() => {
    appState.followMode = false;
    updateFollowButton();

    const recenterButton =
      root.querySelector('#recenterBtn');

    recenterButton.classList.remove('following');
    recenterButton.textContent = '🎯';

    mapContext.showExploring({
      lat: mapCenterAnchor?.lat ?? 0,
      lon: mapCenterAnchor?.lon ?? 0,
      zoom: mapCenterAnchor?.zoom ?? 0
    });
  });

  map.onMoveEnd(({ lat, lon, zoom }) => {
    mapCenterAnchor = {
      lat,
      lon,
      name: 'this map area'
    };

    if (appState.followMode) {
      return;
    }

    mapContext.showExploring({
      lat,
      lon,
      zoom
    });

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

    await findNearby(mapCenterAnchor);
  });
  const appState = {
    userPosition: null,
    nearby: [],
    category: 'all',
    followMode: true
  };

  const followButton =
    root.querySelector('#followBtn');

  const updateFollowButton = () => {
    followButton.classList.toggle(
      'on',
      appState.followMode
    );

    followButton.setAttribute(
      'aria-label',
      appState.followMode
        ? 'Stop following my location'
        : 'Start following my location'
    );

    followButton.title =
      appState.followMode
        ? 'Stop following'
        : 'Start following';
  };

  updateFollowButton();

  const tripFeature = new TripFeature({
    map,
    panelController,
    listElement: root.querySelector('#list'),
    daySelectElement:
      root.querySelector('#daySelect'),
    status,
    onPlaceSelected: place => {
      findNearby(place);
    }
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

      if (appState.followMode) {
        map.focus(
          appState.userPosition.lat,
          appState.userPosition.lon,
          16
        );

        mapContext.showFollowing({
          heading: position.heading,
          speed: position.speed
        });
      }

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
    if (tripFeature.selected) findNearby(tripFeature.selected);
    else if (appState.userPosition) findNearby(appState.userPosition);
    else status('Nearby unavailable', 'Select a stop or enable GPS first.');
  });

  followButton.addEventListener('click', () => {
    if (appState.followMode) {
      appState.followMode = false;
      updateFollowButton();

      if (mapCenterAnchor) {
        mapContext.showExploring(mapCenterAnchor);
      } else {
        mapContext.showIdle();
      }

      status(
        'Follow mode paused',
        'GPS remains active, but the map will not auto-center.'
      );

      return;
    }

    if (!appState.userPosition) {
      status(
        'No GPS position',
        'Enable GPS and wait for a location fix first.'
      );
      return;
    }

    appState.followMode = true;
    updateFollowButton();

    map.focus(
      appState.userPosition.lat,
      appState.userPosition.lon,
      16
    );

    mapContext.showFollowing({
      heading: appState.userPosition.heading,
      speed: appState.userPosition.speed
    });

    status(
      'Follow mode enabled',
      'The map will follow your live GPS position.'
    );
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

  root.querySelector('#recenterBtn').addEventListener('click', event => {
    if (!appState.userPosition) {
      status(
        'No GPS position',
        'Enable GPS and wait for a location fix.'
      );
      return;
    }

    appState.followMode = true;
    updateFollowButton();
    event.currentTarget.classList.add('following');
    event.currentTarget.textContent = '◎';

    map.focus(
      appState.userPosition.lat,
      appState.userPosition.lon,
      16
    );

    mapContext.showFollowing({
      heading: appState.userPosition?.heading ?? null,
      speed: appState.userPosition?.speed ?? null
    });

    status(
      'Follow mode enabled',
      'The map will follow your GPS position.'
    );
  });

  root.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => {
    root.querySelectorAll('.chip').forEach(node => node.classList.remove('on'));
    chip.classList.add('on');
    appState.category = chip.dataset.cat;
    renderNearby();
  }));

  async function findNearby(anchor) {
    map.clearNearby();
    status('Searching nearby…', 'Searching the installed local region database.');
    try {
      appState.nearby = await queryNearby(anchor);
      renderNearby();
      status(`Nearby: ${appState.nearby.length} places`, `Within about 900 m of ${anchor.name ?? 'your location'}.`);
    } catch (error) {
      console.error(error);
      status('Nearby search unavailable', error.message || 'Local region data could not be loaded.');
    }
  }

  function renderNearby() {
    const existing = root.querySelector('.nearby');
    existing?.remove();
    map.clearNearby();
    const items = appState.nearby
      .filter(place => appState.category === 'all' || place.type === appState.category)
      .slice(0, 40);
    if (!items.length) return;

    const box = document.createElement('div');
    box.className = 'nearby';
    box.innerHTML = `<div class="section-title">Nearby discoveries <span>${items.length}</span></div>`;
    items.forEach(place => {
      const card = document.createElement('div');
      card.className = 'nearby-card';
      card.innerHTML = nearbyCardHtml(place);
      box.appendChild(card);
      const popup = `<b>${escapeHtml(place.name)}</b><br>${escapeHtml(place.amenity || 'place')}<br>${formatDistance(place.distance)} away<br><br><a target="_blank" rel="noopener" href="${googleWalkingDirections(place.name)}">Open Google Maps →</a>`;
      map.addNearby(place, popup);
    });
    root.querySelector('#list').appendChild(box);
  }

  return {
    map,
    panelController,
    tripFeature,
    gps
  };
}
