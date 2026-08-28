const STORAGE_KEY = 'atlas.appearance';
const MODES = new Set(['system', 'light', 'dark']);

export class AppearancePreference {
  constructor({
    storage = globalThis.localStorage,
    documentRef = globalThis.document,
    matchMediaRef = globalThis.matchMedia?.bind(globalThis)
  } = {}) {
    this.storage = storage;
    this.document = documentRef;
    this.matchMedia = matchMediaRef;
    this.mode = this.#load();
    this.mediaQuery = null;
    this.onSystemThemeChange = () => {
      if (this.mode === 'system') this.apply();
    };

    if (this.matchMedia) {
      this.mediaQuery = this.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery?.addEventListener?.('change', this.onSystemThemeChange);
    }

    this.apply();
  }

  getMode() {
    return this.mode;
  }

  setMode(mode) {
    if (!MODES.has(mode)) return false;
    this.mode = mode;

    try {
      this.storage?.setItem(STORAGE_KEY, mode);
    } catch {
      // Appearance still applies for this session when storage is unavailable.
    }

    this.apply();
    return true;
  }

  apply() {
    const resolved = this.mode === 'system'
      ? (this.mediaQuery?.matches ? 'dark' : 'light')
      : this.mode;

    const root = this.document?.documentElement;
    if (!root) return resolved;

    const previous = root.dataset.atlasTheme ?? null;

    root.dataset.atlasAppearance = this.mode;
    root.dataset.atlasTheme = resolved;
    root.style.colorScheme = resolved;

    if (previous && previous !== resolved) {
      const EventConstructor =
        this.document?.defaultView?.CustomEvent ??
        globalThis.CustomEvent;

      if (typeof EventConstructor === 'function') {
        root.dispatchEvent(
          new EventConstructor('atlasappearancechange', {
            detail: {
              mode: this.mode,
              previous,
              resolved
            }
          })
        );
      }
    }

    return resolved;
  }

  #load() {
    try {
      const saved = this.storage?.getItem(STORAGE_KEY);
      return MODES.has(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  }
}
