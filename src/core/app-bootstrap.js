import {
  renderAppShell
} from '../ui/app-shell.js';
import {
  StatusController
} from '../ui/status-controller.js';
import {
  PanelController
} from '../ui/panel-controller.js';
import {
  MapContextController
} from '../ui/map-context-controller.js';
import {
  DraggableBottomSheet
} from '../ui/draggable-bottom-sheet.js';
import '../ui/draggable-bottom-sheet.css';

import {
  AppContext
} from './app-context.js';

import {
  PluginManager
} from './plugin-manager.js';

import {
  NearbyPlugin
} from '../features/nearby/nearby-plugin.js';

import {
  BookmarksPlugin
} from '../features/bookmarks/bookmarks-plugin.js';

import {
  NavigationPlugin
} from '../features/navigation/navigation-plugin.js';

import {
  TripPlugin
} from '../features/trip/trip-plugin.js';

import {
  TripLoader
} from '../features/trip/trip-loader.js';

import {
  FollowModeController
} from '../features/follow/follow-mode-controller.js';


import { MapController, LeafletMapAdapter } from '../map.js';
import {
  GpsController
} from '../gps.js';

export class AppBootstrap {
  constructor(root) {
    if (!root) {
      throw new TypeError(
        'AppBootstrap requires a root element.'
      );
    }

    this.root = root;
  }

  async start() {
    const root = this.root;
  renderAppShell(root);

  const bottomSheet = root.querySelector('#bottomSheet');

  const panelController = new PanelController({
    sheet: bottomSheet
  });
  const statusController =
    new StatusController({
      element: root.querySelector('#status'),
      hideAfterMs: 2500
    });

  const status = (title, subtitle = '') => {
    statusController.show(title, subtitle);
  };

  let draggableSheet = null;

  const expandSheet = () => {
    panelController.expand();
  };
  const mapAdapter = new LeafletMapAdapter({
    elementId: 'map',
    offlineMapUrl:
      `${import.meta.env.BASE_URL}regions/london/map.pmtiles`,
    preferOffline: false
  });

  const map = new MapController({
    adapter: mapAdapter
  });

  const mapContext = new MapContextController({
    titleElement:
      root.querySelector('#map-context-title'),
    subtitleElement:
      root.querySelector('#map-context-subtitle')
  });

  const followMode = new FollowModeController({
    map,
    mapContext,
    followButton:
      root.querySelector('#followBtn'),
    recenterButton:
      root.querySelector('#recenterBtn'),
    status
  });

  const searchAreaButton =
    root.querySelector('#searchAreaBtn');

  let mapCenterAnchor = null;
  let searchAreaTimer = null;


  map.onMoveEnd(({ lat, lon, zoom }) => {
    mapCenterAnchor = {
      lat,
      lon,
      name: 'this map area'
    };

    followMode.updateMapCenter({
      lat,
      lon,
      zoom
    });

    if (followMode.isFollowing()) {
      return;
    }

    searchAreaButton.hidden = true;

    window.clearTimeout(searchAreaTimer);

    searchAreaTimer = window.setTimeout(() => {
      searchAreaButton.hidden = false;
    }, 500);
  });

  searchAreaButton.addEventListener('click', async () => {
    if (!mapCenterAnchor) {
      return;
    }

    expandSheet();
    searchAreaButton.hidden = true;

    await nearbyFeature.search(mapCenterAnchor);
  });
  const appState = {
    userPosition: null
  };


  const appContext = new AppContext({
    root,
    map,
    panelController,
    mapContext,
    statusController,
    status
  });

  const pluginManager = new PluginManager({
    context: appContext
  });

  this.appContext = appContext;
  this.pluginManager = pluginManager;

  pluginManager.register(
    new NearbyPlugin()
  );

    pluginManager.register(
      new NavigationPlugin()
    );

    pluginManager.register(
      new BookmarksPlugin({
        onNavigate: destination => {
          if (!appState.userPosition) {
            status(
              'Navigation unavailable',
              'Enable GPS and wait for a location fix.'
            );

            return;
          }

          appContext
            .get('navigationFeature')
            .start({
              origin: appState.userPosition,
              destination
            });
        }
      })
    );

  pluginManager.register(
    new TripPlugin({
        data: null,
      initialDay: '12',
      snap: 'half',
      onPlaceSelected: place => {
        appContext
          .get('nearbyFeature')
          .search(place);
      }
    })
  );

  await pluginManager.start();

  const nearbyFeature =
    appContext.get('nearbyFeature');

    const bookmarksFeature =
      appContext.get('bookmarksFeature');

    let bookmarkPickMode = false;
    let pendingBookmarkLocation = null;

  const tripFeature =
    appContext.get('tripFeature');

    const tripLoader = new TripLoader();

    const loadTripButton =
      root.querySelector('#loadTripBtn');

    const tripFileInput =
      root.querySelector('#tripFileInput');

  const gps = new GpsController({
    onStatus: status,
    onUpdate: position => {
      const firstFix = !appState.userPosition;
      appState.userPosition = {
        name: 'My location',
        lat: position.latitude,
        lon: position.longitude,
        heading: position.heading,
        speed: position.speed
      };

      map.updateUserLocation(position, firstFix);
      followMode.updatePosition(position);

      status(
        '📍 You are here',
        `Accuracy: ${Math.round(position.accuracy)} m`
      );
    }
  });
loadTripButton?.addEventListener(
      'click',
      () => {
        tripFileInput?.click();
      }
    );

    tripFileInput?.addEventListener(
      'change',
      async event => {
        const file =
          event.currentTarget.files?.[0];

        if (!file) {
          return;
        }

        try {
          const tripData =
            await tripLoader.loadFromFile(file);

          const firstDay =
            Object.keys(
              tripData.trip?.days ?? {}
            )[0] ?? '1';

          tripFeature.load(tripData, {
            initialDay: firstDay,
            snap: 'half'
          });

          status(
            'Trip loaded',
            file.name
          );
        } catch (error) {
          console.error(error);

          status(
            'Could not load trip',
            error.message
          );
        } finally {
          event.currentTarget.value = '';
        }
      }
    );
    const saveBookmarkButton =
      root.querySelector('#saveBookmarkBtn');

    const showBookmarksButton =
      root.querySelector('#showBookmarksBtn');

    saveBookmarkButton?.addEventListener(
      'click',
      () => {
        bookmarkPickMode = true;

        status(
          'Choose bookmark location',
          'Tap anywhere on the map.'
        );
      }
    );

    showBookmarksButton?.addEventListener(
      'click',
      () => {
        bookmarksFeature.show();
      }
    );
    const bookmarkConfirmBar =
    root.querySelector('#bookmarkConfirmBar');

  const confirmBookmarkButton =
    root.querySelector('#confirmBookmarkBtn');

  const cancelBookmarkButton =
    root.querySelector('#cancelBookmarkBtn');

  map.onMapClick(({ lat, lon }) => {
    if (!bookmarkPickMode) {
      return;
    }

    pendingBookmarkLocation = {
      lat,
      lon
    };

    map.showSelectionPin(lat, lon);
    bookmarkConfirmBar.hidden = false;

    status(
      'Bookmark location selected',
      'Save it, cancel, or tap another point.'
    );
  });

  confirmBookmarkButton?.addEventListener(
    'click',
    () => {
      if (!pendingBookmarkLocation) {
        return;
      }

      const bookmarkNumber =
        bookmarksFeature.bookmarks.length + 1;

      bookmarksFeature.add({
        name: `Bookmark ${bookmarkNumber}`,
        lat: pendingBookmarkLocation.lat,
        lon: pendingBookmarkLocation.lon
      });

      pendingBookmarkLocation = null;
      bookmarkPickMode = false;
      bookmarkConfirmBar.hidden = true;

      map.clearSelectionPin();
    }
  );

  cancelBookmarkButton?.addEventListener(
    'click',
    () => {
      pendingBookmarkLocation = null;
      bookmarkPickMode = false;
      bookmarkConfirmBar.hidden = true;

      map.clearSelectionPin();

      status(
        'Bookmark cancelled',
        ''
      );
    }
  );

  draggableSheet = new DraggableBottomSheet({
    sheet: bottomSheet,
    handle: root.querySelector('#sheetToggle'),
    initialSnap: 'half',
    onSettled: () => {
      window.setTimeout(
        () => map.invalidateSize(),
        300
      );
    }
  });

  panelController.attachDraggableSheet(
    draggableSheet
  );


  root.querySelector('#nearBtn').addEventListener('click', () => {
    expandSheet();
    if (tripFeature.selected) nearbyFeature.search(tripFeature.selected);
    else if (appState.userPosition) nearbyFeature.search(appState.userPosition);
    else status('Nearby unavailable', 'Select a stop or enable GPS first.');
  });


  root.querySelector('#gpsBtn').addEventListener('click', event => {
    if (gps.enabled) {
      gps.stop();
      event.currentTarget.classList.remove('on');
      event.currentTarget.textContent='📍';
      status('GPS disabled','Your location is no longer being tracked.');
    } else {
      gps.start();
      event.currentTarget.classList.add('on');
      event.currentTarget.textContent='●';
    }
  });




  return {
    map,
    panelController,
    tripFeature,
    nearbyFeature,
    statusController,
    gps
  };
  }

  async destroy() {
    await this.pluginManager?.stop();
    this.appContext?.clear();

    this.pluginManager = null;
    this.appContext = null;
  }
}
