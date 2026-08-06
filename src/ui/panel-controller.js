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
  }

  attachDraggableSheet(draggableSheet) {
    this.draggableSheet = draggableSheet;
  }

  show(panelName, { snap = 'half' } = {}) {
    if (!panelName) {
      throw new TypeError(
        'PanelController.show requires a panel name.'
      );
    }

    this.activePanel = panelName;
    this.sheet.hidden = false;
    this.sheet.dataset.panel = panelName;

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

  hide() {
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
}
