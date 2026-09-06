import {
  NavigationFeature
} from './navigation-feature.js';

export class NavigationPlugin {
  constructor({
    transitProviderRegistry = null,
    transitBridge = null,
    onBookmarkDestination = () => {}
  } = {}) {
    this.id = 'navigation';
    this.transitProviderRegistry = transitProviderRegistry;
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
        transitProviderRegistry: this.transitProviderRegistry,
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

    /*
     * "Stop" and "Finish" are intentionally different operations.
     *
     * A manual Stop may keep the selected destination so the user can inspect
     * or restart that route. Finishing after arrival is terminal: the completed
     * destination must not immediately reopen as a Route preview / Bookmark
     * card. Keep that distinction at the plugin boundary without changing the
     * long-established Stop semantics inside NavigationFeature.
     */
    const finishArrival =
      this.feature.finishArrival.bind(
        this.feature
      );

    this.feature.finishArrival = () => {
      const travelMode =
        this.feature.getPlannerState()
          .travelMode;

      const finished = finishArrival();

      if (!finished) {
        return false;
      }

      this.feature.clearPlannerDestination();

      // clearPlannerDestination() intentionally starts a brand-new generic
      // plan on Drive. A completed Walk route, however, should not silently
      // change the user's preferred planner mode just because Finish was
      // pressed. Restore the mode after clearing the stale destination.
      if (
        travelMode &&
        travelMode !== 'drive'
      ) {
        this.feature.setTravelMode(
          travelMode
        );
      }

      return true;
    };

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
