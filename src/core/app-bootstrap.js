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

import {
  RegionManager
} from '../regions/region-manager.js';

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
    elementId: 'map'
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

  const tripFeature =
    appContext.get('tripFeature');

    const bookmarksFeature =
      appContext.get('bookmarksFeature');

    const panelToggleButton =
      root.querySelector('#panelToggleBtn');

    const syncPanelToggle = () => {
      if (!panelToggleButton) {
        return;
      }

      const hasMode =
        panelController.hasActiveMode();

      const visible =
        panelController.isVisible();

      panelToggleButton.disabled =
        !hasMode;

      panelToggleButton.classList.toggle(
        'on',
        hasMode && visible
      );

      panelToggleButton.setAttribute(
        'aria-pressed',
        String(hasMode && visible)
      );

      panelToggleButton.setAttribute(
        'aria-label',
        visible
          ? 'Hide panel'
          : 'Show panel'
      );

      panelToggleButton.title =
        visible
          ? 'Hide panel'
          : 'Show panel';
    };

    panelToggleButton?.addEventListener(
      'click',
      () => {
        panelController.togglePanel({
          snap: 'half'
        });
      }
    );

    bottomSheet.addEventListener(
      'panelvisibilitychange',
      syncPanelToggle
    );



    panelController.registerMode('explore', {
      enter: () => {
        if (backToTripButton) {
          backToTripButton.hidden =
            !tripFeature.isLoaded();
        }

        nearbyFeature.render();
      },

      leave: () => {
        if (backToTripButton) {
          backToTripButton.hidden = true;
        }
      }
    });

    panelController.registerMode('trip', {
      enter: () => {
        tripFeature.renderView();
      }
    });

    panelController.registerMode('bookmarks', {
      enter: () => {
        bookmarksFeature.render();
      }
    });

    panelController.registerMode('regions', {
      enter: () => {
        renderRegions().catch(error => {
          console.error(error);

          status(
            'Regions unavailable',
            error.message
          );
        });
      }
    });

    panelController.registerMode('navigation', {
      enter: () => {
        appContext
          .get('navigationFeature')
          .render();
      }
    });

    let bookmarkPickMode = false;
    let pendingBookmarkLocation = null;

    const backToTripButton =
      root.querySelector('#backToTripBtn');

    backToTripButton?.addEventListener(
      'click',
      () => {
        tripFeature.show({
          snap: 'half'
        });
      }
    );

    const tripLoader = new TripLoader();

    const loadTripButton =
      root.querySelector('#loadTripBtn');

    const tripFileInput =
      root.querySelector('#tripFileInput');

    const moreButton =
      root.querySelector('#moreBtn');

    const overflowMenu =
      root.querySelector('#overflowMenu');

    const menuLoadTripButton =
      root.querySelector('#menuLoadTripBtn');

    const menuBookmarksButton =
      root.querySelector('#menuBookmarksBtn');

    const menuNavigationButton =
      root.querySelector('#menuNavigationBtn');

    const menuRegionsButton =
      root.querySelector('#menuRegionsBtn');

    const regionsContent =
      root.querySelector('#regionsContent');

    const renderRegions = async () => {
      const regions =
        await regionManager.listRegions();

      regionsContent.replaceChildren();

      regions.forEach(region => {
        const card =
          document.createElement('div');

        card.className = 'region-card';

        const state =
          region.bundled
            ? 'Included'
            : region.installed
            ? 'Installed'
            : 'Available';

        const copy =
          document.createElement('div');

        copy.className = 'region-card-copy';

        const name =
          document.createElement('strong');

        name.textContent = region.name;

        const details =
          document.createElement('small');

        details.textContent =
          `${region.country} · ${state}`;

        copy.append(name, details);
        card.appendChild(copy);

        const button =
          document.createElement('button');

        button.type = 'button';

        if (region.bundled) {
          button.textContent = 'Included';
          button.disabled = true;
        } else if (region.installed) {
          button.textContent = 'Installed';
          button.disabled = true;
        } else {
          button.textContent = 'Download';

          button.addEventListener(
            'click',
            async () => {
              button.disabled = true;
              button.textContent =
                'Downloading…';

              try {
                await regionManager
                  .downloadRegion(region);

                status(
                  `${region.name} installed`,
                  'Offline data is ready.'
                );

                await renderRegions();
              } catch (error) {
                console.error(error);

                button.disabled = false;
                button.textContent =
                  'Retry';

                status(
                  'Download failed',
                  error.message
                );
              }
            }
          );
        }

        card.appendChild(button);
        regionsContent.appendChild(card);
      });
    };

    const menuSettingsButton =
      root.querySelector('#menuSettingsBtn');

    const menuAboutButton =
      root.querySelector('#menuAboutBtn');

  const regionManager =
    new RegionManager({
      status,
      onDownloadRequired: region => {
        status(
          'Offline region available',
          `${region.name} can be downloaded.`
        );
      }
    });

  let activeRegionId = null;

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


      regionManager
        .ensureForPosition(
          appState.userPosition
        )
        .then(async region => {
          const nextRegionId =
            region?.id ?? null;

          if (nextRegionId === activeRegionId) {
            return;
          }

          activeRegionId = nextRegionId;

          await map.setRegion(region, {
            preferOffline: false
          });
        })
        .catch(error => {
          console.error(
            'Region detection failed:',
            error
          );
        });


      map.updateUserLocation(position, firstFix);
      followMode.updatePosition(position);

      appContext
        .get('navigationFeature')
        .updatePosition(appState.userPosition);

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
        panelBeforeBookmarkPick =
          panelController.getActivePanel();

        panelWasVisibleBeforeBookmarkPick =
          panelController.isVisible();

        showBookmarksList();

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


  const confirmBookmarkButton =
    root.querySelector('#confirmBookmarkBtn');

  const cancelBookmarkButton =
    root.querySelector('#cancelBookmarkBtn');

  const bookmarkEditor =
    root.querySelector('#bookmarkEditor');

  const bookmarksContent =
    root.querySelector('#bookmarksContent');

  const bookmarkNameInput =
    root.querySelector('#bookmarkNameInput');

  const bookmarkCoordinates =
    root.querySelector('#bookmarkCoordinates');

  let panelBeforeBookmarkPick = null;
  let panelWasVisibleBeforeBookmarkPick = false;

  const showBookmarkEditor = () => {
    bookmarkEditor.hidden = false;
    bookmarksContent.hidden = true;
  };

  const showBookmarksList = () => {
    bookmarkEditor.hidden = true;
    bookmarksContent.hidden = false;
  };

  const restorePanelAfterBookmark = () => {
    showBookmarksList();

    if (
      panelBeforeBookmarkPick &&
      panelBeforeBookmarkPick !== 'bookmarks'
    ) {
      panelController.showMode(
        panelBeforeBookmarkPick,
        { snap: 'half' }
      );
    } else if (
      panelBeforeBookmarkPick === 'bookmarks'
    ) {
      bookmarksFeature.show();
    } else if (!panelWasVisibleBeforeBookmarkPick) {
      panelController.hidePanel();
    }

    panelBeforeBookmarkPick = null;
    panelWasVisibleBeforeBookmarkPick = false;
  };


  map.onMapClick(({ lat, lon }) => {
    if (!bookmarkPickMode) {
      return;
    }

    pendingBookmarkLocation = {
      lat,
      lon
    };

    map.showSelectionPin(lat, lon);

    bookmarkCoordinates.textContent =
      `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

    panelController.showMode(
      'bookmarks',
      { snap: 'fit' }
    );

    showBookmarkEditor();

    status(
      'Bookmark location selected',
      'Save it or tap another point.'
    );
  });

  confirmBookmarkButton?.addEventListener(
    'click',
    () => {
      if (!pendingBookmarkLocation) {
        return;
      }

      const typedName =
        bookmarkNameInput.value.trim();

      const bookmarkNumber =
        bookmarksFeature.bookmarks.length + 1;

      const name =
        typedName ||
        `Bookmark ${bookmarkNumber}`;

      bookmarksFeature.add({
        name,
        lat: pendingBookmarkLocation.lat,
        lon: pendingBookmarkLocation.lon
      });

      pendingBookmarkLocation = null;
      bookmarkPickMode = false;

      bookmarkNameInput.value = '';
      bookmarkCoordinates.textContent = '—';

      map.clearSelectionPin();

      restorePanelAfterBookmark();
    }
  );

  cancelBookmarkButton?.addEventListener(
    'click',
    () => {
      pendingBookmarkLocation = null;
      bookmarkPickMode = false;

      bookmarkNameInput.value = '';
      bookmarkCoordinates.textContent = '—';

      map.clearSelectionPin();

      restorePanelAfterBookmark();

      status(
        'Bookmark cancelled',
        ''
      );
    }
  );

    const closeOverflowMenu = () => {
      if (overflowMenu) {
        overflowMenu.hidden = true;
      }
    };

    moreButton?.addEventListener(
      'click',
      event => {
        event.stopPropagation();

        if (overflowMenu) {
          overflowMenu.hidden =
            !overflowMenu.hidden;
        }
      }
    );

    menuLoadTripButton?.addEventListener(
      'click',
      () => {
        closeOverflowMenu();
        tripFileInput?.click();
      }
    );

    menuBookmarksButton?.addEventListener(
      'click',
      () => {
        closeOverflowMenu();
        showBookmarksList();
        bookmarksFeature.show();
      }
    );

    menuNavigationButton?.addEventListener(
      'click',
      () => {
        closeOverflowMenu();

        const navigationFeature =
          appContext.get('navigationFeature');

        if (!navigationFeature.isActive()) {
          status(
            'No active navigation',
            'Open Bookmarks and select Navigate.'
          );

          return;
        }

        panelController.showMode(
          'navigation',
          { snap: 'half' }
        );
      }
    );

    menuRegionsButton?.addEventListener(
      'click',
      () => {
        closeOverflowMenu();

        panelController.showMode(
          'regions',
          { snap: 'half' }
        );
      }
    );

    menuSettingsButton?.addEventListener(
      'click',
      () => {
        closeOverflowMenu();

        status(
          'Settings',
          'Settings are coming soon.'
        );
      }
    );

    menuAboutButton?.addEventListener(
      'click',
      () => {
        closeOverflowMenu();

        status(
          'Roam',
          'Your map, trips and saved places.'
        );
      }
    );

    document.addEventListener(
      'click',
      event => {
        if (
          overflowMenu &&
          !overflowMenu.hidden &&
          !overflowMenu.contains(event.target) &&
          !moreButton?.contains(event.target)
        ) {
          closeOverflowMenu();
        }
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
    gps,
    regionManager
  };
  }

  async destroy() {
    await this.pluginManager?.stop();
    this.appContext?.clear();

    this.pluginManager = null;
    this.appContext = null;
  }
}
