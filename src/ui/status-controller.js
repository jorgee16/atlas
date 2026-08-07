export class StatusController {
  constructor({
    element,
    hideAfterMs = 2500
  }) {
    if (!element) {
      throw new TypeError(
        'StatusController requires a status element.'
      );
    }

    this.element = element;
    this.hideAfterMs = hideAfterMs;
    this.timer = null;

    this.titleElement =
      element.querySelector('b');

    this.subtitleElement =
      element.querySelector('span');

    if (
      !this.titleElement ||
      !this.subtitleElement
    ) {
      throw new TypeError(
        'Status element requires <b> and <span> children.'
      );
    }
  }

  show(title, subtitle = '') {
    this.titleElement.textContent = title;
    this.subtitleElement.textContent = subtitle;

    this.element.classList.add('visible');

    window.clearTimeout(this.timer);

    this.timer = window.setTimeout(
      () => this.hide(),
      this.hideAfterMs
    );
  }

  hide() {
    window.clearTimeout(this.timer);
    this.timer = null;

    this.element.classList.remove('visible');
  }

  destroy() {
    this.hide();
  }
}
