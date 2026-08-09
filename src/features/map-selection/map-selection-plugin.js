import {
  MapSelectionFeature
} from './map-selection-feature.js';

export class MapSelectionPlugin {
  constructor({
    onNavigate,
    onBookmark
  }) {
    this.id = 'map-selection';
    this.feature = null;
    this.onNavigate = onNavigate;
    this.onBookmark = onBookmark;
  }

  start(context) {
    this.feature =
      new MapSelectionFeature({
        map: context.map,
        status: context.status,
        onNavigate: this.onNavigate,
        onBookmark: this.onBookmark,
        onSearchNearby: point => {
          context.root.dispatchEvent(
            new CustomEvent('mapnearby', {
              detail: { point }
            })
          );
        }
      });

    context.provide(
      'mapSelectionFeature',
      this.feature
    );
  }

  stop(context) {
    this.feature?.clear();
    this.feature = null;

    context.remove(
      'mapSelectionFeature'
    );
  }
}
