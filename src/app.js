import data from '../data/london.json';
import { MapController, LeafletMapAdapter } from './map.js';
import {GpsController} from './gps.js';
import {ItineraryController} from './itinerary.js';
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
            <div><strong>Roam</strong><small>London trip</small></div>
          </div>
          <button id="gpsBtn" class="icon-btn" type="button" aria-label="Toggle GPS">📍</button>
        </header>

        <div class="map-actions">
          <button id="recenterBtn" class="map-action" type="button" aria-label="Recenter on my location" title="Recenter on my location">🎯</button>
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
  const statusElement = root.querySelector('#status');
  let statusTimer = null;

  const status = (title, subtitle) => {
    statusElement.querySelector('b').textContent = title;
    statusElement.querySelector('span').textContent = subtitle;
    statusElement.classList.add('visible');
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => statusElement.classList.remove('visible'), 4200);
  };

  const expandSheet = () => bottomSheet.classList.remove('collapsed');
  const mapAdapter = new LeafletMapAdapter({
    elementId: 'map'
  });

  const map = new MapController({
    adapter: mapAdapter
  });
  const appState = {userPosition:null, nearby:[], category:'all'};

  const itinerary = new ItineraryController({
    data,
    map,
    listElement:root.querySelector('#list'),
    daySelect:root.querySelector('#daySelect'),
    status
  });

  const gps = new GpsController({
    onStatus: status,
    onUpdate: position => {
      const firstFix = !appState.userPosition;
      appState.userPosition = {name:'My location', lat:position.latitude, lon:position.longitude};
      map.updateUserLocation(position, firstFix);
      status('📍 You are here', `Accuracy: ${Math.round(position.accuracy)} m`);
    }
  });

  itinerary.setSelectHandler(place => {
    expandSheet();
    findNearby(place);
  });
  itinerary.render('12');

  root.querySelector('#sheetToggle').addEventListener('click', () => {
    bottomSheet.classList.toggle('collapsed');
    window.setTimeout(() => map.invalidateSize(), 260);
  });

  root.querySelector('#nearBtn').addEventListener('click', () => {
    expandSheet();
    if (itinerary.selected) findNearby(itinerary.selected);
    else if (appState.userPosition) findNearby(appState.userPosition);
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

  root.querySelector('#recenterBtn').addEventListener('click', () => {
    if (!appState.userPosition) {
      status('No GPS position', 'Enable GPS and wait for a location fix.');
      return;
    }
    map.focus(appState.userPosition.lat, appState.userPosition.lon, 16);
    status('📍 Recentered', 'Map returned to your current location.');
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

  return {map, itinerary, gps};
}
