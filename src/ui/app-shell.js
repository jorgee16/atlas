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
            <span class="brand-mark">🌍</span>
            <div>
              <strong id="map-context-title">Roam</strong>
              <small id="map-context-subtitle">Explore the map</small>
            </div>
          </div>

          <div class="map-header-actions">
              <button
                id="loadTripBtn"
                class="icon-btn"
                type="button"
                aria-label="Load trip"
                title="Load trip"
              >
                🧳
              </button>

              <input
                id="tripFileInput"
                type="file"
                accept="application/json,.json"
                hidden
              >
              <button
                id="saveBookmarkBtn"
                class="icon-btn"
                type="button"
                aria-label="Save this location"
                title="Save this location"
              >
                ⭐
              </button>

              <button
                id="showBookmarksBtn"
                class="icon-btn"
                type="button"
                aria-label="Show bookmarks"
                title="Show bookmarks"
              >
                🔖
              </button>


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
