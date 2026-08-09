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
      scheduleViewElement:
        context.root.querySelector('#tripScheduleView'),
      mapViewElement:
        context.root.querySelector('#tripMapView'),
      selectedStopElement:
        context.root.querySelector('#tripSelectedStop'),
      mapTimelineElement:
        context.root.querySelector('#tripMapTimeline'),
      mapStopCountElement:
        context.root.querySelector('#tripMapStopCount'),
      modeElements:
        context.root.querySelectorAll('[data-trip-mode]'),
      status: context.status,
      onPlaceSelected:
        this.onPlaceSelected,
      onNavigate: (place, navigationContext) => {
        context.root.dispatchEvent(
          new CustomEvent('tripnavigate', {
            detail: { place, navigationContext }
          })
        );
      },
      onNearby: place => {
        context.root.dispatchEvent(
          new CustomEvent('tripnearby', {
            detail: { place }
          })
        );
      }
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
