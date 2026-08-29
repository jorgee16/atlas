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
        <div><small>OFFLINE TRAILS</small><h2>Your tracks</h2><p>Import a GPX trail and keep it available on this device.</p></div>
        <button id="tracksImportBtn" class="tracks-import-primary" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4"></path><path d="m7 9 5-5 5 5"></path><path d="M5 14v5h14v-5"></path></svg><span>Import GPX</span></button>
      </header>
      <input id="tracksFileInput" type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden>
      <div class="tracks-library-heading"><div><strong>Saved tracks</strong><small>On this device</small></div><span id="tracksCount" class="tracks-count">0</span></div>
      <div id="tracksLibrary" class="tracks-library" aria-live="polite">
        <div class="tracks-empty">
          <span class="tracks-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 19c2.6-5.4 3.8-11 7-14 1.8-1.7 4.3-1.5 5.4.2 1.2 1.9-.2 4.1 5.1-2.4 1.4-4.1 2.8-3.6 5 .4 1.9 2.6 2.8 6.2 2.7"></path><circle cx="5" cy="19" r="1.7"></circle><circle cx="18" cy="18" r="1.7"></circle></svg></span>
          <strong>No tracks yet</strong>
          <p>Import a GPX file to preview the trail, inspect its statistics and later navigate the exact track.</p>
          <button id="tracksEmptyImportBtn" type="button">Choose GPX file</button>
        </div>
      </div>
      <footer class="tracks-format-note"><span>GPX</span><p>GPX is the first supported trail format. KML/KMZ will use the same library later.</p></footer>
    </div>`;

  root.querySelector('#navigationWorkspace')?.before(tracksWorkspace);

  const importButton = tracksWorkspace.querySelector('#tracksImportBtn');
  const emptyImportButton = tracksWorkspace.querySelector('#tracksEmptyImportBtn');
  const fileInput = tracksWorkspace.querySelector('#tracksFileInput');
  const library = tracksWorkspace.querySelector('#tracksLibrary');
  const count = tracksWorkspace.querySelector('#tracksCount');
  const importedFiles = [];
  let tracksActive = false;

  const setTracksActive = active => {
    tracksActive = active;
    tracksWorkspace.hidden = !active;
    tracksTab.classList.toggle('on', active);
    if (active) {
      tracksTab.setAttribute('aria-current', 'page');
      for (const button of appTabs.querySelectorAll('[data-app-tab]')) {
        button.classList.remove('on');
        button.removeAttribute('aria-current');
      }
      for (const workspace of root.querySelectorAll('#exploreWorkspace, #tripWorkspace, #navigationWorkspace')) workspace.hidden = true;
    } else {
      tracksTab.removeAttribute('aria-current');
    }
  };

  const fileSize = bytes => {
    if (!Number.isFinite(bytes) || bytes <= 0) return 'GPX file';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderFiles = () => {
    count.textContent = String(importedFiles.length);
    if (!importedFiles.length) return;
    library.replaceChildren();
    for (const file of importedFiles) {
      const item = document.createElement('article');
      item.className = 'tracks-file-card';
      const name = file.name.replace(/\.gpx$/i, '') || 'Imported track';
      item.innerHTML = `<span class="tracks-file-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 19c2.6-5.4 3.8-11 7-14 1.8-1.7 4.3-1.5 5.4.2 1.2 1.9-.2 4.1 5.1-2.4 1.4-4.1 2.8-3.6 5 .4 1.9 2.6 2.8 6.2 2.7"></path></svg></span><div class="tracks-file-copy"><strong></strong><span><b>GPX</b> · ${fileSize(file.size)}</span><small>Ready for track parsing</small></div><span class="tracks-file-chevron" aria-hidden="true">›</span>`;
      item.querySelector('strong').textContent = name;
      library.append(item);
    }
  };

  const openPicker = () => fileInput.click();
  importButton.addEventListener('click', openPicker);
  emptyImportButton.addEventListener('click', openPicker);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file || !/\.gpx$/i.test(file.name)) return;
    importedFiles.unshift(file);
    renderFiles();
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
}
