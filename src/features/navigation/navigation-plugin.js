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
            '#navigationWorkspaceContent'
          ) ?? context.root.querySelector(
            '#navigationContent'
          ),
        guidanceElement:
          context.root.querySelector(
            '#navigationGuidance'
          ),
        status: context.status,
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
