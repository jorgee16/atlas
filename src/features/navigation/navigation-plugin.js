import {
  NavigationFeature
} from './navigation-feature.js';

export class NavigationPlugin {
  constructor() {
    this.id = 'navigation';
    this.feature = null;
  }

  start(context) {
    this.feature =
      new NavigationFeature({
        map: context.map,
        panelController:
          context.panelController,
        listElement:
          context.root.querySelector(
            '#list'
          ),
        status: context.status
      });

    context.provide(
      'navigationFeature',
      this.feature
    );
  }

  stop(context) {
    this.feature?.stop();
    this.feature = null;

    context.remove(
      'navigationFeature'
    );
  }
}
