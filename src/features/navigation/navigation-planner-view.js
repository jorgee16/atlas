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
    results,
    recent = [],
    state,
    error,
    pickMode,
    previewRoute,
    previewState = 'idle',
    previewError = null,
    previewCollapsed = false,
    onUseGps,
    onTravelMode,
    onPick,
    onQuery,
    onClear,
    onSearch,
    onSelect,
    onSelectRecent,
    onChangeDestination,
    onExpandPreview,
    onStart
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
        ? this.#formatCoordinates(origin)
        : 'Live GPS'
      : 'Location unavailable';

    if (destination) {
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
            >Start</button>
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

      const routeDetails = previewState === 'loading'
        ? `
          <div class="navigation-preview-status navigation-preview-status--loading" role="status">
            <span class="navigation-guidance-spinner" aria-hidden="true"></span>
            <span><strong>Calculating route</strong><small>Using downloaded road data</small></span>
          </div>
        `
        : routeReady
          ? `
            <div class="navigation-preview-metrics">
              <span><strong>${this.#formatDuration(previewRoute.durationSeconds)}</strong><small>ETA</small></span>
              <span><strong>${this.#formatDistance(previewRoute.distanceMeters)}</strong><small>distance</small></span>
            </div>
          `
          : previewState === 'error'
            ? `
              <div class="navigation-preview-status navigation-preview-status--error" role="status">
                <span aria-hidden="true">!</span>
                <span><strong>Route unavailable</strong><small>${escapeHtml(previewError ?? 'No offline route could be calculated.')}</small></span>
              </div>
            `
            : '';

      container.innerHTML = `
        <div class="navigation-confirm-card navigation-confirm-card--preview">
          <div class="navigation-confirm-kicker">
            <span aria-hidden="true"></span>
            Route preview
          </div>

          ${this.#travelModeMarkup(travelMode)}

          <div class="navigation-confirm-main">
            <span class="navigation-destination-pin" aria-hidden="true"></span>
            <span class="navigation-confirm-copy">
              <small>Destination</small>
              <strong>${escapeHtml(destination.name ?? 'Destination')}</strong>
              <span>${escapeHtml(this.#placeDetails(destination, false))}</span>
            </span>
          </div>

          ${routeDetails}

          ${error ? `
            <div class="navigation-planner-feedback" role="status">
              ${escapeHtml(error)}
            </div>
          ` : ''}

          <div class="navigation-confirm-actions">
            <button
              class="navigation-secondary-action"
              type="button"
              data-navigation-change
            >Change</button>
            <button
              class="navigation-start-button"
              type="button"
              data-navigation-start
              ${!routeReady ? 'disabled' : ''}
            >
              <span>${previewState === 'loading' ? 'Routing…' : 'Start'}</span>
              <small>${routeReady ? 'Begin guidance' : 'Offline route'}</small>
            </button>
          </div>
        </div>
      `;

      container
        .querySelector?.('[data-navigation-change]')
        ?.addEventListener('click', onChangeDestination);

      container
        .querySelector?.('[data-navigation-start]')
        ?.addEventListener('click', onStart);

      for (const button of container.querySelectorAll?.('[data-navigation-mode]') ?? []) {
        button.addEventListener('click', () => onTravelMode?.(button.dataset.navigationMode));
      }

      return container;
    }

    const visibleResults = results.slice(0, 5);
    const visibleRecent = !query && !visibleResults.length
      ? recent.slice(0, 2)
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

    container.innerHTML = `
      <div class="navigation-search-card">
        <div class="navigation-search-title-row">
          <span>
            <small><i aria-hidden="true"></i> Offline navigation</small>
            <strong>Where do you want to go?</strong>
          </span>
        </div>

        ${this.#travelModeMarkup(travelMode)}

        <button
          class="navigation-origin-summary"
          type="button"
          data-navigation-origin-toggle
          aria-expanded="false"
        >
          <span class="navigation-origin-dot" aria-hidden="true"></span>
          <span>
            <small>From</small>
            <strong>${escapeHtml(originName)}</strong>
          </span>
          <small>${escapeHtml(originDetails)}</small>
          <span class="navigation-origin-chevron" aria-hidden="true">⌄</span>
        </button>

        <div class="navigation-origin-editor" data-navigation-origin-editor hidden>
          <button
            type="button"
            data-navigation-use-gps
            ${originMode === 'gps' ? 'disabled' : ''}
          >Use my location</button>
          <button
            type="button"
            data-navigation-pick="origin"
          >Choose on map</button>
        </div>

        <form class="navigation-destination-search" data-navigation-search>
          <div>
            <span class="navigation-search-icon" aria-hidden="true">⌕</span>
            <input
              id="navigationDestinationInput"
              name="destination"
              type="search"
              inputmode="search"
              autocomplete="off"
              enterkeyhint="search"
              aria-label="Destination"
              placeholder="Search a place, airport or address"
              value="${escapeHtml(query)}"
            >
            ${query ? `
              <button
                class="navigation-search-clear"
                type="button"
                data-navigation-clear
                aria-label="Clear destination search"
              >×</button>
            ` : ''}
            <button
              class="navigation-map-pick-button"
              type="button"
              data-navigation-pick="destination"
              aria-label="Choose destination on map"
              title="Choose on map"
            >⌖</button>
          </div>
        </form>

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
          <div class="navigation-search-section navigation-search-section--compact">
            <div class="navigation-search-heading">
              <strong>Best matches</strong>
              <span>${results.length} result${results.length === 1 ? '' : 's'}</span>
            </div>
            <div class="navigation-search-results" aria-label="Destination results">
              ${resultMarkup}
            </div>
          </div>
        ` : ''}

        ${recentMarkup ? `
          <div class="navigation-search-section navigation-search-section--recent">
            <div class="navigation-search-heading">
              <strong>Recent</strong>
              <span>${recent.length > 2 ? '2 shown' : 'On this device'}</span>
            </div>
            <div class="navigation-search-results" aria-label="Recent destinations">
              ${recentMarkup}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    const originToggle = container.querySelector?.(
      '[data-navigation-origin-toggle]'
    );
    const originEditor = container.querySelector?.(
      '[data-navigation-origin-editor]'
    );

    originToggle?.addEventListener('click', () => {
      const expanded = originEditor?.hidden === false;
      if (originEditor) originEditor.hidden = expanded;
      originToggle.setAttribute(
        'aria-expanded',
        String(!expanded)
      );
    });

    container
      .querySelector?.('[data-navigation-use-gps]')
      ?.addEventListener('click', onUseGps);

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
      .querySelector?.('#navigationDestinationInput')
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
            event.currentTarget.elements.destination.value
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

  #travelModeMarkup(mode) {
    return `
      <div class="navigation-travel-mode" role="group" aria-label="Travel mode">
        <button type="button" data-navigation-mode="drive" class="${mode === 'drive' ? 'on' : ''}" aria-pressed="${mode === 'drive'}"><span aria-hidden="true">▸</span>Drive</button>
        <button type="button" data-navigation-mode="walk" class="${mode === 'walk' ? 'on' : ''}" aria-pressed="${mode === 'walk'}"><span aria-hidden="true">●</span>Walk</button>
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
