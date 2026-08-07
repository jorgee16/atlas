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

    if (
      this.activePanel &&
      this.activePanel !== name
    ) {
      this.modes
        .get(this.activePanel)
        ?.leave?.();
    }

    this.activePanel = name;
    this.sheet.hidden = false;
    this.sheet.dataset.panel = name;

    this.modes.get(name)?.enter?.();

    this.#applySnap(snap);
  }

  show(name, options = {}) {
    this.showMode(name, options);
  }

  hide() {
    if (this.activePanel) {
      this.modes
        .get(this.activePanel)
        ?.leave?.();
    }

    this.activePanel = null;
    this.sheet.dataset.panel = '';
    this.sheet.hidden = true;
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

      default:
        this.draggableSheet.half();
        break;
    }
  }
}
