import {
  BookmarkStore
} from './bookmark-store.js';

export class BookmarksFeature {
  constructor({
    map,
    panelController,
    listElement,
    status,
    store = new BookmarkStore(),
    onNavigate = null
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
    this.onNavigate = onNavigate;
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

  rename(id, name) {
    const trimmedName = name?.trim();

    if (!trimmedName) {
      return false;
    }

    const bookmark =
      this.bookmarks.find(
        item => item.id === id
      );

    if (!bookmark) {
      return false;
    }

    bookmark.name = trimmedName;

    this.store.save(this.bookmarks);
    this.render();

    this.status(
      'Bookmark renamed',
      trimmedName
    );

    return true;
  }

  show() {
    this.panelController.showMode(
      'bookmarks',
      { snap: 'half' }
    );
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

      const name =
        document.createElement('strong');

      name.textContent = bookmark.name;

      const coordinates =
        document.createElement('small');

      coordinates.textContent =
        `${bookmark.lat.toFixed(5)}, ${bookmark.lon.toFixed(5)}`;

      card.append(name, coordinates);

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

            this.map.showSelectionPin(
              bookmark.lat,
              bookmark.lon
            );
        }
      );

      const navigateButton =
        document.createElement('button');

      navigateButton.type = 'button';
      navigateButton.textContent = 'Navigate';
      navigateButton.disabled =
        typeof this.onNavigate !== 'function';

      navigateButton.addEventListener(
        'click',
        () => {
          this.onNavigate?.(bookmark);
        }
      );

      const editButton =
        document.createElement('button');

      editButton.type = 'button';
      editButton.textContent = 'Rename';

      editButton.addEventListener(
        'click',
        () => {
          const nextName = window.prompt(
            'Bookmark name',
            bookmark.name
          );

          if (nextName === null) {
            return;
          }

          this.rename(
            bookmark.id,
            nextName
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
        navigateButton,
        editButton,
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
