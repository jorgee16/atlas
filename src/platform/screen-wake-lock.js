export class ScreenWakeLock {
  constructor({
    navigatorRef = globalThis.navigator,
    documentRef = globalThis.document
  } = {}) {
    this.navigator = navigatorRef;
    this.document = documentRef;
    this.active = false;
    this.sentinel = null;
    this.requestPromise = null;

    this.onVisibilityChange = () => {
      if (
        this.active &&
        this.document?.visibilityState !== 'hidden'
      ) {
        void this.#acquire();
      }
    };

    this.document?.addEventListener?.(
      'visibilitychange',
      this.onVisibilityChange
    );
  }

  async setActive(active) {
    this.active = active === true;

    if (!this.active) {
      await this.#release();
      return false;
    }

    return this.#acquire();
  }

  async destroy() {
    this.active = false;
    this.document?.removeEventListener?.(
      'visibilitychange',
      this.onVisibilityChange
    );
    await this.#release();
  }

  async #acquire() {
    if (this.sentinel) {
      return true;
    }

    if (
      this.document?.visibilityState === 'hidden' ||
      typeof this.navigator?.wakeLock?.request !== 'function'
    ) {
      return false;
    }

    if (this.requestPromise) {
      return this.requestPromise;
    }

    this.requestPromise = (async () => {
      try {
        const sentinel = await this.navigator.wakeLock.request('screen');

        if (!this.active) {
          await sentinel.release?.();
          return false;
        }

        this.sentinel = sentinel;
        sentinel.addEventListener?.('release', () => {
          if (this.sentinel === sentinel) {
            this.sentinel = null;
          }
        });
        return true;
      } catch {
        return false;
      } finally {
        this.requestPromise = null;
      }
    })();

    return this.requestPromise;
  }

  async #release() {
    const sentinel = this.sentinel;
    this.sentinel = null;

    if (!sentinel) {
      return;
    }

    try {
      await sentinel.release?.();
    } catch {
      // Losing a wake lock is harmless; navigation itself must continue.
    }
  }
}
