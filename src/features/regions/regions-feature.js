import {
  escapeHtml
} from '../../utils.js';

export class RegionsFeature {
  constructor({
    manager,
    panelController,
    listElement,
    status = () => {},
    documentRef = globalThis.document,
    map = null,
    scheduleFrame = callback =>
      globalThis.requestAnimationFrame
        ? globalThis.requestAnimationFrame(callback)
        : globalThis.setTimeout(callback, 0)
  }) {
    if (
      !manager ||
      !panelController ||
      !listElement ||
      !documentRef
    ) {
      throw new TypeError(
        'RegionsFeature requires manager, panel controller and list element.'
      );
    }

    this.manager = manager;
    this.panelController =
      panelController;
    this.listElement = listElement;
    this.status = status;
    this.document = documentRef;
    this.map = map;
    this.scheduleFrame = scheduleFrame;

    this.progress = new Map();
    this.controllers = new Map();
    this.errors = new Map();
    this.pendingFrames = new Set();
    this.confirmRemoveId = null;
    this.renderRequest = 0;
    this.dirty = true;
    this.onShow = null;
    this.mode = 'library';
    this.selectedRegionId = null;
    this.libraryScrollTop = 0;

    this.onClick = event => {
      void this.#handleClick(event);
    };

    this.listElement.addEventListener(
      'click',
      this.onClick
    );

    this.unsubscribe =
      this.manager.subscribe(() => {
        this.dirty = true;

        if (this.#isVisible()) {
          void this.render();
        }
      });
  }

  async render() {
    const request = ++this.renderRequest;

    this.listElement.setAttribute(
      'aria-busy',
      'true'
    );

    try {
      const [regions, storage] =
        await Promise.all([
          this.manager.listRegions(),
          this.manager.getStorageSummary()
        ]);

      if (request !== this.renderRequest) {
        return;
      }

      if (this.mode === 'selector') {
        this.#renderSelector(regions, storage);
      } else {
        this.#renderLibrary(regions, storage);
      }

      this.dirty = false;
    } catch (error) {
      if (request !== this.renderRequest) {
        return;
      }

      this.listElement.innerHTML = `
        <div class="regions-empty" role="alert">
          <strong>Regions are unavailable</strong>
          <span>${escapeHtml(error.message)}</span>
          <button type="button" data-region-action="retry-list">Try again</button>
        </div>
      `;
    } finally {
      if (request === this.renderRequest) {
        this.listElement.removeAttribute(
          'aria-busy'
        );
      }
    }
  }

  #renderLibrary(regions, storage) {
    const installed = regions.filter(region =>
      region.included || region.installed
    );
    const updates = regions.filter(region =>
      region.updateAvailable
    ).length;
    const nearbyAvailable = regions.find(region =>
      region.nearCurrentLocation && !region.included && !region.installed
    ) ?? null;

    this.listElement.closest?.('#regionsOverlay')
      ?.setAttribute?.('data-mode', 'library');

    this.listElement.innerHTML = `
      ${storageSummary(storage, updates)}

      <div class="regions-library-heading">
        <div>
          <small>Installed library</small>
          <strong>${installed.length} ${installed.length === 1 ? 'region' : 'regions'} ready</strong>
        </div>
        <button class="region-add-action" type="button" data-region-action="add-region">+ Add region</button>
      </div>

      <div class="regions-list">
        ${installed.length
          ? installed.map(region =>
              regionCard(
                region,
                this.progress.get(region.id),
                this.errors.get(region.id),
                this.confirmRemoveId === region.id
              )
            ).join('')
          : `<div class="regions-empty"><strong>No downloaded regions</strong><span>Add a region to keep maps, places and navigation available offline.</span></div>`}
      </div>

      ${nearbyAvailable ? `
        <div class="regions-recommendation">
          <small>Near you</small>
          ${regionCard(
            nearbyAvailable,
            this.progress.get(nearbyAvailable.id),
            this.errors.get(nearbyAvailable.id),
            this.confirmRemoveId === nearbyAvailable.id
          )}
        </div>
      ` : ''}

      <p class="regions-footnote">
        Downloads and updates are always explicit. Installed data stays usable while an update is prepared.
      </p>
    `;

    this.listElement.scrollTop = this.libraryScrollTop;
  }

  #renderSelector(regions, storage) {
    const selected = regions.find(region =>
      region.id === this.selectedRegionId
    ) ?? regions.find(region => region.nearCurrentLocation) ?? regions[0] ?? null;

    this.selectedRegionId = selected?.id ?? null;
    this.listElement.closest?.('#regionsOverlay')
      ?.setAttribute?.('data-mode', 'selector');

    this.listElement.innerHTML = `
      <div class="region-selector-toolbar">
        <button type="button" data-region-action="back-library" aria-label="Back to downloaded regions">←</button>
        <div><small>Add region</small><strong>Choose an offline area</strong></div>
      </div>

      <div class="region-selector-chips" role="list">
        ${regions.map(region => `
          <button
            type="button"
            role="listitem"
            class="${region.id === selected?.id ? 'on' : ''}"
            data-region-action="select-region"
            data-region-select-id="${escapeHtml(region.id)}"
          >${escapeHtml(region.name)}</button>
        `).join('')}
      </div>

      ${selected
        ? `<div class="region-selector-card">
            <div class="region-selector-copy">
              <small>${escapeHtml(selected.country ?? 'Offline region')}</small>
              <strong>${escapeHtml(selected.name)}</strong>
              <span>${regionCoverageCopy(selected)} · ${formatBytes(selected.sizeBytes ?? selected.installedSizeBytes ?? 0)}</span>
            </div>
            <span class="region-state region-state--${regionState(selected).tone}">${escapeHtml(regionState(selected).label)}</span>
            <div class="region-components">${regionComponents(selected).map(component => `<span>${componentIcon(component.id)}${escapeHtml(component.label)}</span>`).join('')}</div>
            ${this.progress.get(selected.id) ? progressMarkup(this.progress.get(selected.id)) : ''}
            ${this.errors.get(selected.id) ? `<p class="region-error" role="alert">${escapeHtml(this.errors.get(selected.id))}</p>` : ''}
            ${regionActions(selected, Boolean(this.errors.get(selected.id)), Boolean(this.progress.get(selected.id)))}
          </div>`
        : emptyState()}

      <div class="region-selector-storage">${formatBytes(storage.downloadedBytes)} downloaded on this device</div>
    `;

    if (selected) {
      this.#focusRegion(selected);
    }
  }

  #focusRegion(region) {
    if (!this.map?.focus) return;

    const center = regionCenter(region);
    if (!center) return;

    this.map.focus(center.lat, center.lon, 7);
  }

  show() {
    if (this.onShow) {
      this.onShow();
    } else {
      this.panelController.showMode(
        'regions',
        { snap: 'half' }
      );
    }

    if (this.dirty) {
      void this.render();
    }
  }

  destroy() {
    this.controllers.forEach(
      controller => controller.abort()
    );

    this.controllers.clear();
    this.unsubscribe?.();

    this.listElement.removeEventListener(
      'click',
      this.onClick
    );
  }

  async #handleClick(event) {
    const button = event.target.closest?.(
      '[data-region-action]'
    );

    if (!button) {
      return;
    }

    const action =
      button.dataset.regionAction;

    const regionId =
      button.closest('[data-region-id]')
        ?.dataset.regionId ??
      (this.mode === 'selector'
        ? this.selectedRegionId
        : null);

    if (action === 'add-region') {
      this.libraryScrollTop = this.listElement.scrollTop ?? 0;
      this.mode = 'selector';
      await this.render();
      return;
    }

    if (action === 'back-library') {
      this.mode = 'library';
      await this.render();
      return;
    }

    if (action === 'select-region') {
      this.selectedRegionId = button.dataset.regionSelectId ?? null;
      await this.render();
      return;
    }

    if (action === 'retry-list') {
      await this.render();
      return;
    }

    if (!regionId) {
      return;
    }

    const region =
      (await this.manager.listRegions())
        .find(candidate =>
          candidate.id === regionId
        );

    if (!region) {
      return;
    }

    switch (action) {
      case 'download':
      case 'update':
      case 'retry':
        await this.#download(region);
        break;

      case 'cancel-download':
        this.controllers
          .get(region.id)
          ?.abort();
        break;

      case 'confirm-remove':
        this.confirmRemoveId = region.id;
        await this.render();
        break;

      case 'cancel-remove':
        this.confirmRemoveId = null;
        await this.render();
        break;

      case 'remove':
        await this.#remove(region);
        break;
    }
  }

  async #download(region) {
    if (this.controllers.has(region.id)) {
      return;
    }

    const controller =
      new AbortController();

    this.controllers.set(
      region.id,
      controller
    );

    this.errors.delete(region.id);
    this.confirmRemoveId = null;
    this.progress.set(region.id, {
      phase: 'starting',
      completedFiles: 0,
      totalFiles: 0,
      downloadedBytes: 0,
      totalBytes:
        positiveOrNull(
          region.sizeBytes
        )
    });

    await this.render();

    try {
      await this.manager.downloadRegion(
        region,
        {
          signal: controller.signal,
          onProgress: value => {
            this.progress.set(
              region.id,
              value
            );

            this.#scheduleProgress(
              region.id
            );
          }
        }
      );

      this.progress.delete(region.id);
    } catch (error) {
      this.progress.delete(region.id);

      if (error?.name === 'AbortError') {
        this.status(
          'Download cancelled',
          `${region.name} was not changed.`
        );
      } else {
        console.error(error);
        this.errors.set(
          region.id,
          error.message
        );

        this.status(
          'Download failed',
          error.message
        );
      }
    } finally {
      this.controllers.delete(region.id);
      await this.render();
    }
  }

  async #remove(region) {
    this.errors.delete(region.id);
    this.confirmRemoveId = null;

    try {
      await this.manager.removeRegion(region);
    } catch (error) {
      console.error(error);
      this.errors.set(
        region.id,
        error.message
      );

      this.status(
        'Could not remove region',
        error.message
      );
    }

    await this.render();
  }

  #scheduleProgress(regionId) {
    if (this.pendingFrames.has(regionId)) {
      return;
    }

    this.pendingFrames.add(regionId);

    this.scheduleFrame(() => {
      this.pendingFrames.delete(regionId);
      this.#updateProgress(regionId);
    });
  }

  #updateProgress(regionId) {
    const progress = this.progress.get(regionId);
    const card = [...this.listElement
      .querySelectorAll('[data-region-id]')]
      .find(element =>
        element.dataset.regionId === regionId
      );

    if (!progress || !card) {
      return;
    }

    const percent = progressPercent(progress);
    const bar = card.querySelector(
      '[data-region-progress-bar]'
    );
    const copy = card.querySelector(
      '[data-region-progress-copy]'
    );

    if (bar) {
      bar.style.width = `${percent}%`;
      bar.closest('[role="progressbar"]')
        ?.setAttribute(
          'aria-valuenow',
          String(percent)
        );
    }

    if (copy) {
      copy.textContent =
        progressCopy(progress);
    }
  }

  #isVisible() {
    const panel = this.listElement.closest(
      '[data-panel-view="regions"]'
    );

    return panel ? !panel.hidden : true;
  }
}

function storageSummary(storage, updateCount = 0) {
  const used = formatBytes(
    storage.downloadedBytes
  );

  const available =
    storage.availableBytes === null
      ? 'Browser-managed storage'
      : `${formatBytes(storage.availableBytes)} free`;

  return `
    <section class="region-storage-summary" aria-label="Offline storage summary">
      <div class="region-storage-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M4 6h16v12H4z"></path>
          <path d="M8 14h8"></path>
          <circle cx="8" cy="10" r="1"></circle>
        </svg>
      </div>

      <div>
        <small>Offline storage</small>
        <strong>${used} downloaded</strong>
        <span>${escapeHtml(available)} · ${storage.installedCount} ${storage.installedCount === 1 ? 'download' : 'downloads'}${updateCount ? ` · ${updateCount} update${updateCount === 1 ? '' : 's'}` : ''}</span>
      </div>
    </section>
  `;
}

function regionCard(
  region,
  progress,
  error,
  confirmingRemove
) {
  const state = regionState(region);
  const components = regionComponents(region);
  const version = escapeHtml(
    String(region.version ?? 1)
  );
  const expectedSize =
    positiveOrNull(region.sizeBytes);
  const installedSize =
    positiveOrNull(
      region.installedSizeBytes
    );
  const sizeCopy = installedSize
    ? formatBytes(installedSize)
    : expectedSize
    ? formatBytes(expectedSize)
    : 'Size calculated during download';

  return `
    <article
      class="region-manager-card ${progress ? 'is-downloading' : ''}"
      data-region-id="${escapeHtml(region.id)}"
    >
      <header class="region-manager-card-header">
        <div class="region-manager-card-title">
          <div>
            <strong>${escapeHtml(region.name)}</strong>
            <span>${escapeHtml(region.country)}</span>
          </div>

          ${region.nearCurrentLocation
            ? '<em>Near you</em>'
            : ''}
        </div>

        <span class="region-state region-state--${state.tone}">
          ${escapeHtml(state.label)}
        </span>
      </header>

      <div class="region-package-meta">
        <span>Package v${version}</span>
        <span aria-hidden="true">·</span>
        <span>${sizeCopy}</span>
      </div>

      <div class="region-components" aria-label="Included offline data">
        ${components.map(component => `
          <span>
            ${componentIcon(component.id)}
            ${escapeHtml(component.label)}
          </span>
        `).join('')}
      </div>

      ${progress
        ? progressMarkup(progress)
        : ''}

      ${error
        ? `<p class="region-error" role="alert">${escapeHtml(error)}</p>`
        : ''}

      ${confirmingRemove
        ? removeConfirmation(region)
        : regionActions(region, Boolean(error), Boolean(progress))}
    </article>
  `;
}

function regionActions(region, retry, downloading) {
  if (downloading) {
    return `
      <div class="region-card-actions">
        <button
          class="region-secondary-action"
          type="button"
          data-region-action="cancel-download"
        >Cancel</button>
      </div>
    `;
  }

  if (region.included) {
    return `
      <div class="region-card-actions">
        <button class="region-secondary-action" type="button" disabled>Included with Atlas</button>
      </div>
    `;
  }

  if (region.updateAvailable) {
    return `
      <div class="region-card-actions">
        <button class="region-secondary-action" type="button" data-region-action="confirm-remove">Remove</button>
        <button class="region-primary-action" type="button" data-region-action="update">Update</button>
      </div>
    `;
  }

  if (region.installed) {
    return `
      <div class="region-card-actions">
        <button class="region-secondary-action region-danger-action" type="button" data-region-action="confirm-remove">Remove download</button>
      </div>
    `;
  }

  return `
    <div class="region-card-actions">
      <button class="region-primary-action" type="button" data-region-action="${retry ? 'retry' : 'download'}">
        ${retry ? 'Retry download' : 'Download region'}
      </button>
    </div>
  `;
}

function removeConfirmation(region) {
  return `
    <div class="region-remove-confirmation">
      <div>
        <strong>Remove ${escapeHtml(region.name)}?</strong>
        <span>Saved trips and bookmarks will stay.</span>
      </div>

      <div>
        <button type="button" data-region-action="cancel-remove">Keep</button>
        <button class="is-danger" type="button" data-region-action="remove">Remove</button>
      </div>
    </div>
  `;
}

function progressMarkup(progress) {
  const percent = progressPercent(progress);

  return `
    <div class="region-download-progress">
      <div
        class="region-progress-track"
        role="progressbar"
        aria-label="Region download progress"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="${percent}"
      >
        <span
          data-region-progress-bar
          style="width:${percent}%"
        ></span>
      </div>

      <small data-region-progress-copy>
        ${escapeHtml(progressCopy(progress))}
      </small>
    </div>
  `;
}

function progressCopy(progress) {
  const downloaded =
    formatBytes(progress.downloadedBytes ?? 0);

  if (progress.totalBytes > 0) {
    return `${downloaded} of ${formatBytes(progress.totalBytes)}`;
  }

  if (progress.totalFiles > 0) {
    return `${downloaded} · ${progress.completedFiles} of ${progress.totalFiles} files`;
  }

  return 'Preparing download…';
}

function progressPercent(progress) {
  if (progress.totalBytes > 0) {
    return clampPercent(
      progress.downloadedBytes /
      progress.totalBytes * 100
    );
  }

  if (progress.totalFiles > 0) {
    return clampPercent(
      progress.completedFiles /
      progress.totalFiles * 100
    );
  }

  return progress.phase === 'complete'
    ? 100
    : 3;
}

function regionState(region) {
  if (region.included) {
    return {
      label: 'Included',
      tone: 'included'
    };
  }

  if (region.updateAvailable) {
    return {
      label: 'Update available',
      tone: 'update'
    };
  }

  if (region.installed) {
    return {
      label: 'Downloaded',
      tone: 'installed'
    };
  }

  return {
    label: 'Available',
    tone: 'available'
  };
}

function regionComponents(region) {
  const assets = region.assets ?? {};
  const components = [];

  if (assets.map) {
    components.push({
      id: 'map',
      label: 'Offline map'
    });
  }

  if (assets.pois || assets.index) {
    components.push({
      id: 'places',
      label: 'Places'
    });
  }

  if (assets.routing) {
    components.push({
      id: 'navigation',
      label: 'Navigation'
    });
  }

  return components;
}

function componentIcon(id) {
  if (id === 'map') {
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m2 4 4-2 4 2 4-2v10l-4 2-4-2-4 2Z"></path><path d="M6 2v10M10 4v10"></path></svg>';
  }

  if (id === 'places') {
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14s4-3.5 4-7a4 4 0 1 0-8 0c0 3.5 4 7 4 7Z"></path><circle cx="8" cy="7" r="1.3"></circle></svg>';
  }

  return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m8 2 4.5 12L8 11.5 3.5 14Z"></path></svg>';
}

function regionCenter(region) {
  const areas = Array.isArray(region.areas) && region.areas.length
    ? region.areas
    : region.bounds
      ? [{ bounds: region.bounds }]
      : [];

  const bounds = areas[0]?.bounds ?? areas[0];
  if (!Array.isArray(bounds) || bounds.length < 4) return null;

  const [west, south, east, north] = bounds.map(Number);
  if (![west, south, east, north].every(Number.isFinite)) return null;

  return {
    lat: (south + north) / 2,
    lon: (west + east) / 2
  };
}

function regionCoverageCopy(region) {
  const areas = Array.isArray(region.areas) ? region.areas.length : 1;
  return areas > 1
    ? `${areas} coverage areas`
    : 'Regional coverage';
}

function emptyState() {
  return `
    <div class="regions-empty">
      <strong>No regions published yet</strong>
      <span>New offline packages will appear here.</span>
    </div>
  `;
}

export function formatBytes(value) {
  const bytes = Number(value) || 0;

  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = bytes;
  let unit = -1;

  do {
    amount /= 1024;
    unit += 1;
  } while (
    amount >= 1024 &&
    unit < units.length - 1
  );

  const digits = amount >= 100
    ? 0
    : amount >= 10
    ? 1
    : 2;

  return `${amount.toFixed(digits)} ${units[unit]}`;
}

function positiveOrNull(value) {
  return Number.isFinite(value) && value > 0
    ? value
    : null;
}

function clampPercent(value) {
  return Math.max(
    0,
    Math.min(100, Math.round(value))
  );
}
