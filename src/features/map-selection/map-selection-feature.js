export class MapSelectionFeature {
  constructor({
    map,
    status,
    onNavigate,
    onBookmark,
    onSearchNearby,
    documentRef = globalThis.document
  }) {
    if (!map || !documentRef) {
      throw new TypeError(
        'MapSelectionFeature requires map and document.'
      );
    }

    this.map = map;
    this.status = status;
    this.onNavigate = onNavigate;
    this.onBookmark = onBookmark;
    this.onSearchNearby = onSearchNearby;
    this.document = documentRef;
    this.selectedPoint = null;
  }

  select({
    lat,
    lon,
    name = 'Selected point'
  }) {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      throw new TypeError(
        'MapSelectionFeature.select requires lat and lon.'
      );
    }

    this.selectedPoint = {
      name,
      lat,
      lon
    };

    const actions =
      this.#createActions(
        this.selectedPoint
      );

    this.map.showSelectionPin(
      lat,
      lon,
      actions
    );

    this.status?.(
      'Point selected',
      'Navigate, save it, or explore nearby.'
    );

    return this.selectedPoint;
  }

  clear() {
    this.selectedPoint = null;
    this.map.clearSelectionPin();
  }

  #createActions(point) {
    const container =
      this.document.createElement('section');

    container.className =
      'map-selection-popup';
    container.dataset.layout =
      'stacked-actions-v2';

    const title =
      this.document.createElement('strong');

    title.textContent = point.name;

    const coordinates =
      this.document.createElement('small');

    coordinates.textContent =
      `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;

    const actions =
      this.document.createElement('div');

    actions.className =
      'map-selection-actions';

    actions.append(
      this.#createButton({
        label: 'Navigate',
        variant: 'navigate',
        action: async () => {
          const started =
            await this.onNavigate?.(point);

          if (started !== false) {
            this.map.closeSelectionPopup?.();
          }
        }
      }),
      this.#createButton({
        label: 'Bookmark',
        variant: 'bookmark',
        action: () => {
          this.clear();
          return this.onBookmark?.(point);
        }
      }),
      this.#createButton({
        label: 'Search nearby',
        variant: 'nearby',
        action: async () => {
          await this.onSearchNearby?.(point);
          this.map.closeSelectionPopup?.();
        }
      })
    );

    container.append(
      title,
      coordinates,
      actions
    );

    return container;
  }

  #createButton({
    label,
    variant,
    action
  }) {
    const button =
      this.document.createElement('button');

    button.type = 'button';
    button.className = [
      'map-selection-action',
      `map-selection-action--${variant}`
    ].join(' ');
    button.textContent = label;

    button.addEventListener(
      'click',
      async event => {
        event.stopPropagation();

        try {
          await action();
        } catch (error) {
          console.error(error);

          this.status?.(
            'Action unavailable',
            error.message ||
              'Please try again.'
          );
        }
      }
    );

    return button;
  }
}
