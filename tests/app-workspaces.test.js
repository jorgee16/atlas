import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shellPath = new URL('../src/ui/app-shell.js', import.meta.url);
const bootstrapPath = new URL('../src/core/app-bootstrap.js', import.meta.url);

test('Explore and Trip are persistent tab workspaces rather than bottom-sheet modes', async () => {
  const shell = await readFile(shellPath, 'utf8');
  const sheetStart = shell.indexOf('id="bottomSheet"');
  const explore = shell.indexOf('id="exploreWorkspace"');
  const trip = shell.indexOf('id="tripWorkspace"');

  assert.ok(explore >= 0);
  assert.ok(trip >= 0);
  assert.ok(explore < sheetStart);
  assert.ok(trip < sheetStart);
  assert.doesNotMatch(shell.slice(sheetStart), /id="explorePanel"/);
  assert.doesNotMatch(shell.slice(sheetStart), /id="tripPanel"/);
});

test('tab selection hides the sheet and directly switches Explore, Trip, and Navigation workspaces', async () => {
  const bootstrap = await readFile(bootstrapPath, 'utf8');

  assert.match(bootstrap, /panelController\.hidePanel\(\)/);
  assert.match(bootstrap, /syncWorkspaceVisibility/);
  assert.match(bootstrap, /activeAppTab !== 'explore'/);
  assert.match(bootstrap, /activeAppTab !== 'trip'/);
  assert.match(bootstrap, /activeAppTab !== 'navigation'/);
  assert.doesNotMatch(bootstrap, /showMode\('trip', \{ snap: 'half' \}\)/);
  assert.doesNotMatch(bootstrap, /showMode\('explore', \{ snap: 'fit' \}\)/);
});


test('Trip map stop exposes Nearby and Navigate without a redundant Schedule action', async () => {
  const feature = await readFile(
    new URL('../src/features/trip/trip-feature.js', import.meta.url),
    'utf8'
  );
  const bootstrap = await readFile(bootstrapPath, 'utf8');

  assert.match(feature, /data-trip-nearby>Nearby<\/button>/);
  assert.match(feature, /data-trip-navigate>Navigate<\/button>/);
  assert.doesNotMatch(feature, /data-trip-back-schedule/);
  assert.match(bootstrap, /addEventListener\('tripnearby'/);
  assert.match(bootstrap, /selectAppTab\('explore'\)/);
  assert.match(bootstrap, /nearbyFeature\.search\(place\)/);
});

test('Trip keeps its selected stop live when the workspace is restored', async () => {
  const feature = await readFile(
    new URL('../src/features/trip/trip-feature.js', import.meta.url),
    'utf8'
  );

  assert.match(feature, /const selected = this\.selected;/);
  assert.match(feature, /this\.itinerary\.render\(day\);/);
  assert.match(feature, /this\.itinerary\.selected = selected;/);
  assert.match(feature, /this\.#renderSelectedStop\(selected\);/);
});


test('map point Nearby opens Explore immediately and global full-map mode is dismissible', async () => {
  const shell = await readFile(
    new URL('../src/ui/app-shell.js', import.meta.url),
    'utf8'
  );
  const bootstrap = await readFile(bootstrapPath, 'utf8');
  const plugin = await readFile(
    new URL('../src/features/map-selection/map-selection-plugin.js', import.meta.url),
    'utf8'
  );
  const nearby = await readFile(
    new URL('../src/features/nearby/nearby-feature.js', import.meta.url),
    'utf8'
  );

  assert.match(plugin, /CustomEvent\('mapnearby'/);
  assert.match(bootstrap, /addEventListener\('mapnearby'/);
  assert.match(bootstrap, /selectAppTab\('explore', \{ revealExplore: true \}\)/);
  assert.match(shell, /id="fullMapBtn"/);
  assert.match(bootstrap, /workspaceChromeVisible/);
  assert.match(bootstrap, /setWorkspaceChrome\(activeAppTab, !visible\)/);
  assert.match(nearby, /data-nearby-dismiss/);
  assert.match(nearby, /dismissResults\(\)/);
});

test('Trip navigation carries itinerary stop context into the Navigation workspace', async () => {
  const feature = await readFile(
    new URL('../src/features/trip/trip-feature.js', import.meta.url),
    'utf8'
  );
  const plugin = await readFile(
    new URL('../src/features/trip/trip-plugin.js', import.meta.url),
    'utf8'
  );
  const bootstrap = await readFile(bootstrapPath, 'utf8');

  assert.match(feature, /getNavigationContext\(place = this\.selected\)/);
  assert.match(feature, /type: 'itinerary'/);
  assert.match(feature, /nextStop/);
  assert.match(feature, /isFinalStop: nextStop === null/);
  assert.match(plugin, /detail: \{ place, navigationContext \}/);
  assert.match(bootstrap, /setPlannerDestination\(place, \{/);
  assert.match(bootstrap, /context: navigationContext/);
});


test('full-map focus is shared by Explore, Trip, and Navigation and active-tab tap restores chrome', async () => {
  const shell = await readFile(shellPath, 'utf8');
  const bootstrap = await readFile(bootstrapPath, 'utf8');

  assert.match(shell, /id="fullMapBtn"/);
  assert.match(bootstrap, /explore: true,/);
  assert.match(bootstrap, /trip: true,/);
  assert.match(bootstrap, /navigation: true/);
  assert.match(bootstrap, /workspaceChromeVisible\[activeAppTab\]/);
  assert.match(bootstrap, /tab === activeAppTab && workspaceChromeVisible\[tab\] === false/);
  assert.match(bootstrap, /selectAppTab\(tab, \{ reveal \}\)/);
});

test('top map controls avoid duplicate bookmark and region actions', async () => {
  const shell = await readFile(shellPath, 'utf8');

  assert.match(shell, /id="saveBookmarkBtn"[\s\S]*?hidden/);
  assert.match(shell, /id="offlineRegionsBtn"[\s\S]*?hidden/);
  assert.match(shell, /id="menuBookmarksBtn"/);
  assert.match(shell, /id="menuRegionsBtn"/);
});

test('final mobile shell uses semantic compact controls and safe-area polish', async () => {
  const shell = await readFile(new URL('../src/ui/app-shell.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const bootstrap = await readFile(new URL('../src/core/app-bootstrap.js', import.meta.url), 'utf8');

  assert.match(shell, /id="moreBtn"[\s\S]*aria-expanded="false"[\s\S]*aria-controls="overflowMenu"/);
  assert.match(shell, /class="app-tab-icon"/);
  assert.match(styles, /\.overflow-menu\s*\{/);
  assert.match(styles, /--safe-top:\s*env\(safe-area-inset-top/);
  assert.match(styles, /100dvh/);
  assert.match(styles, /max-height:\s*560px[\s\S]*orientation:\s*landscape/);
  assert.match(bootstrap, /event\.key !== 'Escape'/);
  assert.match(bootstrap, /moreButton\?\.setAttribute\('aria-expanded', 'false'\)/);
});


test('Bookmarks is a secondary library overlay and no longer a draggable-sheet mode', async () => {
  const shell = await readFile(shellPath, 'utf8');
  const bootstrap = await readFile(bootstrapPath, 'utf8');
  const feature = await readFile(
    new URL('../src/features/bookmarks/bookmarks-feature.js', import.meta.url),
    'utf8'
  );

  const sheetStart = shell.indexOf('id="bottomSheet"');
  assert.match(shell, /id="bookmarksOverlay"/);
  assert.match(shell, /id="closeBookmarksBtn"/);
  assert.match(shell, /id="bookmarkMapCard"/);
  assert.doesNotMatch(shell.slice(sheetStart), /id="bookmarksPanel"/);
  assert.doesNotMatch(bootstrap, /registerMode\('bookmarks'/);
  assert.match(bootstrap, /bookmarksFeature\.onShow = \(\) => showBookmarksOverlay\(\)/);
  assert.match(bootstrap, /panelController\.hidePanel\(\)/);
  assert.match(feature, /this\.onFocus\(bookmark\)/);
});

test('bookmark map context exposes nearby, navigation and removal without reopening a sheet', async () => {
  const shell = await readFile(shellPath, 'utf8');
  const bootstrap = await readFile(bootstrapPath, 'utf8');

  assert.match(shell, /id="bookmarkMapNearbyBtn"[\s\S]*?>Nearby<\/button>/);
  assert.match(shell, /id="bookmarkMapNavigateBtn"[\s\S]*?>Navigate<\/button>/);
  assert.match(shell, /id="bookmarkMapRemoveBtn"[\s\S]*?>Remove<\/button>/);
  assert.match(bootstrap, /nearbyFeature\.search\(bookmark\)/);
  assert.match(bootstrap, /navigationFeature\.setPlannerDestination\(bookmark\)/);
  assert.match(bootstrap, /bookmarksFeature\.remove\(bookmark\.id\)/);
  assert.match(bootstrap, /setWorkspaceChrome\(activeAppTab, false\)/);
});

test('Navigation and trip loading are not duplicated in the overflow menu', async () => {
  const shell = await readFile(shellPath, 'utf8');

  assert.doesNotMatch(shell, /id="menuNavigationBtn"/);
  assert.doesNotMatch(shell, /id="menuLoadTripBtn"/);
  assert.match(shell, /id="tripLibraryBtn"/);
  assert.match(shell, /id="tripImportBtn"/);
});

test('Trip workspace exposes a persistent saved-trip library', async () => {
  const shell = await readFile(shellPath, 'utf8');
  const bootstrap = await readFile(bootstrapPath, 'utf8');
  const store = await readFile(
    new URL('../src/features/trip/trip-store.js', import.meta.url),
    'utf8'
  );

  assert.match(shell, /id="tripLibraryView"/);
  assert.match(shell, /id="tripLibraryList"/);
  assert.match(bootstrap, /new TripStore\(\)/);
  assert.match(bootstrap, /tripStore\.upsert/);
  assert.match(bootstrap, /restoreStoredTrip\(\)/);
  assert.match(store, /roam\.trips\.v1/);
});

test('Trip uses the A+C itinerary model with a schedule timeline and synchronized map strip', async () => {
  const shell = await readFile(shellPath, 'utf8');
  const feature = await readFile(
    new URL('../src/features/trip/trip-feature.js', import.meta.url),
    'utf8'
  );
  const itinerary = await readFile(
    new URL('../src/itinerary.js', import.meta.url),
    'utf8'
  );

  assert.match(shell, /id="tripMapTimeline"/);
  assert.match(shell, /id="tripMapStopCount"/);
  assert.match(itinerary, /trip-timeline-stop/);
  assert.match(itinerary, /trip-stop-inline-actions/);
  assert.match(feature, /#renderMapTimeline/);
  assert.match(feature, /source === 'map-timeline'/);
  assert.match(feature, /restoreSelection\(selected\)/);
});

test('Settings is a real overlay with appearance, navigation and offline controls', async () => {
  const shell = await readFile(shellPath, 'utf8');
  const bootstrap = await readFile(bootstrapPath, 'utf8');
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

  assert.match(shell, /id="settingsOverlay"/);
  assert.match(shell, /data-settings-theme="system"/);
  assert.match(shell, /data-settings-theme="dark"/);
  assert.match(shell, /data-settings-travel-mode="drive"/);
  assert.match(shell, /id="settingsVoiceBtn"/);
  assert.match(shell, /id="settingsRegionsBtn"/);
  assert.match(bootstrap, /new AppearancePreference\(\)/);
  assert.match(bootstrap, /navigationFeature\.setTravelMode/);
  assert.match(bootstrap, /navigationFeature\.setVoiceGuidanceEnabled/);
  assert.match(bootstrap, /showSettingsOverlay\(\)/);
  assert.doesNotMatch(bootstrap, /Settings are coming soon/);
  assert.match(styles, /html\[data-atlas-theme="dark"\]/);
});
