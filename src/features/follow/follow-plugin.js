import {
  FollowModeController
} from './follow-mode-controller.js';

export class FollowPlugin {
  constructor() {
    this.id = 'follow';
    this.controller = null;
  }

  start(context) {
    this.controller = new FollowModeController({
      map: context.map,
      mapContext: context.mapContext,
      followButton:
        context.root.querySelector('#followBtn'),
      recenterButton:
        context.root.querySelector('#recenterBtn'),
      status: context.status
    });

    context.provide(
      'followModeController',
      this.controller
    );
  }

  stop(context) {
    context.remove(
      'followModeController'
    );

    this.controller = null;
  }
}
