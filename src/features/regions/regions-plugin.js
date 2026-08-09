import {
  RegionManager
} from '../../regions/region-manager.js';

import {
  RegionsFeature
} from './regions-feature.js';

export class RegionsPlugin {
  constructor({
    manager = null
  } = {}) {
    this.id = 'regions';
    this.manager = manager;
    this.feature = null;
  }

  start(context) {
    this.manager ??=
      new RegionManager({
        status: context.status,
      map: context.map
      });

    this.feature = new RegionsFeature({
      manager: this.manager,
      panelController:
        context.panelController,
      listElement:
        context.root.querySelector(
          '#regionsOverlayContent'
        ) ?? context.root.querySelector(
          '#regionsContent'
        ),
      status: context.status,
      map: context.map
    });

    context.provide(
      'regionManager',
      this.manager
    );

    context.provide(
      'regionsFeature',
      this.feature
    );
  }

  stop(context) {
    this.feature?.destroy();
    this.feature = null;

    context.remove('regionsFeature');
    context.remove('regionManager');
  }
}
