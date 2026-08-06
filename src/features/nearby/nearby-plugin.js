import {
  NearbyFeature
} from './nearby-feature.js';

export class NearbyPlugin {
  constructor() {
    this.id = 'nearby';
    this.feature = null;
  }

  start(context) {
    this.feature = new NearbyFeature({
      map: context.map,
      panelController:
        context.panelController,
      listElement:
        context.root.querySelector('#list'),
      chipElements:
        context.root.querySelectorAll('.chip'),
      status: context.status
    });

    context.provide(
      'nearbyFeature',
      this.feature
    );
  }

  stop() {
    this.feature?.clear();
    this.feature = null;
  }
}
