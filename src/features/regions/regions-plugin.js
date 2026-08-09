import {
  Capacitor
} from '@capacitor/core';

import {
  RegionManager
} from '../../regions/region-manager.js';

import {
  RegionDownloader
} from '../../regions/region-downloader.js';

import {
  RegionsFeature
} from './regions-feature.js';

export class RegionsPlugin {
  constructor({
    manager = null
  } = {}) {
    this.id = 'regions';
    this.manager = manager;
    this.feature = null;
  }

  start(context) {
    if (!this.manager) {
      const downloader = new RegionDownloader({
        origin: Capacitor.isNativePlatform()
          ? 'https://pub-75539028275a4826aa383fdb89292ed7.r2.dev'
          : globalThis.location?.origin
      });

      this.manager = new RegionManager({
        downloader,
        status: context.status,
        map: context.map
      });
    }

    this.feature = new RegionsFeature({
      manager: this.manager,
      panelController:
        context.panelController,
      listElement:
        context.root.querySelector(
          '#regionsOverlayContent'
        ) ?? context.root.querySelector(
          '#regionsContent'
        ),
      status: context.status,
      map: context.map
    });

    context.provide(
      'regionManager',
      this.manager
    );

    context.provide(
      'regionsFeature',
      this.feature
    );
  }

  stop(context) {
    this.feature?.destroy();
    this.feature = null;

    context.remove('regionsFeature');
    context.remove('regionManager');
  }
}
