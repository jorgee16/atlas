import {
  BookmarkStore
} from './bookmark-store.js';

export class BookmarksFeature {
  constructor({
    map,
    panelController,
    listElement,
    status,
    store = new BookmarkStore()
  }) {
    if (!map || !panelController || !listElement) {
      throw new TypeError(
        'BookmarksFeature requires map, panelController and listElement.'
      );
    }

    this.map = map;
    this.panelController = panelController;
    this.listElement = listElement;
    this.status = status;
    this.store = store;
    this.bookmarks = this.store.load();
  }

  add({
    name,
    lat,
    lon
  }) {
    if (
      !name ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon)
    ) {
      throw new TypeError(
        'Bookmark requires name, lat and lon.'
      );
    }

    const bookmark = {
      id: crypto.randomUUID(),
      name,
      lat,
      lon
    };

    this.bookmarks.push(bookmark);
    this.store.save(this.bookmarks);
    this.render();

    this.status(
      'Bookmark saved',
      name
    );

    return bookmark;
  }

  remove(id) {
    this.bookmarks =
      this.bookmarks.filter(
        bookmark => bookmark.id !== id
      );

    this.store.save(this.bookmarks);
    this.render();
  }

  show() {
    this.panelController.show(
      'bookmarks',
      { snap: 'half' }
    );

    this.render();
  }

  render() {
    this.listElement.replaceChildren();

    const title =
      document.createElement('div');

    title.className = 'section-title';
    title.textContent = 'Bookmarks';

    this.listElement.appendChild(title);

    if (!this.bookmarks.length) {
      const empty =
        document.createElement('p');

      empty.textContent =
        'No saved places yet.';

      this.listElement.appendChild(empty);
      return;
    }

    this.bookmarks.forEach(bookmark => {
      const card =
        document.createElement('div');

      card.className = 'nearby-card';

      card.innerHTML = `
        <strong>${bookmark.name}</strong>
        <small>
          ${bookmark.lat.toFixed(5)},
          ${bookmark.lon.toFixed(5)}
        </small>
      `;

      const focusButton =
        document.createElement('button');

      focusButton.type = 'button';
      focusButton.textContent = 'Show';

      focusButton.addEventListener(
        'click',
        () => {
          this.map.focus(
            bookmark.lat,
            bookmark.lon,
            16
          );
        }
      );

      const removeButton =
        document.createElement('button');

      removeButton.type = 'button';
      removeButton.textContent = 'Remove';

      removeButton.addEventListener(
        'click',
        () => this.remove(bookmark.id)
      );

      card.append(
        focusButton,
        removeButton
      );

      this.listElement.appendChild(card);
    });
  }

  clear() {
    this.bookmarks = [];
    this.store.clear();
    this.render();
  }
}
