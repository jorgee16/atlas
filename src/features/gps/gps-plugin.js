import {
  GpsController
} from '../../gps.js';

export class GpsPlugin {
  constructor({
    onUpdate = () => {},
    onStatus = null
  } = {}) {
    this.id = 'gps';
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
    this.controller = null;
    this.button = null;
  }

  start(context) {
    this.button =
      context.root.querySelector('#gpsBtn');

    this.controller = new GpsController({
      onStatus:
        this.onStatus ?? context.status,
      onUpdate: this.onUpdate
    });

    this.button?.addEventListener(
      'click',
      this.handleButtonClick
    );

    context.provide(
      'gpsController',
      this.controller
    );
  }

  stop(context) {
    this.controller?.stop();

    this.button?.removeEventListener(
      'click',
      this.handleButtonClick
    );

    this.button?.classList.remove('on');

    if (this.button) {
      this.button.textContent = '📍';
    }

    this.controller = null;
    this.button = null;

    context.remove('gpsController');
  }

  handleButtonClick = event => {
    if (!this.controller) {
      return;
    }

    if (this.controller.enabled) {
      this.controller.stop();

      event.currentTarget.classList.remove('on');
      event.currentTarget.textContent = '📍';

      this.onStatus?.(
        'GPS disabled',
        'Your location is no longer being tracked.'
      );

      return;
    }

    this.controller.start();

    event.currentTarget.classList.add('on');
    event.currentTarget.textContent = '●';
  };
}
