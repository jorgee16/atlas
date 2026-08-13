import {
  NavigationFeature
} from './navigation-feature.js';

export class NavigationPlugin {
  constructor({
    transitBridge = null,
    onBookmarkDestination = () => {}
  } = {}) {
    this.id = 'navigation';
    this.transitBridge = transitBridge;
    this.onBookmarkDestination = onBookmarkDestination;
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
            '#navigationWorkspaceContent'
          ) ?? context.root.querySelector(
            '#navigationContent'
          ),
        guidanceElement:
          context.root.querySelector(
            '#navigationGuidance'
          ),
        status: context.status,
        transitBridge: this.transitBridge,
        onBookmarkDestination:
          this.onBookmarkDestination,
        onArrivalAction: (action, detail) => {
          context.root.dispatchEvent(
            new CustomEvent('navigationarrivalaction', {
              detail: { action, ...detail }
            })
          );
        },
        onActiveChange: (
          active,
          options
        ) => {
          if (context.has('followMode')) {
            context
              .get('followMode')
              .setNavigationActive(
                active,
                options
              );
          }

          context.root.dispatchEvent(
            new CustomEvent('navigationactivechange', {
              detail: { active, options }
            })
          );
        }
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
