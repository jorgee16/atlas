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
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"></path></svg>
            </span>

            <div class="brand-copy">
              <strong id="map-context-title">Roam</strong>
              <small id="map-context-subtitle">Explore the map</small>
            </div>
          </div>

          <div class="map-header-actions">
            <button
              id="saveBookmarkBtn"
              class="icon-btn"
              type="button"
              aria-label="Save bookmark"
              title="Save bookmark"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2 7.5 14 3 9.6l6.2-.9Z"></path></svg>
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
                id="menuLoadTripBtn"
                type="button"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3v12"></path>
                  <path d="m7 10 5 5 5-5"></path>
                  <path d="M5 21h14"></path>
                </svg>
                <span>Load trip</span>
              </button>

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
                <span>About Roam</span>
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

        
          <div
            id="bookmarkConfirmBar"
            class="bookmark-confirm-bar"
            hidden
          >
            <button id="confirmBookmarkBtn" type="button">
              Save
            </button>

            <button id="cancelBookmarkBtn" type="button">
              Cancel
            </button>
          </div>

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
}
