export function renderAppShell(root) {
  if (!root) {
    throw new TypeError(
      'renderAppShell requires a root element.'
    );
  }

  root.innerHTML = `
    <div class="app">
      <main class="map-wrap">
        <div id="map" class="map"></div>

        <header class="map-header">
          <div class="brand-inline">
            <span class="brand-mark" aria-hidden="true">
              <svg class="atlas-mark" viewBox="0 0 24 24">
                <path d="M12 3 4.5 20h3.8l1.3-3.4h4.8l1.3 3.4h3.8L12 3Z"></path>
                <path d="M10.8 13.5h2.4L12 10.2l-1.2 3.3Z"></path>
              </svg>
            </span>

            <div class="brand-copy">
              <strong id="map-context-title">Atlas</strong>
              <small id="map-context-subtitle">Explore the map</small>
            </div>
          </div>

          <div class="map-header-actions">
            <button
              id="saveBookmarkBtn"
              class="icon-btn"
              hidden
              type="button"
              aria-label="Save bookmark"
              title="Save bookmark"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2 7.5 14 3 9.6l6.2-.9Z"></path></svg>
            </button>

            <button
              id="offlineRegionsBtn"
              class="icon-btn"
              hidden
              type="button"
              aria-label="Offline regions"
              title="Offline regions"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"></path><path d="M9 3v15M15 6v15"></path><path d="m17.3 11.7 1.2 1.2 2.4-2.8"></path></svg>
            </button>

            <button
              id="fullMapBtn"
              class="icon-btn map-focus-btn"
              type="button"
              aria-label="Show full map"
              title="Full map"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path></svg>
            </button>

            <button
              id="followBtn"
              class="icon-btn on"
              type="button"
              aria-label="Stop following my location"
              title="Stop following"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"></path></svg>
            </button>

            <button
              id="gpsBtn"
              class="icon-btn"
              type="button"
              aria-label="Toggle GPS"
              title="Toggle GPS"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"></path><circle cx="12" cy="10" r="2"></circle></svg>
            </button>

            <button
              id="moreBtn"
              class="icon-btn"
              type="button"
              aria-label="Open menu"
              aria-expanded="false"
              aria-controls="overflowMenu"
              title="Open menu"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4"></circle><circle cx="12" cy="12" r="1.4"></circle><circle cx="19" cy="12" r="1.4"></circle></svg>
            </button>

            <div
              id="overflowMenu"
              class="overflow-menu"
              hidden
            >
              <button
                id="menuBookmarksBtn"
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 3h12v18l-6-4-6 4Z"></path>
                </svg>
                <span>Bookmarks</span>
              </button>


                            <button
                id="menuRegionsBtn"
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 6h16v12H4z"></path>
                  <path d="m4 8 5-3 6 3 5-3"></path>
                </svg>
                <span>Offline regions</span>
              </button>

<button
                id="menuSettingsBtn"
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"></path>
                </svg>
                <span>Settings</span>
              </button>

              <button
                id="menuAboutBtn"
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9"></circle>
                  <path d="M12 11v5"></path>
                  <path d="M12 8h.01"></path>
                </svg>
                <span>About Atlas</span>
              </button>
            </div>

            <input
              id="tripFileInput"
              type="file"
              accept="application/json,.json"
              hidden
            >

            <button id="loadTripBtn" type="button" hidden>
              Load trip
            </button>

            <button id="showBookmarksBtn" type="button" hidden>
              Bookmarks
            </button>
          </div>
        </header>

        <section
          id="exploreWorkspace"
          class="app-workspace explore-workspace"
          aria-label="Explore"
        >
          <div class="explore-category-bar" aria-label="Nearby place filters">
            <button class="chip on" data-cat="all" type="button">All</button>
            <button class="chip" data-cat="cafe" type="button">Cafés</button>
            <button class="chip" data-cat="restaurant" type="button">Food</button>
            <button class="chip" data-cat="pub" type="button">Pubs</button>
            <button class="chip" data-cat="attraction" type="button">Attractions</button>
          </div>
          <div id="exploreContent" class="explore-peek"></div>
        </section>

        <section
          id="tripWorkspace"
          class="app-workspace trip-workspace"
          aria-label="Trip"
          hidden
        >
          <div class="trip-workspace-card">
            <header class="trip-workspace-header">
              <div>
                <small>Trip</small>
                <strong id="tripTitle">Your trips</strong>
              </div>
              <div class="trip-header-actions">
                <button id="tripLibraryBtn" class="trip-library-btn" type="button" aria-expanded="false">Trips</button>
                <div class="trip-mode-switch" role="group" aria-label="Trip view">
                  <button type="button" class="on" data-trip-mode="schedule">Schedule</button>
                  <button type="button" data-trip-mode="map">Map</button>
                </div>
              </div>
            </header>

            <div id="tripLibraryView" class="trip-library-view" hidden>
              <div class="trip-library-toolbar">
                <div>
                  <small>Saved on this device</small>
                  <strong>Your trips</strong>
                </div>
                <button id="tripImportBtn" class="primary" type="button">+ Load trip</button>
              </div>
              <div id="tripLibraryList" class="trip-library-list"></div>
            </div>

            <div id="tripScheduleView" class="trip-schedule-view">
              <div class="trip-day-control">
                <label for="daySelect">Day</label>
                <select id="daySelect" aria-label="Select itinerary day"></select>
              </div>
              <div id="tripContent" class="trip-workspace-content"></div>
            </div>

            <div id="tripMapView" class="trip-map-view" hidden>
              <div class="trip-map-itinerary-head">
                <span>Itinerary</span>
                <small id="tripMapStopCount"></small>
              </div>
              <div id="tripMapTimeline" class="trip-map-timeline" aria-label="Trip stops"></div>
              <div id="tripSelectedStop" class="trip-selected-stop">
                <small>Select a stop from Schedule or tap a numbered pin.</small>
              </div>
            </div>
          </div>
        </section>

        <section
          id="navigationWorkspace"
          class="navigation-workspace"
          aria-label="Navigation"
          hidden
        >
          <div id="navigationWorkspaceContent" class="navigation-workspace-content"></div>
        </section>

        <section
          id="navigationGuidance"
          class="navigation-guidance"
          aria-live="polite"
          hidden
        ></section>

        
          

          <div class="map-actions">
            <button
              id="panelToggleBtn"
              class="panel-toggle"
              type="button"
              aria-label="Show panel"
              aria-pressed="false"
              title="Show panel"
              disabled
            >
              <span class="panel-toggle-label">
                Panel
              </span>

              <span
                class="panel-toggle-track"
                aria-hidden="true"
              >
                <span
                  class="panel-toggle-knob"
                ></span>
              </span>
            </button>

          <button
            id="searchAreaBtn"
            class="search-area-btn"
            type="button"
            hidden
          >
            Search this area
          </button>

          <button
            id="compassBtn"
            class="map-action navigation-compass"
            type="button"
            aria-label="Switch to north-up map"
            aria-pressed="true"
            title="Switch to north-up map"
            hidden
          >
            <span class="navigation-compass-arrow" aria-hidden="true">
              <b>N</b>
              <svg viewBox="0 0 24 24">
                <path d="m12 3 5 17-5-3-5 3Z"></path>
              </svg>
            </span>
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

      <section id="bookmarksOverlay" class="bookmarks-overlay" hidden aria-label="Bookmarks">
        <div class="bookmarks-overlay-card">
          <header class="bookmarks-overlay-header">
            <div><small>Saved places</small><h2>Bookmarks</h2></div>
            <button id="closeBookmarksBtn" type="button" aria-label="Close bookmarks">×</button>
          </header>

          <div id="bookmarksOverlayBody" class="bookmarks-overlay-body">
            <div id="bookmarkEditor" class="bookmark-editor" hidden>
              <div class="bookmark-editor-body">
                <label class="bookmark-field">
                  <span>Name <small>(optional)</small></span>
                  <input id="bookmarkNameInput" type="text" placeholder="e.g. Great view, Coffee shop" autocomplete="off">
                </label>
                <div class="bookmark-location-summary">
                  <span>Location selected on map</span>
                  <small id="bookmarkCoordinates">—</small>
                </div>
                <div class="bookmark-editor-actions">
                  <button id="cancelBookmarkBtn" class="bookmark-cancel-btn" type="button">Cancel</button>
                  <button id="confirmBookmarkBtn" class="bookmark-save-btn" type="button">Save bookmark</button>
                </div>
              </div>
            </div>
            <div id="bookmarksContent" class="bookmarks-content" aria-live="polite"></div>
          </div>
        </div>
      </section>

      <section id="bookmarkMapCard" class="bookmark-map-card" hidden aria-live="polite">
        <div class="bookmark-map-card-copy">
          <small>BOOKMARK</small>
          <strong id="bookmarkMapName">Saved place</strong>
          <span id="bookmarkMapCoordinates"></span>
        </div>
        <div class="bookmark-map-card-actions">
          <button id="bookmarkMapNearbyBtn" type="button">Nearby</button>
          <button id="bookmarkMapNavigateBtn" class="primary" type="button">Navigate</button>
          <button id="bookmarkMapRemoveBtn" type="button" aria-label="Remove bookmark">Remove</button>
        </div>
      </section>

      <section id="regionsOverlay" class="regions-overlay" hidden aria-label="Offline regions">
        <div class="regions-overlay-card">
          <header class="regions-overlay-header">
            <div><small>Maps, places & navigation</small><h2>Offline regions</h2></div>
            <button id="closeRegionsBtn" type="button" aria-label="Close offline regions">×</button>
          </header>
          <div id="regionsOverlayContent" class="regions-overlay-content"></div>
        </div>
      </section>

      <section id="settingsOverlay" class="settings-overlay" hidden aria-label="Settings">
        <div class="settings-overlay-card">
          <header class="settings-overlay-header">
            <div><small>Atlas preferences</small><h2>Settings</h2></div>
            <button id="closeSettingsBtn" type="button" aria-label="Close settings">×</button>
          </header>

          <div class="settings-overlay-content">
            <section class="settings-section">
              <div class="settings-section-title">
                <small>Appearance</small>
                <strong>Theme</strong>
              </div>
              <div class="settings-segmented" role="group" aria-label="Appearance">
                <button type="button" data-settings-theme="system">System</button>
                <button type="button" data-settings-theme="light">Light</button>
                <button type="button" data-settings-theme="dark">Dark</button>
              </div>
            </section>

            <section class="settings-section">
              <div class="settings-section-title">
                <small>Navigation</small>
                <strong>Default travel mode</strong>
              </div>
              <div class="settings-segmented" role="group" aria-label="Default travel mode">
                <button type="button" data-settings-travel-mode="drive">🚗 Drive</button>
                <button type="button" data-settings-travel-mode="walk">🚶 Walk</button>
              </div>

              <button id="settingsVoiceBtn" class="settings-row" type="button" aria-pressed="false">
                <span>
                  <strong>Voice guidance</strong>
                  <small>Spoken turn-by-turn instructions</small>
                </span>
                <span class="settings-switch" aria-hidden="true"><i></i></span>
              </button>
              <button id="settingsHeadingBtn" class="settings-row" type="button" aria-pressed="false"><span><strong>Heading-up</strong><small>Rotate the map with your direction while navigating</small></span><span class="settings-switch" aria-hidden="true"><i></i></span></button>
              <button id="settingsLaneBtn" class="settings-row" type="button" aria-pressed="false"><span><strong>Lane guidance</strong><small>Show lane recommendations near complex maneuvers</small></span><span class="settings-switch" aria-hidden="true"><i></i></span></button>
              <button id="settingsRerouteBtn" class="settings-row" type="button" aria-pressed="false"><span><strong>Auto-reroute</strong><small>Recalculate after a confirmed route deviation</small></span><span class="settings-switch" aria-hidden="true"><i></i></span></button>
            </section>
            <section class="settings-section"><div class="settings-section-title"><small>Map</small><strong>Follow zoom</strong></div><div class="settings-segmented" role="group" aria-label="Follow zoom"><button type="button" data-settings-follow-zoom="near">Near</button><button type="button" data-settings-follow-zoom="normal">Normal</button><button type="button" data-settings-follow-zoom="far">Far</button></div>
            </section>

            <section class="settings-section">
              <div class="settings-section-title">
                <small>Offline maps</small>
                <strong>Downloaded regions</strong>
              </div>
              <button id="settingsRegionsBtn" class="settings-row settings-row-link" type="button">
                <span>
                  <strong>Manage offline regions</strong>
                  <small>Maps, places and navigation data</small>
                </span>
                <b aria-hidden="true">›</b>
              </button>
            </section>
          </div>
        </div>
      </section>

      <nav id="appTabs" class="app-tabs" aria-label="Main sections">
        <button type="button" class="app-tab on" data-app-tab="explore" aria-current="page">
          <span class="app-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path><circle cx="12" cy="12" r="8"></circle></svg></span>
          <strong>Explore</strong>
        </button>
        <button type="button" class="app-tab" data-app-tab="trip">
          <span class="app-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h12v18H6z"></path><path d="M9 7h6M9 11h6M9 15h4"></path></svg></span>
          <strong>Trip</strong>
        </button>
        <button type="button" class="app-tab" data-app-tab="navigation">
          <span class="app-tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 3 7 18-7-4-7 4Z"></path></svg></span>
          <strong>Navigation</strong>
        </button>
      </nav>

      <aside
        class="sidebar bottom-sheet"
        id="bottomSheet"
        hidden
      >
        <button
          id="sheetToggle"
          class="sheet-handle"
          type="button"
          aria-label="Expand or collapse panel"
        >
          <span></span>
        </button>

        <div class="panel-host">
          <section
            id="regionsPanel"
            class="panel-view"
            data-panel-view="regions"
            hidden
          >
            <header class="panel-view-header regions-panel-header">
              <div>
                <small>Maps, places & navigation</small>
                <h2>Offline regions</h2>
              </div>
            </header>

            <div
              id="regionsContent"
              class="panel-content regions-content"
              aria-live="polite"
            ></div>
          </section>

<section
            id="navigationPanel"
            class="panel-view"
            data-panel-view="navigation"
            hidden
          >
            <header class="panel-view-header navigation-panel-header">
              <div>
                <small>Offline directions</small>
                <h2>Navigation</h2>
              </div>
            </header>

            <div
              id="navigationContent"
              class="panel-content"
            ></div>
          </section>
        </div>
      </aside>
    </div>`;
}
