import {
  deleteTrack,
  listTracks,
  parseGpxFile,
  saveTrack
} from './tracks-store.js';

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
    </div>`;

  root.querySelector('#navigationWorkspace')?.before(tracksWorkspace);

  const importButton = tracksWorkspace.querySelector('#tracksImportBtn');
  const fileInput = tracksWorkspace.querySelector('#tracksFileInput');
  const library = tracksWorkspace.querySelector('#tracksLibrary');
  const count = tracksWorkspace.querySelector('#tracksCount');
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
      item.setAttribute('aria-label', `Preview ${track.name}`);

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

      const open = () => previewTrack(track);
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
        await deleteTrack(track.id);
        tracks = tracks.filter(candidate => candidate.id !== track.id);
        if (selectedTrackId === track.id) clearTrackPreview();
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
      previewTrack(track);
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
