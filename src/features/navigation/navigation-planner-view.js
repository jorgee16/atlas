import { escapeHtml } from '../../utils.js';

export class NavigationPlannerView {
  constructor({
    documentRef = globalThis.document
  } = {}) {
    if (!documentRef) {
      throw new TypeError(
        'NavigationPlannerView requires a document.'
      );
    }

    this.document = documentRef;
  }

  render({
    origin,
    originMode,
    travelMode = 'drive',
    destination,
    query,
    advancedPlannerOpen = false,
    searchTarget = 'destination',
    results,
    recent = [],
    state,
    error,
    pickMode,
    previewRoute,
    previewState = 'idle',
    previewError = null,
    previewCollapsed = false,
    driveRoutes = [],
    selectedDriveRouteIndex = 0,
    transitJourneys = [],
    selectedTransitJourneyIndex = 0,
    expandedTransitJourneyIndex = null,
    transitJourneySession = null,
    transitAvailability = { status: 'unknown', message: null },
    onUseGps,
    onTravelMode,
    onPick,
    onSwap,
    onOpenAdvancedPlanner,
    onCloseAdvancedPlanner,
    onActivateEndpoint,
    onQuery,
    onClear,
    onSearch,
    onSelect,
    onSelectRecent,
    onChangeDestination,
    onBookmarkDestination,
    onPreviewMap,
    onExpandPreview,
    onSelectDriveRoute,
    onSelectTransitJourney,
    onStart,
    onRetryPreview
  }) {
    const container =
      this.document.createElement('section');

    container.className =
      'navigation-planner navigation-planner--compact';

    if (pickMode) {
      container.innerHTML = `
        <div class="navigation-map-pick-prompt" role="status">
          <span class="navigation-map-pick-icon" aria-hidden="true">⌖</span>
          <span>
            <small>${pickMode === 'origin' ? 'Starting point' : 'Destination'}</small>
            <strong>Tap the map to choose</strong>
          </span>
        </div>
      `;

      return container;
    }

    const originName = origin?.name ??
      'Waiting for GPS';

    const originDetails = origin
      ? originMode === 'picked'
        ? this.#placeDetails(origin, false) || this.#formatCoordinates(origin)
        : 'Live GPS'
      : 'Location unavailable';

    if (destination && !advancedPlannerOpen) {
      container.classList.add('navigation-planner--preview');

      const routeReady =
        previewState === 'ready' && previewRoute;

      if (previewCollapsed && routeReady) {
        container.innerHTML = `
          <div class="navigation-preview-bar">
            <button
              class="navigation-preview-summary"
              type="button"
              data-navigation-expand-preview
              aria-label="Expand route preview"
            >
              <span class="navigation-destination-pin" aria-hidden="true"></span>
              <span>
                <strong>${escapeHtml(destination.name ?? 'Destination')}</strong>
                <small>${this.#formatDuration(previewRoute.durationSeconds)} · ${this.#formatDistance(previewRoute.distanceMeters)}</small>
              </span>
              <span class="navigation-preview-chevron" aria-hidden="true">⌃</span>
            </button>
            <button
              class="navigation-start-button navigation-start-button--slim"
              type="button"
              data-navigation-start
            >${travelMode === 'transit' ? 'Start journey' : 'Start'}</button>
          </div>
        `;

        container
          .querySelector?.('[data-navigation-expand-preview]')
          ?.addEventListener('click', onExpandPreview);

        container
          .querySelector?.('[data-navigation-start]')
          ?.addEventListener('click', onStart);

        return container;
      }

      const selectedDriveOption =
        travelMode === 'drive' && driveRoutes.length > 1
          ? driveRoutes[selectedDriveRouteIndex] ?? driveRoutes[0] ?? null
          : null;

      const selectedDriveTolls = Number(
        selectedDriveOption?.route?.tolls?.totalEuros ?? 0
      );

      const routeDetails =
        previewState === 'loading'
          ? `
            <div class="navigation-preview-status navigation-preview-status--loading" role="status">
              <span class="navigation-guidance-spinner" aria-hidden="true"></span>
              <span>
                <strong>${
                  travelMode === 'drive'
                    ? 'Calculating drive options'
                    : travelMode === 'transit'
                      ? 'Finding transit options'
                      : 'Calculating walking route'
                }</strong>
                <small>${
                  travelMode === 'drive'
                    ? 'Fastest · Balanced · No tolls · Offline road data'
                    : travelMode === 'transit'
                      ? 'Checking public transport services'
                      : 'Using downloaded road data'
                }</small>
              </span>
            </div>
          `
          : routeReady
            ? selectedDriveOption
              ? ''
              : travelMode === 'drive'
                ? (() => {
                    const roadHint = (
                      previewRoute?.roadRefs ?? []
                    )
                      .slice(0, 4)
                      .join(' · ');

                    const tollEuros = Number(
                      previewRoute?.tolls?.totalEuros ?? 0
                    );

                    return `
                      <div class="navigation-single-drive-route">
                        <div class="navigation-single-drive-main">
                          <span>
                            <strong>${this.#formatDuration(previewRoute.durationSeconds)}</strong>
                            <small>${this.#formatDistance(previewRoute.distanceMeters)}</small>
                          </span>

                          <span class="navigation-single-drive-toll ${tollEuros <= 0 ? 'is-free' : ''}">
                            ${tollEuros > 0
                              ? `Est. €${tollEuros.toFixed(2)}`
                              : 'No tolls'}
                          </span>
                        </div>

                        ${roadHint
                          ? `
                            <div class="navigation-single-drive-roads">
                              <small>Via</small>
                              <strong>${escapeHtml(roadHint)}</strong>
                            </div>
                          `
                          : ''}

                      </div>
                    `;
                  })()
                : `
                  <div class="navigation-preview-metrics">
                    <span>
                      <strong>${this.#formatDuration(previewRoute.durationSeconds)}</strong>
                      <small>ETA</small>
                    </span>
                    <span>
                      <strong>${this.#formatDistance(previewRoute.distanceMeters)}</strong>
                      <small>distance</small>
                    </span>
                  </div>
                `
            : previewState === 'error'
              ? `
                <div class="navigation-preview-status navigation-preview-status--error" role="status">
                  <span aria-hidden="true">!</span>
                  <span>
                    <strong>${
                      travelMode === 'transit'
                        ? 'Transit unavailable'
                        : 'Route unavailable'
                    }</strong>
                    <small>${escapeHtml(
                      previewError ??
                      (
                        travelMode === 'transit'
                          ? 'No transit journey could be calculated.'
                          : 'No offline route could be calculated.'
                      )
                    )}</small>
                    <button
                      type="button"
                      class="navigation-preview-retry"
                      data-navigation-retry-preview
                    >
                      Retry
                    </button>
                  </span>
                </div>
              `
              : '';

      container.innerHTML = `
        <div class="navigation-confirm-card navigation-confirm-card--preview">
          <div class="navigation-confirm-kicker">
            <span aria-hidden="true"></span>
            Route preview
          </div>

          <div class="navigation-preview-topbar">
            <div class="navigation-confirm-main">
              <span class="navigation-destination-pin" aria-hidden="true"></span>

              <span class="navigation-confirm-copy">
                <strong>${escapeHtml(destination.name ?? 'Destination')}</strong>
                <span>${escapeHtml(this.#placeDetails(destination, false))}</span>
              </span>

              <button
                class="navigation-destination-bookmark"
                type="button"
                data-navigation-bookmark
              >
                <span aria-hidden="true">☆</span>
                Bookmark
              </button>
            </div>
          </div>

          <div class="navigation-preview-controls">
            ${routeDetails}

            <div class="navigation-mode-choice">
            <small class="navigation-mode-choice-label">Travel mode</small>
            ${this.#travelModeMarkup(travelMode, transitAvailability)}
            ${travelMode === 'transit' && transitAvailability?.status === 'unavailable' ? `
              <small class="navigation-transit-availability" role="status">${escapeHtml(transitAvailability.message ?? 'Public transport routing isn’t available in this region yet.')}</small>
            ` : ''}
          </div>

          ${travelMode === 'drive' && previewState === 'ready'
            ? this.#driveOptionsMarkup(
                driveRoutes,
                selectedDriveRouteIndex
              )
            : ''}

          ${travelMode === 'transit' && previewState === 'ready'
            ? this.#transitOptionsMarkup(
                transitJourneys,
                selectedTransitJourneyIndex,
                expandedTransitJourneyIndex
              )
            : ''}

          ${error ? `
            <div class="navigation-planner-feedback" role="status">
              ${escapeHtml(error)}
            </div>
          ` : ''}

          ${routeReady && travelMode === 'transit' ? `
            <button
              class="navigation-preview-map-button"
              type="button"
              data-navigation-preview-map
            >
              <span
                class="navigation-preview-map-icon"
                aria-hidden="true"
              >⌑</span>

              <span class="navigation-preview-map-copy">
                <strong>Preview on map</strong>
                <small>See selected route</small>
              </span>
            </button>
          ` : ''}

            <div class="navigation-confirm-actions">
              <button
                class="navigation-secondary-action"
                type="button"
                data-navigation-change
              aria-label="Search for another destination"
              >Search</button>
              <button
                class="navigation-start-button"
                type="button"
                data-navigation-start
                ${!routeReady ? 'disabled' : ''}
              >
                <span>${previewState === 'loading' ? 'Routing…' : travelMode === 'transit' ? 'Start journey' : 'Start'}</span>
                <small>${routeReady ? travelMode === 'transit' ? 'Begin selected journey' : 'Begin guidance' : travelMode === 'transit' ? 'Finding public transport options' : 'Offline route'}</small>
              </button>
            </div>
          </div>
        </div>
      `;

      container
        .querySelector?.('[data-navigation-bookmark]')
        ?.addEventListener(
          'click',
          onBookmarkDestination
        );

      container
        .querySelector?.('[data-navigation-change]')
        ?.addEventListener('click', onChangeDestination);

      container
        .querySelector?.('[data-navigation-preview-map]')
        ?.addEventListener('click', onPreviewMap);

      container
        .querySelector?.('[data-navigation-start]')
        ?.addEventListener('click', onStart);


      container
        .querySelector?.('[data-navigation-retry-preview]')
        ?.addEventListener(
          'click',
          onRetryPreview
        );

      for (const button of container.querySelectorAll?.('[data-navigation-mode]') ?? []) {
        button.addEventListener('click', () => onTravelMode?.(button.dataset.navigationMode));
      }
      for (const button of container.querySelectorAll?.('[data-drive-option]') ?? []) {
        button.addEventListener('click', () => onSelectDriveRoute?.(Number(button.dataset.driveOption)));
      }
      for (const button of container.querySelectorAll?.('[data-transit-option]') ?? []) {
        button.addEventListener('click', () => onSelectTransitJourney?.(Number(button.dataset.transitOption)));
      }

      return container;
    }

    container.classList.add('navigation-planner--search');
    if (advancedPlannerOpen) {
      container.classList.add('navigation-planner--advanced');
    }

    const visibleResults = results.slice(0, 5);
    const visibleRecent =
      searchTarget === 'destination' && !query && !visibleResults.length
        ? recent.slice(0, 3)
        : [];

    const resultMarkup = visibleResults.map(
      (place, index) => this.#resultMarkup(
        place,
        index,
        'result'
      )
    ).join('');

    const recentMarkup = visibleRecent.map(
      (place, index) => this.#resultMarkup(
        place,
        index,
        'recent'
      )
    ).join('');

    const searchActive = Boolean(
      query ||
      visibleResults.length ||
      state === 'loading' ||
      error
    );

    const searchInput = (kind, {
      markerClass,
      placeholder,
      value = query
    }) => `
      <form
        class="navigation-destination-search navigation-endpoint-row navigation-endpoint-row--${kind}"
        data-navigation-search
      >
        <span class="navigation-endpoint-marker ${markerClass}" aria-hidden="true"></span>
        <label class="navigation-endpoint-copy" for="navigationEndpointInput">
          <small>${kind === 'origin' ? 'From' : 'To'}</small>
          <input
            id="navigationEndpointInput"
            data-navigation-query-input
            name="query"
            type="search"
            inputmode="search"
            autocomplete="off"
            enterkeyhint="search"
            aria-label="${kind === 'origin' ? 'Starting point' : 'Destination'}"
            placeholder="${escapeHtml(placeholder)}"
            value="${escapeHtml(value)}"
          >
        </label>
        <span class="navigation-endpoint-actions">
          ${query ? `
            <button
              class="navigation-search-clear"
              type="button"
              data-navigation-clear
              aria-label="Clear search"
            >×</button>
          ` : ''}
          <button
            class="navigation-map-pick-button"
            type="button"
            data-navigation-pick="${kind}"
            aria-label="Choose ${kind === 'origin' ? 'starting point' : 'destination'} on map"
            title="Choose on map"
          >⌖</button>
        </span>
      </form>
    `;

    const endpointSummary = (kind, point, details) => `
      <button
        class="navigation-endpoint-row navigation-endpoint-row--${kind}"
        type="button"
        data-navigation-activate-endpoint="${kind}"
      >
        <span class="navigation-endpoint-marker navigation-endpoint-marker--${kind}" aria-hidden="true"></span>
        <span class="navigation-endpoint-copy">
          <small>${kind === 'origin' ? 'From' : 'To'}</small>
          <strong>${escapeHtml(point?.name ?? (kind === 'origin' ? 'My location' : 'Choose destination'))}</strong>
          ${details ? `<span>${escapeHtml(details)}</span>` : ''}
        </span>
        <span class="navigation-endpoint-edit" aria-hidden="true">›</span>
      </button>
    `;

    const defaultDestinationSearch = `
      <form
        class="navigation-where-to-search"
        data-navigation-search
      >
        <span class="navigation-where-to-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="6.5"></circle>
            <path d="m16 16 4 4"></path>
          </svg>
        </span>
        <input
          data-navigation-query-input
          name="query"
          type="search"
          inputmode="search"
          autocomplete="off"
          enterkeyhint="search"
          aria-label="Destination"
          placeholder="Where to?"
          value="${escapeHtml(query)}"
        >
        ${query ? `
          <button
            class="navigation-search-clear navigation-where-to-clear"
            type="button"
            data-navigation-clear
            aria-label="Clear search"
          >×</button>
        ` : ''}
        <button
          class="navigation-where-to-map"
          type="button"
          data-navigation-pick="destination"
          aria-label="Pick destination on map"
          title="Pick on map"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3"></circle>
            <circle cx="12" cy="12" r="7"></circle>
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path>
          </svg>
        </button>
      </form>
    `;

    const quickActions = `
      <div class="navigation-search-quick-actions" aria-label="Navigation shortcuts">
        <button
          class="navigation-search-quick-action is-current-location"
          type="button"
          data-navigation-use-gps
          title="Use my location as the starting point"
          ${originMode === 'gps' ? 'aria-pressed="true"' : ''}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 3 7 17-7-4-7 4Z"></path>
          </svg>
          <span>Use my location</span>
        </button>
        <button
          class="navigation-search-quick-action"
          type="button"
          data-navigation-pick="destination"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"></path>
            <circle cx="12" cy="10" r="2"></circle>
          </svg>
          <span>Pick on map</span>
        </button>
        <button
          class="navigation-search-quick-action"
          type="button"
          data-navigation-open-advanced
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="6" cy="6" r="2"></circle>
            <path d="M8 6h5a4 4 0 0 1 4 4v1"></path>
            <path d="m14 9 3 3 3-3"></path>
            <path d="M17 12v3a3 3 0 0 1-3 3H9"></path>
            <path d="m10 15-3 3 3 3"></path>
          </svg>
          <span>Advanced route</span>
        </button>
      </div>
    `;

    const advancedEndpoints = `
      <div class="navigation-endpoint-stack navigation-endpoint-stack--advanced">
        ${searchTarget === 'origin'
          ? searchInput('origin', {
              markerClass: 'navigation-endpoint-marker--origin',
              placeholder: 'Search starting point'
            })
          : endpointSummary('origin', origin, originDetails)}

        <span class="navigation-endpoint-connector" aria-hidden="true"></span>

        ${searchTarget === 'destination'
          ? searchInput('destination', {
              markerClass: 'navigation-endpoint-marker--destination',
              placeholder: destination?.name ?? 'Search destination'
            })
          : endpointSummary(
              'destination',
              destination,
              destination ? this.#placeDetails(destination, false) : ''
            )}

        <button
          class="navigation-endpoint-swap"
          type="button"
          data-navigation-swap
          aria-label="Swap starting point and destination"
          title="Swap"
          ${!origin || !destination ? 'disabled' : ''}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m8 4-3 3 3 3"></path>
            <path d="M5 7h11a3 3 0 0 1 3 3"></path>
            <path d="m16 20 3-3-3-3"></path>
            <path d="M19 17H8a3 3 0 0 1-3-3"></path>
          </svg>
        </button>
      </div>

      <div class="navigation-advanced-origin-actions">
        <button
          type="button"
          data-navigation-use-gps
          aria-label="Use my location"
          title="Use my location"
          ${originMode === 'gps' && searchTarget !== 'origin' ? 'disabled' : ''}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3"></path>
          </svg>
          <span>Use GPS</span>
        </button>
        <button
          type="button"
          data-navigation-pick="origin"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"></path>
            <circle cx="12" cy="10" r="2"></circle>
          </svg>
          <span>Pick on map</span>
        </button>
      </div>
    `;

    container.innerHTML = `
      <div class="navigation-search-card navigation-search-card--destination ${advancedPlannerOpen ? 'is-advanced' : ''} ${searchActive ? 'is-searching' : ''}">
        ${advancedPlannerOpen ? `
          <div class="navigation-search-title-row navigation-search-title-row--minimal navigation-search-title-row--advanced">
            <button
              class="navigation-advanced-back"
              type="button"
              data-navigation-close-advanced
              aria-label="Back to simple navigation search"
              title="Back"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m15 18-6-6 6-6"></path>
              </svg>
            </button>
            <small><i aria-hidden="true"></i> Route planner</small>
          </div>
        ` : `
          <span class="navigation-search-grabber" aria-hidden="true"></span>
        `}

        ${advancedPlannerOpen
          ? advancedEndpoints
          : `
            <div class="navigation-destination-first">
              ${defaultDestinationSearch}
              ${quickActions}
            </div>
          `}

        ${state === 'loading' ? `
          <div class="navigation-planner-feedback navigation-planner-feedback--loading">
            <span class="navigation-guidance-spinner" aria-hidden="true"></span>
            <span>Searching downloaded places and roads…</span>
          </div>
        ` : ''}

        ${error ? `
          <div class="navigation-planner-feedback" role="status">
            ${escapeHtml(error)}
          </div>
        ` : ''}

        ${resultMarkup ? `
          <div class="navigation-search-section navigation-search-section--compact navigation-search-section--flat">
            <div class="navigation-search-heading">
              <strong>${searchTarget === 'origin' ? 'Starting points' : 'Results'}</strong>
              <span>${results.length} found</span>
            </div>
            <div class="navigation-search-results navigation-search-results--flat" aria-label="Search results">
              ${resultMarkup}
            </div>
          </div>
        ` : ''}

        ${recentMarkup ? `
          <div class="navigation-search-section navigation-search-section--recent navigation-search-section--flat">
            <div class="navigation-search-heading">
              <strong>Recent</strong>
              <span>${recent.length > 3 ? '3 shown' : 'On this device'}</span>
            </div>
            <div class="navigation-search-results navigation-search-results--flat" aria-label="Recent destinations">
              ${recentMarkup}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    for (
      const button of
      container.querySelectorAll?.('[data-navigation-activate-endpoint]') ?? []
    ) {
      button.addEventListener(
        'click',
        () => onActivateEndpoint?.(button.dataset.navigationActivateEndpoint)
      );
    }

    container
      .querySelector?.('[data-navigation-swap]')
      ?.addEventListener('click', onSwap);

    container
      .querySelector?.('[data-navigation-use-gps]')
      ?.addEventListener('click', onUseGps);

    container
      .querySelector?.('[data-navigation-open-advanced]')
      ?.addEventListener('click', onOpenAdvancedPlanner);

    container
      .querySelector?.('[data-navigation-close-advanced]')
      ?.addEventListener('click', onCloseAdvancedPlanner);

    for (
      const button of
      container.querySelectorAll?.('[data-navigation-pick]') ?? []
    ) {
      button.addEventListener(
        'click',
        () => onPick(button.dataset.navigationPick)
      );
    }

    container
      .querySelector?.('[data-navigation-query-input]')
      ?.addEventListener(
        'input',
        event => onQuery?.(event.currentTarget.value)
      );

    container
      .querySelector?.('[data-navigation-clear]')
      ?.addEventListener('click', onClear);

    container
      .querySelector?.('[data-navigation-search]')
      ?.addEventListener(
        'submit',
        event => {
          event.preventDefault();
          onSearch(
            event.currentTarget.elements.query.value
          );
        }
      );

    for (
      const button of
      container.querySelectorAll?.('[data-navigation-result]') ?? []
    ) {
      button.addEventListener(
        'click',
        () => onSelect(
          Number(button.dataset.navigationResult)
        )
      );
    }

    for (
      const button of
      container.querySelectorAll?.('[data-navigation-recent]') ?? []
    ) {
      button.addEventListener(
        'click',
        () => onSelectRecent?.(
          Number(button.dataset.navigationRecent)
        )
      );
    }


    for (
      const button of
      container.querySelectorAll?.('[data-navigation-mode]') ?? []
    ) {
      button.addEventListener(
        'click',
        () => onTravelMode?.(button.dataset.navigationMode)
      );
    }

    return container;
  }

  #travelModeMarkup(mode, transitAvailability = { status: 'unknown' }) {
    const icon = travelMode => {
      if (travelMode === 'drive') {
        return `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 16v-4.2L7.1 7h9.8l2.1 4.8V16"></path>
            <path d="M4 12h16"></path>
            <path d="M7.2 7 8.5 4.8h7L16.8 7"></path>
            <circle cx="7" cy="16.5" r="1.6"></circle>
            <circle cx="17" cy="16.5" r="1.6"></circle>
          </svg>`;
      }

      if (travelMode === 'walk') {
        return `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="13" cy="4.5" r="2"></circle>
            <path d="m11.5 8-2.3 4 3 2.2 1.8 5"></path>
            <path d="m11.5 8 3.1 2 2.4 3"></path>
            <path d="m9.2 12-3.2 6"></path>
          </svg>`;
      }

      return `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="3.5" width="12" height="14" rx="3"></rect>
          <path d="M8.5 8h7M8.5 12h7"></path>
          <circle cx="9" cy="15" r="1"></circle>
          <circle cx="15" cy="15" r="1"></circle>
          <path d="m9 17.5-2 3M15 17.5l2 3"></path>
        </svg>`;
    };

    return `
      <div class="navigation-travel-mode" role="group" aria-label="Travel mode">
        <button type="button" data-navigation-mode="drive" class="${mode === 'drive' ? 'on' : ''}" aria-label="Drive" title="Drive" aria-pressed="${mode === 'drive'}">${icon('drive')}</button>
        <button type="button" data-navigation-mode="walk" class="${mode === 'walk' ? 'on' : ''}" aria-label="Walk" title="Walk" aria-pressed="${mode === 'walk'}">${icon('walk')}</button>
        <button type="button" data-navigation-mode="transit" class="${mode === 'transit' ? 'on' : ''} ${transitAvailability?.status === 'unavailable' ? 'is-unavailable' : ''}" aria-label="Transit${transitAvailability?.status === 'unavailable' ? ' unavailable in this region' : ''}" title="${transitAvailability?.status === 'unavailable' ? 'Public transport unavailable in this region' : 'Transit'}" aria-pressed="${mode === 'transit'}" aria-disabled="${transitAvailability?.status === 'unavailable'}">${icon('transit')}</button>
      </div>
    `;
  }

  #driveOptionsMarkup(options, selectedIndex) {
    if (!options?.length || options.length < 2) {
      return '';
    }

    const fastest = options.find(option => option.kind === 'fastest')?.route ?? null;
    const selectedOption = options[selectedIndex] ?? options[0];

    return `
      <section class="navigation-drive-options" aria-label="Driving route options">
        <header class="navigation-drive-options-heading">
          <span>
            <strong>Route options</strong>
            <small>Tap a route to compare it on the map</small>
          </span>
          <small>${escapeHtml(selectedOption?.label ?? 'Route')} selected</small>
        </header>

        <div class="navigation-drive-options-list">
          ${options.map((option, index) => {
            const route = option.route;
            const tollEuros = Number(route?.tolls?.totalEuros ?? 0);
            const selected = index === selectedIndex;
            const extraMinutes = fastest && route !== fastest
              ? Math.max(0, Math.round((route.durationSeconds - fastest.durationSeconds) / 60))
              : 0;
            const savedEuros = fastest && route !== fastest
              ? Math.max(0, Number(fastest.tolls?.totalEuros ?? 0) - tollEuros)
              : 0;

            const tradeoff = savedEuros >= 0.5
              ? `Save €${savedEuros.toFixed(2)}${extraMinutes ? ` · +${extraMinutes} min` : ''}`
              : extraMinutes
                ? `+${extraMinutes} min`
                : '';

            const roadHint = (route?.roadRefs ?? [])
              .slice(0, 4)
              .join(' · ');

            return `
              <button
                type="button"
                class="navigation-drive-option ${selected ? 'is-selected' : ''}"
                data-drive-option="${index}"
                data-drive-kind="${escapeHtml(option.kind ?? '')}"
                aria-pressed="${selected}"
              >
                <span class="navigation-drive-option-selector" aria-hidden="true"><i></i></span>

                <span class="navigation-drive-option-content">
                  <span class="navigation-drive-option-head">
                    <span class="navigation-drive-option-title">
                      <strong>${escapeHtml(option.label)}</strong>
                      ${option.recommended ? '<small class="navigation-drive-recommended">Recommended</small>' : ''}
                    </span>
                    <b class="navigation-drive-option-duration">${this.#formatDuration(route.durationSeconds)}</b>
                  </span>

                  <span class="navigation-drive-option-route-row">
                    ${roadHint
                      ? `<small class="navigation-drive-roads"><span>Via</span> ${escapeHtml(roadHint)}</small>`
                      : '<small class="navigation-drive-roads"><span>Local roads</span></small>'}
                    <strong class="navigation-drive-option-price">${tollEuros > 0 ? `Est. €${tollEuros.toFixed(2)}` : '€0'}</strong>
                  </span>

                  <span class="navigation-drive-option-foot">
                    <small>${this.#formatDistance(route.distanceMeters)}</small>
                    ${tradeoff ? `<small class="navigation-drive-tradeoff">${escapeHtml(tradeoff)}</small>` : '<small></small>'}
                  </span>
                </span>
              </button>
            `;
          }).join('')}
        </div>

        <footer class="navigation-drive-options-footer">
          <small class="navigation-drive-toll-note">ⓘ Estimated tolls · 2026 tariffs</small>
          <button
            class="navigation-drive-preview-link"
            type="button"
            data-navigation-preview-map
          >
            <span aria-hidden="true">⌑</span>
            Full map
          </button>
        </footer>
      </section>
    `;
  }

  #transitOptionsMarkup(
    journeys,
    selectedIndex,
    expandedIndex = null
  ) {
    if (!journeys?.length) return '';

    const time = value => {
      if (!value) return '';

      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return '';
      }

      return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    const modeKey = mode =>
      String(mode ?? 'transit')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');

    const visualKey = step => {
      const line =
        String(step?.line ?? '')
          .trim()
          .toLowerCase();

      const normalizedMode =
        modeKey(step?.mode);

      if (line.includes('jubilee')) return 'jubilee';
      if (line.includes('piccadilly')) return 'piccadilly';
      if (line.includes('district')) return 'district';
      if (line.includes('central')) return 'central';
      if (line.includes('circle')) return 'circle';
      if (line.includes('victoria')) return 'victoria';
      if (line.includes('northern')) return 'northern';
      if (line.includes('metropolitan')) return 'metropolitan';
      if (line.includes('bakerloo')) return 'bakerloo';

      if (
        line.includes('hammersmith') ||
        line.includes('city')
      ) {
        return 'hammersmith-city';
      }

      if (
        line.includes('waterloo') &&
        line.includes('city')
      ) {
        return 'waterloo-city';
      }

      if (normalizedMode === 'bus' || normalizedMode === 'public-bus') {
        return 'bus';
      }

      if (normalizedMode === 'dlr') return 'dlr';
      if (normalizedMode === 'overground') return 'overground';
      if (normalizedMode === 'elizabeth-line') return 'elizabeth-line';
      if (normalizedMode === 'national-rail') return 'national-rail';
      if (normalizedMode === 'tram') return 'tram';
      if (normalizedMode === 'tube') return 'tube';

      return normalizedMode || 'transit';
    };

    const modeLabel = mode => {
      const normalized = modeKey(mode);

      if (normalized === 'tube') return 'Tube';

      if (
        normalized === 'bus' ||
        normalized === 'public-bus'
      ) {
        return 'Bus';
      }

      if (normalized === 'overground') {
        return 'Overground';
      }

      if (normalized === 'elizabeth-line') {
        return 'Elizabeth';
      }

      if (normalized === 'dlr') {
        return 'DLR';
      }

      if (normalized === 'national-rail') {
        return 'Rail';
      }

      if (normalized === 'tram') {
        return 'Tram';
      }

      return mode
        ? String(mode)
        : 'Transit';
    };

    return `
      <div
        class="navigation-transit-options navigation-transit-options--abc"
        aria-label="Transit journey options"
      >
        ${journeys.slice(0, 5).map((journey, index) => {
          const selected =
            index === selectedIndex;

          const expanded =
            index === expandedIndex;

          const sequence =
            journey.sequence ?? [];

          const transitSteps =
            sequence.filter(
              step => step.kind === 'transit'
            );

          const transportModes =
            [...new Set(
              transitSteps
                .map(step => modeLabel(step.mode))
                .filter(Boolean)
            )];

          const changes =
            Number.isFinite(journey.metrics?.transferCount)
              ? journey.metrics.transferCount
              : Math.max(0, transitSteps.length - 1);

          const walkingMinutes =
            Number.isFinite(journey.metrics?.walkingMinutes)
              ? journey.metrics.walkingMinutes
              : sequence
                  .filter(step => step.kind === 'walk')
                  .reduce(
                    (total, step) =>
                      total +
                      Number(step.durationMinutes ?? 0),
                    0
                  );

          const rankingBadges = [
            journey.isRecommended
              ? '<span class="navigation-transit-rank-badge">Recommended</span>'
              : '',
            journey.isFastest
              ? '<span class="navigation-transit-rank-badge navigation-transit-rank-badge--fastest">Fastest</span>'
              : ''
          ].filter(Boolean).join('');

          const transportSummary =
            transportModes.join(' + ') || 'Transit';

          const chips = transitSteps.map(step => {
            const mode = visualKey(step);
            const label =
              step.line || modeLabel(step.mode);

            return `
              <span
                class="
                  navigation-transit-line-chip
                  navigation-transit-line-chip--${mode}
                "
              >
                ${escapeHtml(label)}
              </span>
            `;
          }).join('');

          const miniTimeline = `
            <span class="navigation-transit-mini-route">
              ${sequence.map((step, stepIndex) => {
                const mode =
                  step.kind === 'walk'
                    ? 'walk'
                    : visualKey(step);

                return `
                  <span
                    class="
                      navigation-transit-mini-node
                      navigation-transit-mini-node--${mode}
                    "
                  ></span>

                  ${stepIndex < sequence.length - 1
                    ? `
                      <span
                        class="
                          navigation-transit-mini-segment
                          navigation-transit-mini-segment--${mode}
                        "
                      ></span>
                    `
                    : ''}
                `;
              }).join('')}
            </span>
          `;

          const detail = expanded
            ? `
              <div class="navigation-transit-timeline">
                ${sequence.map((step, stepIndex) => {
                  const walking =
                    step.kind === 'walk';

                  const mode =
                    walking
                      ? 'walk'
                      : visualKey(step);

                  const label =
                    walking
                      ? 'Walk'
                      : step.line ||
                        modeLabel(step.mode);

                  const instruction =
                    step.instruction ||
                    `${step.fromName ?? ''} → ${step.toName ?? ''}`;

                  const detailedInstruction =
                    String(step.instructionDetailed ?? '').trim();

                  const showDetailedInstruction =
                    detailedInstruction &&
                    detailedInstruction !==
                      String(step.instruction ?? '').trim();

                  const direction =
                    String(step.direction ?? '').trim();

                  const directionCopy =
                    !direction
                      ? ''
                      : /\bbound\b/i.test(direction)
                        ? direction
                        : `Towards ${direction}`;

                  const platformValue =
                    step.departurePlatform ||
                    step.departureIndicator ||
                    step.departureStopLetter ||
                    '';

                  const platformCopy =
                    platformValue
                      ? /platform/i.test(String(platformValue))
                        ? String(platformValue)
                        : `Platform ${platformValue}`
                      : '';

                  const departure =
                    time(step.departureTime);

                  return `
                    <div class="navigation-transit-leg">
                      <span
                        class="
                          navigation-transit-leg-rail
                          navigation-transit-leg-rail--${mode}
                        "
                        aria-hidden="true"
                      >
                        <i></i>

                        ${stepIndex < sequence.length - 1
                          ? '<b></b>'
                          : ''}
                      </span>

                      <span class="navigation-transit-leg-copy">
                        <small>
                          ${!walking && (
                            step.mode === 'tube' ||
                            step.mode === 'underground'
                          )
                            ? `
                              <span
                                class="navigation-transit-roundel"
                                aria-label="London Underground"
                              >
                                <span></span>
                              </span>
                            `
                            : ''}
                          ${escapeHtml(label)}
                          ${Number.isFinite(step.durationMinutes)
                            ? ` · ${step.durationMinutes} min`
                            : ''}
                        </small>

                        <strong>
                          ${escapeHtml(instruction)}
                        </strong>

                        ${!walking && departure
                          ? `
                            <span class="navigation-transit-leg-time">
                              ${escapeHtml(departure)}
                            </span>
                          `
                          : ''}


                        ${!walking
                          ? (() => {
                              const operationLine = [
                                step.boundDirection,
                                step.departurePlatform
                                  ? /^platform\b/i.test(
                                      String(step.departurePlatform)
                                    )
                                    ? step.departurePlatform
                                    : `Platform ${step.departurePlatform}`
                                  : null,
                                !step.departurePlatform &&
                                step.departureIndicator
                                  ? step.departureIndicator
                                  : null,
                                !step.departurePlatform &&
                                !step.departureIndicator &&
                                step.departureStopLetter
                                  ? `Stop ${step.departureStopLetter}`
                                  : null
                              ]
                                .filter(Boolean)
                                .join(' · ');

                              const towardsLine =
                                step.direction
                                  ? `Towards ${step.direction}`
                                  : '';

                              return `
                                ${operationLine
                                  ? `
                                    <span class="navigation-transit-leg-detail navigation-transit-leg-operation">
                                      ${escapeHtml(operationLine)}
                                    </span>
                                  `
                                  : ''}

                                ${towardsLine
                                  ? `
                                    <span class="navigation-transit-leg-detail navigation-transit-leg-towards">
                                      ${escapeHtml(towardsLine)}
                                    </span>
                                  `
                                  : ''}
                              `;
                            })()
                          : ''}

                        ${!walking && Number.isFinite(step.stopCount)
                          ? `
                            <div class="navigation-transit-stop-rail">
                              <div class="navigation-transit-stop-rail-heading">
                                <span>
                                  ${step.stopCount}
                                  stop${step.stopCount === 1 ? '' : 's'}
                                </span>
                              </div>

                              ${
                                Array.isArray(step.intermediateStops) &&
                                step.intermediateStops.length
                                  ? `
                                    <div class="navigation-transit-stop-rail-list">
                                      ${step.intermediateStops
                                        .map((stop, stopIndex, stops) => {
                                          const isLast =
                                            stopIndex ===
                                            stops.length - 1;

                                          return `
                                            <div
                                              class="
                                                navigation-transit-stop-rail-item
                                                ${isLast ? 'is-destination' : ''}
                                              "
                                            >
                                              <span
                                                class="navigation-transit-stop-rail-track"
                                                aria-hidden="true"
                                              ></span>

                                              <span
                                                class="navigation-transit-stop-rail-dot"
                                                aria-hidden="true"
                                              ></span>

                                              <span
                                                class="navigation-transit-stop-rail-name"
                                              >
                                                ${escapeHtml(String(stop))}
                                              </span>
                                            </div>
                                          `;
                                        })
                                        .join('')}
                                    </div>
                                  `
                                  : ''
                              }
                            </div>
                          `
                          : ''}
                      </span>
                    </div>
                  `;
                }).join('')}
              </div>
            `
            : '';

          return `
            <button
              type="button"
              class="
                navigation-transit-option
                navigation-transit-option--abc
                ${selected ? 'on' : ''}
                ${expanded ? 'is-expanded' : ''}
              "
              data-transit-option="${index}"
              aria-pressed="${selected}"
              aria-expanded="${expanded}"
            >
              <span class="navigation-transit-option-main">
                <span class="navigation-transit-times">
                  <strong>
                    ${time(journey.startTime)}
                    <i aria-hidden="true">→</i>
                    ${time(journey.arrivalTime)}
                  </strong>

                  <small>
                    ${walkingMinutes
                      ? `${walkingMinutes} min walk`
                      : 'No walking'}
                    <i aria-hidden="true">·</i>
                    ${changes === 0
                      ? 'Direct'
                      : `${changes} change${changes === 1 ? '' : 's'}`}
                  </small>

                  ${rankingBadges
                    ? `<span class="navigation-transit-rank-badges">${rankingBadges}</span>`
                    : ''}
                </span>

                <span class="navigation-transit-duration">
                  <strong>
                    ${journey.durationMinutes} min
                  </strong>

                  <i
                    class="navigation-transit-chevron"
                    aria-hidden="true"
                  >⌄</i>
                </span>
              </span>

              <span class="navigation-transit-mode-row">
                <strong class="navigation-transit-mode-summary">
                  ${escapeHtml(transportSummary)}
                </strong>

                <span class="navigation-transit-lines">
                  ${chips}
                </span>
              </span>

              ${expanded ? '' : miniTimeline}

              ${detail}
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  #resultMarkup(place, index, kind) {
    const attr = kind === 'recent'
      ? `data-navigation-recent="${index}"`
      : `data-navigation-result="${index}"`;

    return `
      <button
        class="navigation-search-result"
        type="button"
        ${attr}
      >
        <span class="navigation-search-result-icon${kind === 'recent' ? ' navigation-search-result-icon--recent' : ''}" aria-hidden="true">
          ${kind === 'recent' ? '↺' : this.#placeIcon(place)}
        </span>
        <span>
          <strong>${escapeHtml(place.name)}</strong>
          <small>${escapeHtml(this.#placeDetails(place, kind !== 'recent'))}</small>
        </span>
        <span class="navigation-search-result-arrow" aria-hidden="true">›</span>
      </button>
    `;
  }

  #formatCoordinates(point) {
    return `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
  }

  #formatDistance(distance) {
    if (!Number.isFinite(distance)) return '';
    if (distance < 1000) {
      return `${Math.round(distance)} m`;
    }

    return `${(distance / 1000).toFixed(1)} km`;
  }

  #formatDuration(durationSeconds) {
    const minutes = Math.max(1, Math.round(durationSeconds / 60));

    if (minutes < 60) return `${minutes} min`;

    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
  }

  #placeDetails(place, includeDistance = true) {
    const placeType = String(
      place.place ?? ''
    ).replaceAll('_', ' ');

    const category = String(
      place.amenity ?? place.type ?? 'place'
    ).replaceAll('_', ' ');

    const location = [
      place.address,
      place.city
    ].filter(Boolean).join(', ');

    return [
      place.subtitle || location || placeType || category,
      includeDistance && Number.isFinite(place.distance)
        ? `${this.#formatDistance(place.distance)} away`
        : null
    ].filter(Boolean).join(' · ');
  }

  #placeIcon(place) {
    const type = place.amenity ?? place.type;

    if (place.type === 'locality' || place.place) return '⌾';
    if (['cafe', 'restaurant', 'fast_food'].includes(type)) return '●';
    if (['hotel', 'guest_house', 'hostel'].includes(type)) return '⌂';
    if (['fuel', 'parking'].includes(type)) return 'P';
    return '⌖';
  }
}
