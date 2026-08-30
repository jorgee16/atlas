import {
  deleteTrack,
  listTracks,
  parseGpxFile,
  saveTrack
} from './tracks-store.js';

const TRACK_JOIN_THRESHOLD_METERS = 80;

const EMPTY_LIBRARY_HTML = `
  <div class="tracks-empty">
    <span class="tracks-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 19c2.6-5.4 3.8-11 7-14 1.8-1.7 4.3-1.5 5.4.2 1.2 1.9-.2 4.1 5.1-2.4 1.4-4.1 2.8-3.6 5 .4 1.9 2.6 2.8 6.2 2.7"></path><circle cx="5" cy="19" r="1.7"></circle><circle cx="18" cy="18" r="1.7"></circle></svg></span>
    <strong>No tracks yet</strong>
    <p>Import a GPX file to preview the trail and inspect distance, elevation and duration.</p>
    <button id="tracksEmptyImportBtn" type="button">Choose GPX file</button>
  </div>`;

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—';
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  const totalMinutes = Math.round(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes} min`;
}

function fileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'GPX';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function distanceMeters(a, b) {
  const radius = 6371000;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const deltaLat = (b.lat - a.lat) * Math.PI / 180;
  const deltaLon = (b.lon - a.lon) * Math.PI / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function cumulativeDistances(points) {
  const distances = new Array(points.length).fill(0);
  for (let index = 1; index < points.length; index += 1) {
    distances[index] = distances[index - 1] + distanceMeters(
      points[index - 1],
      points[index]
    );
  }
  return distances;
}

function nearestTrackPoint(points, position) {
  let bestIndex = 0;
  let bestDistance = Infinity;

  for (let index = 0; index < points.length; index += 1) {
    const distance = distanceMeters(points[index], position);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }

  return { index: bestIndex, distanceMeters: bestDistance };
}

function elevationProfile(points) {
  const elevations = points
    .map((point, index) => ({ index, elevation: point.elevation }))
    .filter(point => Number.isFinite(point.elevation));

  if (elevations.length < 2) {
    return '<div class="tracks-no-elevation">No elevation data in this GPX.</div>';
  }

  const maxSamples = 120;
  const stride = Math.max(1, Math.ceil(elevations.length / maxSamples));
  const samples = elevations.filter((_, index) => index % stride === 0);
  if (samples.at(-1) !== elevations.at(-1)) samples.push(elevations.at(-1));

  const minimum = Math.min(...samples.map(point => point.elevation));
  const maximum = Math.max(...samples.map(point => point.elevation));
  const range = Math.max(1, maximum - minimum);
  const width = 320;
  const height = 88;
  const padding = 6;

  const polyline = samples.map((point, index) => {
    const x = samples.length === 1
      ? padding
      : padding + index / (samples.length - 1) * (width - padding * 2);
    const y = height - padding -
      (point.elevation - minimum) / range * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return `
    <div class="tracks-elevation-chart" aria-label="Elevation profile from ${Math.round(minimum)} to ${Math.round(maximum)} metres">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-hidden="true">
        <polyline points="${polyline}"></polyline>
      </svg>
      <div class="tracks-elevation-range"><span>${Math.round(minimum)} m</span><span>${Math.round(maximum)} m</span></div>
    </div>`;
}

export function installTracksShellUI(root) {
  if (!root || root.dataset.tracksShellInstalled === 'true') return;

  const appTabs = root.querySelector('#appTabs');
  const mapWrap = root.querySelector('.map-wrap');
  const overflowMenu = root.querySelector('#overflowMenu');
  const moreButton = root.querySelector('#moreBtn');
  const tripTab = appTabs?.querySelector('[data-app-tab="trip"]');
  const navigationTab = appTabs?.querySelector('[data-app-tab="navigation"]');

  if (!appTabs || !mapWrap || !overflowMenu || !tripTab || !navigationTab) return;

  root.dataset.tracksShellInstalled = 'true';

  tripTab.hidden = true;
  tripTab.classList.add('app-tab--overflow-only');

  const tracksTab = document.createElement('button');
  tracksTab.type = 'button';
  tracksTab.className = 'app-tab';
  tracksTab.dataset.tracksTab = 'true';
  tracksTab.innerHTML = `
    <span class="app-tab-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M5 19c2.6-5.4 3.8-11 7-14 1.8-1.7 4.3-1.5 5.4.2 1.2 1.9-.2 4.1 5.1-2.4 1.4-4.1 2.8-3.6 5 .4 1.9 2.6 2.8 6.2 2.7"></path><circle cx="5" cy="19" r="1.7"></circle><circle cx="18" cy="18" r="1.7"></circle></svg>
    </span>
    <strong>Tracks</strong>`;
  navigationTab.before(tracksTab);

  const tripMenuButton = document.createElement('button');
  tripMenuButton.id = 'menuTripBtn';
  tripMenuButton.type = 'button';
  tripMenuButton.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18H6z"></path><path d="M9 7h6M9 11h6M9 15h4"></path></svg>
    <span>Trip</span>`;
  overflowMenu.prepend(tripMenuButton);

  const tracksWorkspace = document.createElement('section');
  tracksWorkspace.id = 'tracksWorkspace';
  tracksWorkspace.className = 'app-workspace tracks-workspace';
  tracksWorkspace.setAttribute('aria-label', 'Tracks');
  tracksWorkspace.hidden = true;
  tracksWorkspace.innerHTML = `
    <div class="tracks-card">
      <header class="tracks-header">
        <div><small>OFFLINE TRAILS</small><h2>Your tracks</h2><p>Import GPX trails, keep them on-device and preview them directly on the map.</p></div>
        <button id="tracksImportBtn" class="tracks-import-primary" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4"></path><path d="m7 9 5-5 5 5"></path><path d="M5 14v5h14v-5"></path></svg><span>Import GPX</span></button>
      </header>
      <input id="tracksFileInput" type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden>
      <div class="tracks-library-heading"><div><strong>Saved tracks</strong><small>Stored on this device</small></div><span id="tracksCount" class="tracks-count">0</span></div>
      <div id="tracksLibrary" class="tracks-library" aria-live="polite">${EMPTY_LIBRARY_HTML}</div>
      <footer class="tracks-format-note"><span>GPX</span><p>GPX tracks are parsed locally. The source file never needs to leave the device.</p></footer>
      <section id="tracksDetail" class="tracks-detail" hidden></section>
    </div>`;

  root.querySelector('#navigationWorkspace')?.before(tracksWorkspace);

  const card = tracksWorkspace.querySelector('.tracks-card');
  const importButton = tracksWorkspace.querySelector('#tracksImportBtn');
  const fileInput = tracksWorkspace.querySelector('#tracksFileInput');
  const library = tracksWorkspace.querySelector('#tracksLibrary');
  const count = tracksWorkspace.querySelector('#tracksCount');
  const detail = tracksWorkspace.querySelector('#tracksDetail');
  const transientMapControls = [
    root.querySelector('#searchAreaBtn'),
    root.querySelector('#routePlannerBtn'),
    root.querySelector('#recenterBtn'),
    root.querySelector('#compassBtn')
  ].filter(Boolean);
  const controlHiddenState = new Map();
  let tracks = [];
  let tracksActive = false;
  let selectedTrackId = null;
  let detailTrackId = null;
  let activeTrackId = null;
  let gpsWatchId = null;
  let lastTrackProgress = null;
  let furthestTrackIndex = 0;
  let hasJoinedTrack = false;

  const app = globalThis.roamApp;
  const atlasMap = app?.appContext?.map ?? null;
  const status = app?.appContext?.status ?? (() => {});

  const clearTrackPreview = () => {
    selectedTrackId = null;
    atlasMap?.clearRoute?.();
  };

  const previewTrack = track => {
    if (!track?.points?.length || !atlasMap) return;
    selectedTrackId = track.id;
    atlasMap.showRoute({ points: track.points });
    atlasMap.fitRoute({ points: track.points });
    renderTracks();
  };

  const renderDetail = () => {
    const track = tracks.find(candidate => candidate.id === detailTrackId);
    if (!track) {
      detail.hidden = true;
      card.classList.remove('tracks-card--detail');
      return;
    }

    const stats = track.stats ?? {};
    const tracking = activeTrackId === track.id;
    const progress = tracking ? lastTrackProgress : null;
    const duration = formatDuration(stats.durationMs);
    const progressLabel = !progress
      ? 'Waiting for GPS…'
      : progress.offTrack
        ? 'Off track'
        : `${Math.round(progress.percent)}%`;

    detail.innerHTML = `
      <div class="tracks-detail-toolbar">
        <button class="tracks-detail-back" type="button" aria-label="Back to saved tracks">‹</button>
        <div><small>TRACK DETAIL</small><h2></h2></div>
      </div>
      <div class="tracks-detail-stats">
        <div><strong>${formatDistance(stats.distanceMeters)}</strong><span>Distance</span></div>
        <div><strong>${Number.isFinite(stats.ascentMeters) ? `${stats.ascentMeters} m` : '—'}</strong><span>Ascent</span></div>
        <div><strong>${Number.isFinite(stats.descentMeters) ? `${stats.descentMeters} m` : '—'}</strong><span>Descent</span></div>
        <div><strong>${duration ?? stats.pointCount ?? track.points.length}</strong><span>${duration ? 'Recorded time' : 'Points'}</span></div>
      </div>
      <div class="tracks-detail-section">
        <div class="tracks-detail-section-title"><strong>Elevation</strong><span>${stats.pointCount ?? track.points.length} GPX points</span></div>
        ${elevationProfile(track.points)}
      </div>
      <div class="tracks-live-progress ${progress?.offTrack ? 'is-off-track' : ''}" ${tracking ? '' : 'hidden'}>
        <div class="tracks-live-progress-head"><strong>Following track</strong><span>${progressLabel}</span></div>
        <div class="tracks-progress-bar"><i style="width:${progress ? Math.max(0, Math.min(100, progress.percent)) : 0}%"></i></div>
        <div class="tracks-live-metrics">
          <div><strong>${progress ? formatDistance(progress.remainingMeters) : '—'}</strong><span>Remaining</span></div>
          <div><strong>${progress ? formatDistance(progress.offTrackMeters) : '—'}</strong><span>From track</span></div>
          <div><strong>${progress?.accuracy ? `±${Math.round(progress.accuracy)} m` : '—'}</strong><span>GPS</span></div>
        </div>
      </div>
      <button class="tracks-start-button ${tracking ? 'is-active' : ''}" type="button">
        ${tracking ? 'Stop track' : 'Start track'}
      </button>`;

    detail.querySelector('h2').textContent = track.name;
    detail.querySelector('.tracks-detail-back').addEventListener('click', closeDetail);
    detail.querySelector('.tracks-start-button').addEventListener('click', () => {
      if (tracking) stopTrack();
      else startTrack(track);
    });
  };

  const openDetail = track => {
    detailTrackId = track.id;
    previewTrack(track);
    card.classList.add('tracks-card--detail');
    detail.hidden = false;
    renderDetail();
  };

  function closeDetail() {
    if (activeTrackId) stopTrack();
    detailTrackId = null;
    detail.hidden = true;
    card.classList.remove('tracks-card--detail');
    renderTracks();
  }

  function stopTrack() {
    if (gpsWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchId);
    }
    gpsWatchId = null;
    activeTrackId = null;
    lastTrackProgress = null;
    furthestTrackIndex = 0;
    hasJoinedTrack = false;
    root.classList.remove('tracks-following');
    renderDetail();
    status('Track stopped', 'GPX remains available offline.');
  }

  function startTrack(track) {
    if (!navigator.geolocation) {
      status('GPS unavailable', 'This device does not expose geolocation.');
      return;
    }

    if (gpsWatchId !== null) stopTrack();

    const distances = cumulativeDistances(track.points);
    const totalDistance = distances.at(-1) || track.stats?.distanceMeters || 0;
    activeTrackId = track.id;
    lastTrackProgress = null;
    furthestTrackIndex = 0;
    hasJoinedTrack = false;
    root.classList.add('tracks-following');
    renderDetail();
    status('Track started', 'Following the GPX without recalculating the route.');

    gpsWatchId = navigator.geolocation.watchPosition(
      position => {
        if (activeTrackId !== track.id) return;

        const current = {
          lat: position.coords.latitude,
          lon: position.coords.longitude
        };
        const nearest = nearestTrackPoint(track.points, current);
        const onTrack = nearest.distanceMeters <= TRACK_JOIN_THRESHOLD_METERS;

        if (onTrack) {
          hasJoinedTrack = true;
          furthestTrackIndex = Math.max(furthestTrackIndex, nearest.index);
        }

        const confirmedIndex = hasJoinedTrack ? furthestTrackIndex : 0;
        const travelled = distances[confirmedIndex] ?? 0;
        const remaining = Math.max(0, totalDistance - travelled);
        const percent = totalDistance > 0
          ? travelled / totalDistance * 100
          : 0;

        lastTrackProgress = {
          percent,
          remainingMeters: remaining,
          offTrackMeters: nearest.distanceMeters,
          accuracy: position.coords.accuracy,
          offTrack: !onTrack,
          joined: hasJoinedTrack
        };

        atlasMap?.followPosition?.({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          heading: position.coords.heading,
          speed: position.coords.speed,
          accuracy: position.coords.accuracy
        }, {
          zoom: 16,
          headingUp: false
        });

        renderDetail();
      },
      error => {
        console.error('Track GPS failed:', error);
        status('GPS unavailable', error.message ?? 'Could not follow your position.');
        stopTrack();
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000
      }
    );
  }

  const bindEmptyImport = () => {
    library.querySelector('#tracksEmptyImportBtn')?.addEventListener(
      'click',
      () => fileInput.click()
    );
  };

  const renderTracks = () => {
    count.textContent = String(tracks.length);

    if (!tracks.length) {
      library.innerHTML = EMPTY_LIBRARY_HTML;
      bindEmptyImport();
      return;
    }

    library.replaceChildren();

    for (const track of tracks) {
      const item = document.createElement('article');
      item.className = 'tracks-file-card';
      item.classList.toggle('tracks-file-card--selected', track.id === selectedTrackId);
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', `Open ${track.name}`);

      const duration = formatDuration(track.stats?.durationMs);
      const ascent = Number.isFinite(track.stats?.ascentMeters)
        ? `↗ ${track.stats.ascentMeters} m`
        : null;
      const facts = [
        formatDistance(track.stats?.distanceMeters),
        ascent,
        duration
      ].filter(Boolean).join(' · ');

      item.innerHTML = `
        <span class="tracks-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 19c2.6-5.4 3.8-11 7-14 1.8-1.7 4.3-1.5 5.4.2 1.2 1.9-.2 4.1 5.1-2.4 1.4-4.1 2.8-3.6 5 .4 1.9 2.6 2.8 6.2 2.7"></path></svg></span>
        <div class="tracks-file-copy"><strong></strong><span><b>GPX</b> · ${fileSize(track.fileSize)} · ${track.stats?.pointCount ?? track.points.length} pts</span><small>${facts}</small></div>
        <button class="tracks-file-delete" type="button" aria-label="Delete track">×</button>`;
      item.querySelector('strong').textContent = track.name;

      const open = () => openDetail(track);
      item.addEventListener('click', event => {
        if (event.target.closest('.tracks-file-delete')) return;
        open();
      });
      item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
      item.querySelector('.tracks-file-delete').addEventListener('click', async event => {
        event.stopPropagation();
        if (activeTrackId === track.id) stopTrack();
        await deleteTrack(track.id);
        tracks = tracks.filter(candidate => candidate.id !== track.id);
        if (selectedTrackId === track.id) clearTrackPreview();
        if (detailTrackId === track.id) closeDetail();
        renderTracks();
        status('Track deleted', track.name);
      });

      library.append(item);
    }
  };

  const setTracksActive = active => {
    tracksActive = active;
    tracksWorkspace.hidden = !active;
    tracksTab.classList.toggle('on', active);
    root.classList.toggle('tracks-active', active);

    if (active) {
      tracksTab.setAttribute('aria-current', 'page');
      for (const button of appTabs.querySelectorAll('[data-app-tab]')) {
        button.classList.remove('on');
        button.removeAttribute('aria-current');
      }
      for (const workspace of root.querySelectorAll('#exploreWorkspace, #tripWorkspace, #navigationWorkspace')) {
        workspace.hidden = true;
      }

      for (const control of transientMapControls) {
        controlHiddenState.set(control, control.hidden);
        control.hidden = true;
      }
      return;
    }

    if (activeTrackId) stopTrack();
    detailTrackId = null;
    detail.hidden = true;
    card.classList.remove('tracks-card--detail');
    tracksTab.removeAttribute('aria-current');
    clearTrackPreview();
    for (const control of transientMapControls) {
      if (controlHiddenState.has(control)) {
        control.hidden = controlHiddenState.get(control);
      }
    }
    controlHiddenState.clear();
  };

  importButton.addEventListener('click', () => fileInput.click());
  bindEmptyImport();

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;

    if (!/\.gpx$/i.test(file.name)) {
      status('Unsupported track', 'Choose a GPX file.');
      return;
    }

    importButton.disabled = true;
    importButton.classList.add('is-loading');

    try {
      const track = await parseGpxFile(file);
      await saveTrack(track);
      tracks.unshift(track);
      renderTracks();
      openDetail(track);
      status('Track imported', `${track.name} · ${formatDistance(track.stats.distanceMeters)}`);
    } catch (error) {
      console.error('GPX import failed:', error);
      status('Could not import GPX', error?.message ?? 'Invalid GPX file.');
    } finally {
      importButton.disabled = false;
      importButton.classList.remove('is-loading');
    }
  });

  tracksTab.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    setTracksActive(true);
  }, true);

  appTabs.addEventListener('click', event => {
    const appTab = event.target.closest?.('[data-app-tab]');
    if (appTab && tracksActive) setTracksActive(false);
  }, true);

  tripMenuButton.addEventListener('click', () => {
    setTracksActive(false);
    overflowMenu.hidden = true;
    moreButton?.setAttribute('aria-expanded', 'false');
    tripTab.click();
  });

  void listTracks()
    .then(savedTracks => {
      tracks = savedTracks;
      renderTracks();
    })
    .catch(error => {
      console.error('Could not load saved tracks:', error);
      status('Tracks unavailable', 'Could not open local track storage.');
    });
}
