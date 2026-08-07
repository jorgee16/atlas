import {
  BookmarksFeature
} from './bookmarks-feature.js';

export class BookmarksPlugin {
  constructor({
    onNavigate = null
  } = {}) {
    this.id = 'bookmarks';
    this.feature = null;
    this.onNavigate = onNavigate;
  }

  start(context) {
    this.feature =
      new BookmarksFeature({
        map: context.map,
        panelController:
          context.panelController,
        listElement:
          context.root.querySelector('#bookmarksContent'),
        status: context.status,
        onNavigate: this.onNavigate
      });

    context.provide(
      'bookmarksFeature',
      this.feature
    );
  }

  stop(context) {
    this.feature = null;

    context.remove(
      'bookmarksFeature'
    );
  }
}
