export class PanelController {
  constructor({ sheet }) {
    if (!sheet) {
      throw new TypeError(
        'PanelController requires a sheet element.'
      );
    }

    this.sheet = sheet;
    this.draggableSheet = null;

    this.activePanel = null;
    this.modes = new Map();

    this.views = new Map(
      [...this.sheet.querySelectorAll(
        '[data-panel-view]'
      )].map(view => [
        view.dataset.panelView,
        view
      ])
    );
  }

  attachDraggableSheet(draggableSheet) {
    this.draggableSheet = draggableSheet;
  }

  registerMode(name, {
    enter = null,
    leave = null
  } = {}) {
    if (!name) {
      throw new TypeError(
        'PanelController.registerMode requires a name.'
      );
    }

    this.modes.set(name, {
      enter,
      leave
    });
  }

  showMode(name, {
    snap = 'half'
  } = {}) {
    if (!name) {
      throw new TypeError(
        'PanelController.showMode requires a mode name.'
      );
    }

    const view = this.views.get(name);

    if (!view) {
      throw new Error(
        `PanelController has no view registered for "${name}".`
      );
    }

    if (
      this.activePanel &&
      this.activePanel !== name
    ) {
      this.modes
        .get(this.activePanel)
        ?.leave?.();
    }

    this.views.forEach(
      (panelView, panelName) => {
        const active =
          panelName === name;

        panelView.hidden = !active;

        panelView.classList.toggle(
          'active',
          active
        );
      }
    );

    this.activePanel = name;
    this.sheet.dataset.panel = name;

    this.modes.get(name)?.enter?.();

    this.showPanel({ snap });
  }

  show(name, options = {}) {
    this.showMode(name, options);
  }

  showPanel({
    snap = 'half'
  } = {}) {
    if (!this.activePanel) {
      return false;
    }

    const view =
      this.views.get(this.activePanel);

    if (!view) {
      return false;
    }

    view.hidden = false;
    view.classList.add('active');

    this.sheet.hidden = false;

    this.#applySnap(snap);
    this.#emitVisibility();

    return true;
  }

  hidePanel() {
    if (!this.activePanel) {
      return false;
    }

    this.sheet.hidden = true;

    this.#emitVisibility();

    return true;
  }

  togglePanel({
    snap = 'half'
  } = {}) {
    if (this.isVisible()) {
      this.hidePanel();
      return false;
    }

    this.showPanel({ snap });
    return true;
  }

  hide() {
    if (this.activePanel) {
      this.modes
        .get(this.activePanel)
        ?.leave?.();
    }

    this.views.forEach(view => {
      view.hidden = true;
      view.classList.remove('active');
    });

    this.activePanel = null;
    this.sheet.dataset.panel = '';
    this.sheet.hidden = true;

    this.#emitVisibility();
  }

  expand() {
    this.draggableSheet?.expand();
  }

  half() {
    this.draggableSheet?.half();
  }

  collapse() {
    this.draggableSheet?.collapse();
  }

  isVisible() {
    return !this.sheet.hidden;
  }

  hasActiveMode() {
    return Boolean(this.activePanel);
  }

  getActivePanel() {
    return this.activePanel;
  }

  #applySnap(snap) {
    if (!this.draggableSheet) {
      return;
    }

    switch (snap) {
      case 'expanded':
        this.draggableSheet.expand();
        break;

      case 'collapsed':
        this.draggableSheet.collapse();
        break;

      case 'compact':
        this.draggableSheet.compact();
        break;

      case 'fit':
        requestAnimationFrame(() => {
          this.draggableSheet.fit();
        });
        break;

      default:
        this.draggableSheet.half();
        break;
    }
  }

  #emitVisibility() {
    this.sheet.dispatchEvent(
      new CustomEvent(
        'panelvisibilitychange',
        {
          detail: {
            visible: this.isVisible(),
            mode: this.activePanel
          }
        }
      )
    );
  }
}
