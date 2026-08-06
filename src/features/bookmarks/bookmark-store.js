export class BookmarkStore {
  constructor({
    storage = window.localStorage,
    key = 'roam.bookmarks'
  } = {}) {
    this.storage = storage;
    this.key = key;
  }

  load() {
    const raw = this.storage.getItem(this.key);

    if (!raw) {
      return [];
    }

    try {
      const bookmarks = JSON.parse(raw);

      if (!Array.isArray(bookmarks)) {
        return [];
      }

      return bookmarks.filter(bookmark =>
        bookmark &&
        typeof bookmark.id === 'string' &&
        typeof bookmark.name === 'string' &&
        Number.isFinite(bookmark.lat) &&
        Number.isFinite(bookmark.lon)
      );
    } catch (error) {
      console.error(
        'Could not load bookmarks:',
        error
      );

      return [];
    }
  }

  save(bookmarks) {
    if (!Array.isArray(bookmarks)) {
      throw new TypeError(
        'BookmarkStore.save requires an array.'
      );
    }

    this.storage.setItem(
      this.key,
      JSON.stringify(bookmarks)
    );
  }

  clear() {
    this.storage.removeItem(this.key);
  }
}
