import {
  BookmarksFeature
} from './bookmarks-feature.js';

export class BookmarksPlugin {
  constructor() {
    this.id = 'bookmarks';
    this.feature = null;
  }

  start(context) {
    this.feature =
      new BookmarksFeature({
        map: context.map,
        panelController:
          context.panelController,
        listElement:
          context.root.querySelector('#list'),
        status: context.status
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
