import {
  TripFeature
} from './trip-feature.js';

export class TripPlugin {
  constructor({
    data = null,
    initialDay = '12',
    snap = 'half',
    onPlaceSelected = () => {}
  } = {}) {
    this.id = 'trip';

    this.data = data;
    this.initialDay = initialDay;
    this.snap = snap;
    this.onPlaceSelected = onPlaceSelected;

    this.feature = null;
  }

  start(context) {
    this.feature = new TripFeature({
      map: context.map,
      panelController:
        context.panelController,
      listElement:
        context.root.querySelector('#tripContent'),
      daySelectElement:
        context.root.querySelector('#daySelect'),
      status: context.status,
      onPlaceSelected:
        this.onPlaceSelected
    });

    if (this.data) {
      this.feature.load(this.data, {
        initialDay: this.initialDay,
        snap: this.snap
      });
    } else {
      this.feature.unload();
    }

    context.provide(
      'tripFeature',
      this.feature
    );
  }

  stop(context) {
    this.feature?.unload();
    this.feature = null;
    context.remove('tripFeature');
  }
}
