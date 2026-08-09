import {
  ItineraryController
} from '../../itinerary.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export class TripFeature {
  constructor({
    map,
    panelController,
    listElement,
    daySelectElement,
    scheduleViewElement = null,
    mapViewElement = null,
    selectedStopElement = null,
    mapTimelineElement = null,
    mapStopCountElement = null,
    modeElements = [],
    status,
    onPlaceSelected = () => {},
    onNavigate = () => {},
    onNearby = () => {}
  }) {
    if (!map) {
      throw new TypeError(
        'TripFeature requires a map controller.'
      );
    }

    if (!panelController) {
      throw new TypeError(
        'TripFeature requires a panel controller.'
      );
    }

    if (!listElement || !daySelectElement) {
      throw new TypeError(
        'TripFeature requires its panel elements.'
      );
    }

    this.map = map;
    this.panelController = panelController;
    this.listElement = listElement;
    this.daySelectElement = daySelectElement;
    this.scheduleViewElement = scheduleViewElement;
    this.mapViewElement = mapViewElement;
    this.selectedStopElement = selectedStopElement;
    this.mapTimelineElement = mapTimelineElement;
    this.mapStopCountElement = mapStopCountElement;
    this.modeElements = [...modeElements];
    this.status = status;
    this.onPlaceSelected = onPlaceSelected;
    this.onNavigate = onNavigate;
    this.onNearby = onNearby;

    this.itinerary = null;
    this.tripData = null;
    this.loaded = false;
    this.mode = 'schedule';

    this.#bindModeSwitch();

    const handleStopAction = event => {
      if (event.target.closest('[data-trip-navigate]') && this.selected) {
        this.onNavigate(
          this.selected,
          this.getNavigationContext(this.selected)
        );
      }

      if (event.target.closest('[data-trip-nearby]') && this.selected) {
        this.onNearby(this.selected);
      }
    };

    this.selectedStopElement?.addEventListener('click', handleStopAction);
    this.listElement.addEventListener('click', handleStopAction);

    this.mapTimelineElement?.addEventListener('click', event => {
      const row = event.target.closest('[data-trip-map-stop]');
      if (!row || !this.itinerary) return;
      const places = this.itinerary.days[this.itinerary.selectedDay] ?? [];
      const place = places[Number(row.dataset.tripMapStop)];
      if (place) this.itinerary.select(place, null, null, {source: 'map-timeline'});
    });
  }

  load(data, {
    initialDay = '12'
  } = {}) {
    if (!data) {
      this.unload();
      return;
    }

    this.daySelectElement.replaceChildren();
    this.tripData = data.trip;

    this.itinerary = new ItineraryController({
      data,
      map: this.map,
      listElement: this.listElement,
      daySelect: this.daySelectElement,
      status: this.status
    });

    this.itinerary.setRenderHandler(() => {
      this.#renderMapTimeline();
      if (!this.selected) this.#renderSelectedStop(null);
    });

    this.itinerary.setSelectHandler((place, meta = {}) => {
      this.#renderSelectedStop(place);
      this.#renderMapTimeline(place);
      if (meta.source === 'map' || meta.source === 'map-timeline') {
        this.setMode('map');
      }
      this.onPlaceSelected(place);
    });

    this.itinerary.render(initialDay);
    this.#renderMapTimeline();
    this.loaded = true;
    this.mode = 'schedule';
    this.#syncMode();
  }

  renderView() {
    if (!this.loaded || !this.itinerary) {
      return false;
    }

    const day =
      this.itinerary.selectedDay ??
      this.daySelectElement.value ??
      Object.keys(this.itinerary.days)[0];

    const selected = this.selected;

    this.itinerary.render(day);

    // ItineraryController.render() rebuilds the schedule and clears its
    // transient selection. When the Trip workspace is merely being shown
    // again, preserve the selected stop so the Map card remains live rather
    // than becoming a visual-only stale card.
    if (selected) {
      // Keep the assignment explicit for compatibility with the existing
      // workspace-state contract, then restore the visual row selection too.
      this.itinerary.selected = selected;
      this.itinerary.restoreSelection(selected);
      this.#renderSelectedStop(selected);
      this.#renderMapTimeline(selected);
    }

    this.#syncMode();

    return true;
  }

  show() {
    if (!this.loaded) {
      return false;
    }

    this.renderView();
    return true;
  }

  setMode(mode) {
    if (mode !== 'schedule' && mode !== 'map') {
      return false;
    }

    this.mode = mode;
    this.#syncMode();
    return true;
  }

  unload() {
    this.loaded = false;
    this.itinerary = null;
    this.tripData = null;
    this.mode = 'schedule';

    this.listElement.replaceChildren();
    this.daySelectElement.replaceChildren();
    this.mapTimelineElement?.replaceChildren();
    if (this.mapStopCountElement) this.mapStopCountElement.textContent = '';
    this.map.clearItinerary();
    this.#syncMode();
  }

  isLoaded() {
    return this.loaded;
  }

  getNavigationContext(place = this.selected) {
    if (!place || !this.itinerary || !this.tripData) {
      return null;
    }

    const dayIds = Object.keys(this.itinerary.days);
    const selectedDay = String(
      this.itinerary.selectedDay ?? this.daySelectElement.value ?? dayIds[0]
    );
    const dayIndex = dayIds.indexOf(selectedDay);
    const places = this.itinerary.days[selectedDay] ?? [];
    let stopIndex = places.indexOf(place);

    if (stopIndex < 0) {
      stopIndex = places.findIndex(candidate =>
        candidate?.name === place.name &&
        candidate?.lat === place.lat &&
        candidate?.lon === place.lon
      );
    }

    if (stopIndex < 0) {
      return null;
    }

    let nextStop = places[stopIndex + 1] ?? null;
    let nextDay = selectedDay;

    if (!nextStop) {
      for (let index = dayIndex + 1; index < dayIds.length; index += 1) {
        const candidateDay = dayIds[index];
        const candidate = this.itinerary.days[candidateDay]?.[0];
        if (candidate) {
          nextStop = candidate;
          nextDay = candidateDay;
          break;
        }
      }
    }

    return {
      type: 'itinerary',
      tripName: this.tripData.name ?? this.tripData.title ?? 'Trip',
      day: selectedDay,
      stopIndex,
      currentStop: place,
      nextStop,
      nextDay: nextStop ? nextDay : null,
      isFinalStop: nextStop === null,
      completionLabel: 'This itinerary is complete'
    };
  }

  get selected() {
    return this.itinerary?.selected ?? null;
  }

  #bindModeSwitch() {
    for (const button of this.modeElements) {
      button.addEventListener('click', () => {
        this.setMode(button.dataset.tripMode);
      });
    }
  }

  #syncMode() {
    const schedule = this.mode === 'schedule';

    if (this.scheduleViewElement) {
      this.scheduleViewElement.hidden = !schedule;
    }

    if (this.mapViewElement) {
      this.mapViewElement.hidden = schedule;
    }

    for (const button of this.modeElements) {
      const active = button.dataset.tripMode === this.mode;
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  #renderMapTimeline(selected = this.selected) {
    if (!this.mapTimelineElement || !this.itinerary) return;

    const places = this.itinerary.days[this.itinerary.selectedDay] ?? [];
    if (this.mapStopCountElement) {
      this.mapStopCountElement.textContent = `${places.length} stop${places.length === 1 ? '' : 's'}`;
    }

    this.mapTimelineElement.innerHTML = places.map((place, index) => {
      const active = selected && (place === selected || (
        place?.name === selected.name && place?.lat === selected.lat && place?.lon === selected.lon
      ));
      const image = place?.image ?? place?.thumbnail ?? place?.imageUrl ?? '';
      return `
        <button type="button" class="trip-map-stop${active ? ' active' : ''}${image ? ' has-thumbnail' : ''}" data-trip-map-stop="${index}">
          <span>${index + 1}</span>
          ${image ? `<img class="trip-map-stop-thumb" src="${escapeHtml(String(image))}" alt="" decoding="async">` : ''}
          <strong>${escapeHtml(place.name ?? `Stop ${index + 1}`)}</strong>
        </button>`;
    }).join('');

    this.mapTimelineElement.querySelectorAll('.trip-map-stop-thumb').forEach(thumbnail => {
      thumbnail.addEventListener('error', () => {
        const stop = thumbnail.closest('.trip-map-stop');
        thumbnail.remove();
        stop?.classList.remove('has-thumbnail');
      }, { once: true });
    });

    this.mapTimelineElement.querySelector('.trip-map-stop.active')?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest'
    });
  }

  #renderSelectedStop(place) {
    if (!this.selectedStopElement) return;

    if (!place) {
      this.selectedStopElement.innerHTML = '<small>Select a stop from the itinerary or tap a numbered pin.</small>';
      return;
    }

    this.selectedStopElement.innerHTML = `
      <div class="trip-selected-stop-copy">
        <small>Selected</small>
        <strong>${escapeHtml(place.name ?? 'Trip stop')}</strong>
        ${place.note ? `<span>${escapeHtml(place.note)}</span>` : ''}
      </div>
      <div class="trip-selected-stop-actions">
        <button type="button" data-trip-nearby>Nearby</button>
        <button class="primary" type="button" data-trip-navigate>Navigate</button>
      </div>
    `;
  }
}
