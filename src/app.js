import data from '../data/london.json';
import {MapController} from './map.js';
import {GpsController} from './gps.js';
import {ItineraryController} from './itinerary.js';
import {queryNearby, nearbyCardHtml} from './nearby.js';
import {iconFor, escapeHtml, formatDistance, googleWalkingDirections} from './utils.js';

export function createApp(root) {
  root.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="brand"><h1>🌍 Roam</h1><p>Interactive travel exploration</p></div>
        <div class="toolbar"><select id="daySelect"></select><button id="nearBtn">Nearby</button><button id="gpsBtn">📍 Me</button></div>
        <div class="list" id="list"></div>
      </aside>
      <main class="map-wrap"><div id="map" class="map"></div>
        <div class="floating" id="status"><b>Select a stop</b><span>Choose an itinerary location to explore.</span>
          <div class="chips"><button class="chip on" data-cat="all">All</button><button class="chip" data-cat="cafe">☕ Cafés</button><button class="chip" data-cat="restaurant">🍴 Food</button><button class="chip" data-cat="pub">🍺 Pubs</button><button class="chip" data-cat="attraction">🏛️ Attractions</button></div>
        </div>
        <div class="attribution-note">© OpenStreetMap contributors</div>
      </main>
    </div>`;

  const status = (title, subtitle) => {
    root.querySelector('#status b').textContent = title;
    root.querySelector('#status span').textContent = subtitle;
  };
  const map = new MapController('map');
  const itinerary = new ItineraryController({data, map, listElement:root.querySelector('#list'), daySelect:root.querySelector('#daySelect'), status});
  const gps = new GpsController({
    onStatus: status,
    onUpdate: position => {
      const firstFix = !appState.userPosition;
      appState.userPosition = {name:'My location', lat:position.latitude, lon:position.longitude};
      map.updateUserLocation(position, firstFix);
      status('📍 You are here', `Accuracy: ${Math.round(position.accuracy)} m · ${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`);
    }
  });
  const appState = {userPosition:null, nearby:[], category:'all'};

  itinerary.setSelectHandler(place => findNearby(place));
  itinerary.render('12');

  root.querySelector('#nearBtn').addEventListener('click', () => {
    if (itinerary.selected) findNearby(itinerary.selected);
    else if (appState.userPosition) findNearby(appState.userPosition);
    else status('Nearby unavailable', 'Select an itinerary stop or enable GPS first.');
  });
  root.querySelector('#gpsBtn').addEventListener('click', event => {
    if (gps.enabled) { gps.stop(); event.currentTarget.classList.remove('on'); event.currentTarget.textContent='📍 Me'; status('GPS disabled','Your location is no longer being tracked.'); }
    else { gps.start(); event.currentTarget.classList.add('on'); event.currentTarget.textContent='📍 GPS on'; }
  });
  root.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => {
    root.querySelectorAll('.chip').forEach(node => node.classList.remove('on'));
    chip.classList.add('on');
    appState.category = chip.dataset.cat;
    renderNearby();
  }));

  async function findNearby(anchor) {
    map.clearNearby();
    status('Searching nearby…', 'Querying OpenStreetMap through Overpass.');
    try {
      appState.nearby = await queryNearby(anchor);
      renderNearby();
      status(`Nearby: ${appState.nearby.length} places`, `Within about 900 m of ${anchor.name ?? 'your location'}.`);
    } catch (error) {
      console.error(error);
      status('Nearby search failed', 'Try again in a moment or check your connection.');
    }
  }

  function renderNearby() {
    const existing = root.querySelector('.nearby');
    existing?.remove();
    map.clearNearby();
    const items = appState.nearby.filter(place => appState.category === 'all' || place.type === appState.category).slice(0, 40);
    if (!items.length) return;
    const box = document.createElement('div');
    box.className = 'nearby';
    box.innerHTML = '<div class="section-title">Nearby discoveries</div>';
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
