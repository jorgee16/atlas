import {
  BookmarkStore
} from './bookmark-store.js';

export class BookmarksFeature {
  constructor({
    map,
    listElement,
    status,
    store = new BookmarkStore(),
    onNavigate = null,
    onShow = null,
    onFocus = null
  }) {
    if (!map || !listElement) {
      throw new TypeError(
        'BookmarksFeature requires map and listElement.'
      );
    }

    this.map = map;
    this.listElement = listElement;
    this.status = status;
    this.store = store;
    this.onNavigate = onNavigate;
    this.onShow = onShow;
    this.onFocus = onFocus;
    this.bookmarks = this.store.load();
  }

  add({ name, lat, lon, image = null, thumbnail = null, imageUrl = null }) {
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new TypeError('Bookmark requires name, lat and lon.');
    }

    const bookmark = {
      id: crypto.randomUUID(),
      name,
      lat,
      lon,
      image: image ?? thumbnail ?? imageUrl ?? null
    };

    this.bookmarks.push(bookmark);
    this.store.save(this.bookmarks);
    this.render();
    this.status?.('Bookmark saved', name);
    return bookmark;
  }

  remove(id) {
    this.bookmarks = this.bookmarks.filter(bookmark => bookmark.id !== id);
    this.store.save(this.bookmarks);
    this.render();
  }

  rename(id, name) {
    const trimmedName = name?.trim();
    if (!trimmedName) return false;

    const bookmark = this.bookmarks.find(item => item.id === id);
    if (!bookmark) return false;

    bookmark.name = trimmedName;
    this.store.save(this.bookmarks);
    this.render();
    this.status?.('Bookmark renamed', trimmedName);
    return true;
  }

  show() {
    this.onShow?.();
  }

  render() {
    this.listElement.replaceChildren();

    if (!this.bookmarks.length) {
      const empty = document.createElement('div');
      empty.className = 'bookmarks-empty';
      empty.innerHTML = '<strong>No saved places yet</strong><span>Save a point from the map and it will appear here.</span>';
      this.listElement.appendChild(empty);
      return;
    }

    this.bookmarks.forEach(bookmark => {
      const card = document.createElement('article');
      card.className = 'bookmark-library-card';

      const media = bookmark.image || bookmark.thumbnail || bookmark.imageUrl;
      if (media) {
        const thumbnail = document.createElement('img');
        thumbnail.className = 'bookmark-library-thumb';
        thumbnail.src = media;
        thumbnail.alt = '';
        thumbnail.loading = 'lazy';
        thumbnail.decoding = 'async';
        thumbnail.addEventListener('error', () => {
          thumbnail.remove();
        }, { once: true });
        card.appendChild(thumbnail);
      }

      const copy = document.createElement('div');
      copy.className = 'bookmark-library-copy';

      const name = document.createElement('strong');
      name.textContent = bookmark.name;

      const coordinates = document.createElement('small');
      coordinates.textContent = `${bookmark.lat.toFixed(5)}, ${bookmark.lon.toFixed(5)}`;
      copy.append(name, coordinates);

      const actions = document.createElement('div');
      actions.className = 'bookmark-library-actions';

      const showButton = document.createElement('button');
      showButton.type = 'button';
      showButton.textContent = 'Show';
      showButton.addEventListener('click', () => {
        if (typeof this.onFocus === 'function') {
          this.onFocus(bookmark);
          return;
        }
        this.map.focus(bookmark.lat, bookmark.lon, 16);
        this.map.showSelectionPin(bookmark.lat, bookmark.lon);
      });

      const navigateButton = document.createElement('button');
      navigateButton.type = 'button';
      navigateButton.textContent = 'Navigate';
      navigateButton.className = 'primary';
      navigateButton.disabled = typeof this.onNavigate !== 'function';
      navigateButton.addEventListener('click', () => this.onNavigate?.(bookmark));

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.textContent = 'Rename';
      editButton.addEventListener('click', () => {
        const nextName = window.prompt('Bookmark name', bookmark.name);
        if (nextName !== null) this.rename(bookmark.id, nextName);
      });

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.textContent = 'Remove';
      removeButton.className = 'danger-link';
      removeButton.addEventListener('click', () => this.remove(bookmark.id));

      actions.append(showButton, navigateButton, editButton, removeButton);
      card.append(copy, actions);
      this.listElement.appendChild(card);
    });
  }

  clear() {
    this.bookmarks = [];
    this.store.clear();
    this.render();
  }
}
