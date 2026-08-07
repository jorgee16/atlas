import {
  ItineraryController
} from '../../itinerary.js';

export class TripFeature {
  constructor({
    map,
    panelController,
    listElement,
    daySelectElement,
    status,
    onPlaceSelected = () => {}
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
    this.status = status;
    this.onPlaceSelected = onPlaceSelected;

    this.itinerary = null;
    this.loaded = false;
  }

  load(data, {
    initialDay = '12',
    snap = 'half'
  } = {}) {
    if (!data) {
      this.unload();
      return;
    }

    this.itinerary = new ItineraryController({
      data,
      map: this.map,
      listElement: this.listElement,
      daySelect: this.daySelectElement,
      status: this.status
    });

    this.itinerary.setSelectHandler(place => {
      this.panelController.expand();
      this.onPlaceSelected(place);
    });

    this.itinerary.render(initialDay);

    this.loaded = true;

    this.panelController.sheet
      .classList.add('has-trip');

    this.panelController.show('trip', {
      snap
    });
  }

  unload() {
    this.loaded = false;
    this.itinerary = null;

    this.panelController.sheet
      .classList.remove('has-trip');

    this.listElement.replaceChildren();
    this.daySelectElement.replaceChildren();

    this.map.clearItinerary();
    this.panelController.hide();
  }

  isLoaded() {
    return this.loaded;
  }

  get selected() {
    return this.itinerary?.selected ?? null;
  }
}
