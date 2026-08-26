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
  MapSelectionPlugin
} from '../features/map-selection/map-selection-plugin.js';

import {
  RegionsPlugin
} from '../features/regions/regions-plugin.js';

import {
  TripLoader
} from '../features/trip/trip-loader.js';

import {
  TripCatalog
} from '../features/trip/trip-catalog.js';
import {
  TripStore
} from '../features/trip/trip-store.js';

import {
  FollowModeController
} from '../features/follow/follow-mode-controller.js';


import {
  TransitJourneyBridge
} from '../transit/transit-journey-bridge.js';

import {
  TfLJourneyProvider
} from '../transit/providers/tfl-journey-provider.js';

import {
  TransitProviderRegistry
} from '../transit/transit-provider-registry.js';


import { MapController, LeafletMapAdapter } from '../map.js';
import {
  GpsController
} from '../gps.js';

import {
  AppearancePreference
} from '../settings/appearance-preference.js';

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

  const appearancePreference =
    new AppearancePreference();

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
    compassButton:
      root.querySelector('#compassBtn'),
    status
  });

  const searchAreaButton =
    root.querySelector('#searchAreaBtn');

  let mapCenterAnchor = null;
  let searchAreaTimer = null;

  const searchAreaWorkspaces = Array.from(
    root.querySelectorAll(
      '.explore-workspace, .trip-workspace, .navigation-workspace'
    )
  );

  const positionSearchAreaButton = () => {
    const workspace = searchAreaWorkspaces.find((element) => {
      if (element.hidden) {
        return false;
      }

      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

    if (!workspace) {
      searchAreaButton.style.removeProperty('--search-area-bottom');
      return;
    }

    const workspaceTop = workspace.getBoundingClientRect().top;
    const gap = 14;
    const minimumBottom = 88;
    const bottom = Math.max(
      minimumBottom,
      window.innerHeight - workspaceTop + gap
    );

    searchAreaButton.style.setProperty(
      '--search-area-bottom',
      `${Math.round(bottom)}px`
    );
  };

  const searchAreaResizeObserver = new ResizeObserver(() => {
    positionSearchAreaButton();
  });

  searchAreaWorkspaces.forEach((workspace) => {
    searchAreaResizeObserver.observe(workspace);
  });

  window.addEventListener('resize', positionSearchAreaButton);

  // Android soft keyboards shrink the visual viewport without always changing
  // the layout viewport. Expose that usable rectangle to CSS so landscape
  // navigation search can stay above the keyboard and keep results visible.
  const updateVisualViewport = () => {
    const viewport = window.visualViewport;
    const visualHeight = viewport?.height ?? window.innerHeight;
    const visualTop = viewport?.offsetTop ?? 0;
    const visualBottomInset = Math.max(
      0,
      window.innerHeight - visualTop - visualHeight
    );
    const keyboardLikelyOpen =
      window.matchMedia?.('(orientation: landscape)')?.matches &&
      visualBottomInset > 120;

    document.documentElement.style.setProperty(
      '--atlas-visual-height',
      `${Math.round(visualHeight)}px`
    );
    document.documentElement.style.setProperty(
      '--atlas-visual-top',
      `${Math.round(visualTop)}px`
    );
    document.documentElement.style.setProperty(
      '--atlas-visual-bottom-inset',
      `${Math.round(visualBottomInset)}px`
    );
    document.documentElement.classList.toggle(
      'atlas-keyboard-open',
      Boolean(keyboardLikelyOpen)
    );
  };

  updateVisualViewport();
  window.visualViewport?.addEventListener('resize', updateVisualViewport);
  window.visualViewport?.addEventListener('scroll', updateVisualViewport);
  window.addEventListener('resize', updateVisualViewport);

  // Leaflet needs a size refresh after the viewport changes orientation.
  // If navigation is following GPS, immediately restore the navigation camera
  // after the new portrait/landscape dimensions have settled.
  let orientationRefreshTimer = null;
  const refreshMapAfterOrientationChange = () => {
    if (orientationRefreshTimer !== null) {
      window.clearTimeout(orientationRefreshTimer);
    }

    orientationRefreshTimer = window.setTimeout(() => {
      orientationRefreshTimer = null;
      map.invalidateSize();
      positionSearchAreaButton();

      if (followMode.isFollowing()) {
        followMode.recenter();
      }
    }, 180);
  };

  window.addEventListener(
    'orientationchange',
    refreshMapAfterOrientationChange
  );

  globalThis.screen?.orientation?.addEventListener?.(
    'change',
    refreshMapAfterOrientationChange
  );


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
      positionSearchAreaButton();
      searchAreaButton.hidden = false;
    }, 500);
  });

  searchAreaButton.addEventListener('click', async () => {
    if (!mapCenterAnchor) {
      return;
    }

    selectAppTab('explore');
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

  appContext.provide(
    'followMode',
    followMode
  );

  const pluginManager = new PluginManager({
    context: appContext
  });

  this.appContext = appContext;
  this.pluginManager = pluginManager;

  const navigateTo = async destination => {
    if (!appState.userPosition) {
      status(
        'Navigation unavailable',
        'Enable GPS and wait for a location fix.'
      );

      return false;
    }

    return appContext
      .get('navigationFeature')
      .start({
        origin: appState.userPosition,
        destination
      });
  };

  pluginManager.register(
    new NearbyPlugin()
  );

  pluginManager.register(
    new RegionsPlugin()
  );

    const transitJourneyBridge = new TransitJourneyBridge({
      provider: new TfLJourneyProvider({
        appKey:
          import.meta.env.VITE_TFL_APP_KEY ??
          ''
      })
    });

    const transitProviderRegistry = new TransitProviderRegistry({
      catalogProvider: () => appContext.get('regionManager').catalog,
      providers: {
        london: {
          id: 'tfl',
          label: 'Public transport',
          bridge: transitJourneyBridge
        }
      }
    });

    appContext.provide('transitJourneyBridge', transitJourneyBridge);
    appContext.provide('transitProviderRegistry', transitProviderRegistry);

    pluginManager.register(
      new NavigationPlugin({
        transitProviderRegistry,
        onBookmarkDestination: destination =>
          beginBookmarkFromSelectedPoint(destination)
      })
    );

    pluginManager.register(
      new BookmarksPlugin({
        onNavigate: navigateTo
      })
    );

  pluginManager.register(
    new TripPlugin({
        data: null,
      initialDay: '12',
      snap: 'half',
      onPlaceSelected: place => {
        status(
          place.name ?? 'Trip stop',
          'Use Navigate to route to this stop.'
        );
      }
    })
  );

  pluginManager.register(
    new MapSelectionPlugin({
      onNavigate: navigateTo,
      onBookmark: point =>
        beginBookmarkFromSelectedPoint(
          point
        )
    })
  );

  await pluginManager.start();

  const nearbyFeature =
    appContext.get('nearbyFeature');

  const tripFeature =
    appContext.get('tripFeature');

    const regionsFeature =
      appContext.get('regionsFeature');

    const regionManager =
      appContext.get('regionManager');

    const bookmarksFeature =
      appContext.get('bookmarksFeature');

    const mapSelectionFeature =
      appContext.get(
        'mapSelectionFeature'
      );

    const navigationFeature =
      appContext.get('navigationFeature');

    navigationFeature.searchAnchorProvider = () =>
      mapCenterAnchor ?? appState.userPosition ?? null;

    const appTabs = root.querySelector('#appTabs');
    const exploreWorkspace = root.querySelector('#exploreWorkspace');
    const tripWorkspace = root.querySelector('#tripWorkspace');
    const navigationWorkspace = root.querySelector('#navigationWorkspace');
    const fullMapButton = root.querySelector('#fullMapBtn');
    const routePlannerButton = root.querySelector('#routePlannerBtn');
    const regionsOverlay = root.querySelector('#regionsOverlay');
    const closeRegionsButton = root.querySelector('#closeRegionsBtn');
    const settingsOverlay = root.querySelector('#settingsOverlay');
    const closeSettingsButton = root.querySelector('#closeSettingsBtn');
    const settingsVoiceButton = root.querySelector('#settingsVoiceBtn');
    const settingsHeadingButton = root.querySelector('#settingsHeadingBtn');
    const settingsLaneButton = root.querySelector('#settingsLaneBtn');
    const settingsRerouteButton = root.querySelector('#settingsRerouteBtn');
    const settingsRegionsButton = root.querySelector('#settingsRegionsBtn');
    const bookmarksOverlay = root.querySelector('#bookmarksOverlay');
    const closeBookmarksButton = root.querySelector('#closeBookmarksBtn');
    const bookmarkMapCard = root.querySelector('#bookmarkMapCard');
    const bookmarkMapName = root.querySelector('#bookmarkMapName');
    const bookmarkMapCoordinates = root.querySelector('#bookmarkMapCoordinates');
    const bookmarkMapNearbyButton = root.querySelector('#bookmarkMapNearbyBtn');
    const bookmarkMapNavigateButton = root.querySelector('#bookmarkMapNavigateBtn');
    const bookmarkMapRemoveButton = root.querySelector('#bookmarkMapRemoveBtn');
    const offlineRegionsButton = root.querySelector('#offlineRegionsBtn');
    let activeAppTab = 'explore';
    let tabBeforeRegions = 'explore';
    const workspaceChromeVisible = {
      explore: true,
      trip: true,
      navigation: true
    };

    const syncTabs = () => {
      for (const button of appTabs?.querySelectorAll('[data-app-tab]') ?? []) {
        const active = button.dataset.appTab === activeAppTab;
        button.classList.toggle('on', active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
    };

    const syncWorkspaceVisibility = () => {
      exploreWorkspace.hidden =
        activeAppTab !== 'explore' || !workspaceChromeVisible.explore;
      tripWorkspace.hidden =
        activeAppTab !== 'trip' || !workspaceChromeVisible.trip;
      navigationWorkspace.hidden =
        activeAppTab !== 'navigation' || !workspaceChromeVisible.navigation;

      const activeWorkspaceVisible =
        workspaceChromeVisible[activeAppTab] === true;
      if (fullMapButton) {
        fullMapButton.classList.toggle('on', !activeWorkspaceVisible);
        fullMapButton.setAttribute(
          'aria-label',
          activeWorkspaceVisible ? 'Show full map' : `Restore ${activeAppTab} controls`
        );
        fullMapButton.title =
          activeWorkspaceVisible ? 'Full map' : `Restore ${activeAppTab}`;
      }
    };

    const setWorkspaceChrome = (tab, visible) => {
      workspaceChromeVisible[tab] = visible;
      if (tab === activeAppTab) syncWorkspaceVisibility();
    };

    const selectAppTab = (tab, { reveal = false, revealExplore = false } = {}) => {
      activeAppTab = tab;
      if (bookmarkMapCard) bookmarkMapCard.hidden = true;
      syncTabs();
      panelController.hidePanel();

      if (reveal || revealExplore) {
        workspaceChromeVisible[tab] = true;
      }
      syncWorkspaceVisibility();

      if (tab === 'navigation') {
        navigationFeature.render();
        return;
      }

      if (tab === 'trip') {
        if (!tripFeature.isLoaded()) {
          setTripLibraryOpen(true);
        } else {
          tripFeature.renderView();
          if (tripLibraryOpen) setTripLibraryOpen(true);
        }
        return;
      }

      nearbyFeature.render();
    };

    routePlannerButton?.addEventListener('click', () => {
      if (navigationFeature.isActive()) {
        status(
          'Navigation active',
          'Stop guidance before planning a different route.'
        );
        return;
      }

      selectAppTab('navigation', { reveal: true });
      navigationFeature.openAdvancedPlanner({
        focus: navigationFeature.getPlannerState().destination
          ? 'origin'
          : 'destination'
      });
    });

    appTabs?.addEventListener('click', event => {
      const button = event.target.closest?.('[data-app-tab]');
      if (!button) return;

      const tab = button.dataset.appTab;
      const reveal =
        tab === activeAppTab && workspaceChromeVisible[tab] === false;
      selectAppTab(tab, { reveal });
    });

    const landscapeExploreSearch =
      root.querySelector('#landscapeExploreSearch');
    const landscapeExploreSearchInput =
      root.querySelector('#landscapeExploreSearchInput');
    const landscapeExploreSearchResults =
      root.querySelector('#landscapeExploreSearchResults');

    let landscapeExploreSearchTimer = null;
    let landscapeExploreSearchRequest = 0;
    let landscapeExploreResults = [];

    const clearLandscapeExploreResults = () => {
      landscapeExploreResults = [];
      landscapeExploreSearchResults?.replaceChildren();
      if (landscapeExploreSearchResults) {
        landscapeExploreSearchResults.hidden = true;
      }
    };

    const selectLandscapeExploreResult = result => {
      if (!result) return;

      clearLandscapeExploreResults();
      if (landscapeExploreSearchInput) {
        landscapeExploreSearchInput.value = result.name ?? '';
        landscapeExploreSearchInput.blur();
      }

      map.focus?.(result.lat, result.lon, 16);
      mapSelectionFeature.select({
        lat: result.lat,
        lon: result.lon,
        name: result.name ?? 'Selected place'
      });
    };

    const runLandscapeExploreSearch = async () => {
      const query = String(
        landscapeExploreSearchInput?.value ?? ''
      ).trim();

      if (query.length < 2) {
        clearLandscapeExploreResults();
        return;
      }

      const anchor =
        mapCenterAnchor ?? appState.userPosition ?? null;

      if (!anchor) {
        clearLandscapeExploreResults();
        status(
          'Search unavailable',
          'Move the map or enable GPS first.'
        );
        return;
      }

      const request = ++landscapeExploreSearchRequest;

      try {
        const results = await navigationFeature.destinationSearch(
          query,
          anchor,
          { limit: 6 }
        );

        if (request !== landscapeExploreSearchRequest) return;

        landscapeExploreResults = results;
        landscapeExploreSearchResults?.replaceChildren();

        if (!results.length) {
          if (landscapeExploreSearchResults) {
            const empty = document.createElement('div');
            empty.className = 'landscape-explore-search-empty';
            empty.textContent = 'No offline places found';
            landscapeExploreSearchResults.appendChild(empty);
            landscapeExploreSearchResults.hidden = false;
          }
          return;
        }

        for (const [index, result] of results.entries()) {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.exploreSearchResult = String(index);

          const name = document.createElement('strong');
          name.textContent = result.name ?? 'Place';

          const detail = document.createElement('small');
          detail.textContent =
            result.category ?? result.type ?? 'Offline place';

          button.append(name, detail);
          landscapeExploreSearchResults?.appendChild(button);
        }

        if (landscapeExploreSearchResults) {
          landscapeExploreSearchResults.hidden = false;
        }
      } catch (error) {
        if (request !== landscapeExploreSearchRequest) return;
        console.error(error);
        clearLandscapeExploreResults();
        status(
          'Search unavailable',
          error.message ?? 'Offline place search failed.'
        );
      }
    };

    landscapeExploreSearchInput?.addEventListener('input', () => {
      if (landscapeExploreSearchTimer !== null) {
        window.clearTimeout(landscapeExploreSearchTimer);
      }

      landscapeExploreSearchTimer = window.setTimeout(() => {
        landscapeExploreSearchTimer = null;
        void runLandscapeExploreSearch();
      }, 180);
    });

    landscapeExploreSearch?.addEventListener('submit', event => {
      event.preventDefault();
      if (landscapeExploreResults.length === 1) {
        selectLandscapeExploreResult(landscapeExploreResults[0]);
        return;
      }
      void runLandscapeExploreSearch();
    });

    landscapeExploreSearchResults?.addEventListener('click', event => {
      const button = event.target.closest?.('[data-explore-search-result]');
      if (!button) return;
      const result = landscapeExploreResults[
        Number(button.dataset.exploreSearchResult)
      ];
      selectLandscapeExploreResult(result);
    });

    document.addEventListener('pointerdown', event => {
      if (
        landscapeExploreSearch &&
        !landscapeExploreSearch.contains(event.target)
      ) {
        clearLandscapeExploreResults();
      }
    });

    fullMapButton?.addEventListener('click', () => {
      const visible = workspaceChromeVisible[activeAppTab] === true;
      setWorkspaceChrome(activeAppTab, !visible);
    });

    let selectedBookmarkOnMap = null;
    let tabsHiddenBeforeBookmarks = false;

    const showBookmarksOverlay = ({ editor = false } = {}) => {
      if (!bookmarksOverlay) return;
      if (bookmarksOverlay.hidden) {
        tabsHiddenBeforeBookmarks = appTabs?.hidden === true;
      }
      panelController.hidePanel();
      bookmarksFeature.render();
      bookmarksOverlay.hidden = false;
      appTabs.hidden = true;
      exploreWorkspace.hidden = true;
      tripWorkspace.hidden = true;
      navigationWorkspace.hidden = true;
      if (bookmarkMapCard) bookmarkMapCard.hidden = true;
      if (editor) showBookmarkEditor();
      else showBookmarksList();
    };

    const closeBookmarksOverlay = () => {
      if (!bookmarksOverlay || bookmarksOverlay.hidden) return;
      bookmarksOverlay.hidden = true;
      appTabs.hidden = tabsHiddenBeforeBookmarks;
      syncTabs();
      syncWorkspaceVisibility();
    };

    const showBookmarkOnMap = bookmark => {
      if (!bookmark) return;
      selectedBookmarkOnMap = bookmark;
      closeBookmarksOverlay();
      setWorkspaceChrome(activeAppTab, false);
      map.focus(bookmark.lat, bookmark.lon, 16);
      map.showSelectionPin(bookmark.lat, bookmark.lon);
      if (bookmarkMapName) bookmarkMapName.textContent = bookmark.name;
      if (bookmarkMapCoordinates) {
        bookmarkMapCoordinates.textContent = `${bookmark.lat.toFixed(5)}, ${bookmark.lon.toFixed(5)}`;
      }
      if (bookmarkMapCard) bookmarkMapCard.hidden = false;
    };

    bookmarksFeature.onShow = () => showBookmarksOverlay();
    bookmarksFeature.onFocus = showBookmarkOnMap;
    bookmarksFeature.onNavigate = bookmark => {
      closeBookmarksOverlay();
      navigationFeature.setPlannerDestination(bookmark);
      selectAppTab('navigation', { reveal: true });
    };
    closeBookmarksButton?.addEventListener('click', closeBookmarksOverlay);

    bookmarkMapNearbyButton?.addEventListener('click', () => {
      const bookmark = selectedBookmarkOnMap;
      if (!bookmark) return;
      if (bookmarkMapCard) bookmarkMapCard.hidden = true;
      selectAppTab('explore', { revealExplore: true });
      void nearbyFeature.search(bookmark);
    });

    bookmarkMapNavigateButton?.addEventListener('click', () => {
      const bookmark = selectedBookmarkOnMap;
      if (!bookmark) return;
      navigationFeature.setPlannerDestination(bookmark);
      selectAppTab('navigation', { reveal: true });
    });

    bookmarkMapRemoveButton?.addEventListener('click', () => {
      const bookmark = selectedBookmarkOnMap;
      if (!bookmark) return;
      bookmarksFeature.remove(bookmark.id);
      selectedBookmarkOnMap = null;
      map.clearSelectionPin();
      if (bookmarkMapCard) bookmarkMapCard.hidden = true;
      status('Bookmark removed', bookmark.name);
    });

    const showRegionsOverlay = () => {
      tabBeforeRegions = activeAppTab;
      regionsOverlay.hidden = false;
      regionsFeature.onShow = showRegionsOverlay;
      void regionsFeature.render();
    };

    const closeRegionsOverlay = () => {
      regionsOverlay.hidden = true;
      activeAppTab = tabBeforeRegions;
      syncTabs();
    };

    regionsFeature.onShow = showRegionsOverlay;
    offlineRegionsButton?.addEventListener('click', showRegionsOverlay);
    closeRegionsButton?.addEventListener('click', closeRegionsOverlay);

    let tabsHiddenBeforeSettings = false;

    const syncSettingsOverlay = () => {
      const appearance = appearancePreference.getMode();
      for (const button of settingsOverlay?.querySelectorAll('[data-settings-theme]') ?? []) {
        const active = button.dataset.settingsTheme === appearance;
        button.classList.toggle('on', active);
        button.setAttribute('aria-pressed', String(active));
      }

      const travelMode = navigationFeature.getPlannerState().travelMode;
      for (const button of settingsOverlay?.querySelectorAll('[data-settings-travel-mode]') ?? []) {
        const active = button.dataset.settingsTravelMode === travelMode;
        button.classList.toggle('on', active);
        button.setAttribute('aria-pressed', String(active));
      }

      const voice = navigationFeature.getVoiceGuidanceState();
      if (settingsVoiceButton) {
        settingsVoiceButton.disabled = !voice.supported;
        settingsVoiceButton.classList.toggle('on', voice.enabled);
        settingsVoiceButton.setAttribute('aria-pressed', String(voice.enabled));
      }
      const navPrefs = navigationFeature.getNavigationPreferences();
      for (const [button, enabled] of [[settingsHeadingButton, followMode.getHeadingUpEnabled()], [settingsLaneButton, navPrefs.laneGuidance], [settingsRerouteButton, navPrefs.autoReroute]]) { button?.classList.toggle('on', enabled); button?.setAttribute('aria-pressed', String(enabled)); }
      const followZoom = followMode.getFollowZoom();
      for (const button of settingsOverlay?.querySelectorAll('[data-settings-follow-zoom]') ?? []) { const active=button.dataset.settingsFollowZoom===followZoom; button.classList.toggle('on',active); button.setAttribute('aria-pressed',String(active)); }
    };

    const showSettingsOverlay = () => {
      if (!settingsOverlay) return;
      if (settingsOverlay.hidden) {
        tabsHiddenBeforeSettings = appTabs?.hidden === true;
      }
      panelController.hidePanel();
      syncSettingsOverlay();
      settingsOverlay.hidden = false;
      appTabs.hidden = true;
    };

    const closeSettingsOverlay = () => {
      if (!settingsOverlay || settingsOverlay.hidden) return;
      settingsOverlay.hidden = true;
      appTabs.hidden = tabsHiddenBeforeSettings;
      syncTabs();
      syncWorkspaceVisibility();
    };

    closeSettingsButton?.addEventListener('click', closeSettingsOverlay);

    settingsOverlay?.addEventListener('click', event => {
      const themeButton = event.target.closest?.('[data-settings-theme]');
      if (themeButton) {
        appearancePreference.setMode(themeButton.dataset.settingsTheme);
        syncSettingsOverlay();
        return;
      }

      const travelButton = event.target.closest?.('[data-settings-travel-mode]');
      if (travelButton) {
        navigationFeature.setTravelMode(travelButton.dataset.settingsTravelMode);
        syncSettingsOverlay();
      }
      const zoomButton = event.target.closest?.('[data-settings-follow-zoom]');
      if (zoomButton) { followMode.setFollowZoom(zoomButton.dataset.settingsFollowZoom); syncSettingsOverlay(); }
    });

    settingsVoiceButton?.addEventListener('click', () => {
      const voice = navigationFeature.getVoiceGuidanceState();
      navigationFeature.setVoiceGuidanceEnabled(!voice.enabled);
      syncSettingsOverlay();
    });
    settingsHeadingButton?.addEventListener('click', () => { followMode.setHeadingUpEnabled(!followMode.getHeadingUpEnabled()); syncSettingsOverlay(); });
    settingsLaneButton?.addEventListener('click', () => { const v=navigationFeature.getNavigationPreferences().laneGuidance; navigationFeature.setLaneGuidanceEnabled(!v); syncSettingsOverlay(); });
    settingsRerouteButton?.addEventListener('click', () => { const v=navigationFeature.getNavigationPreferences().autoReroute; navigationFeature.setAutoRerouteEnabled(!v); syncSettingsOverlay(); });

    settingsRegionsButton?.addEventListener('click', () => {
      closeSettingsOverlay();
      showRegionsOverlay();
    });

    root.addEventListener('navigationactivechange', event => {
      const active = event.detail?.active === true;
      root.querySelector('.app')?.classList.toggle(
        'navigation-active',
        active
      );
      appTabs.hidden = active;
      if (fullMapButton) fullMapButton.hidden = false;
      exploreWorkspace.hidden = true;
      tripWorkspace.hidden = true;
      navigationWorkspace.hidden = true;

      if (!active) {
        if (fullMapButton) fullMapButton.hidden = false;
        activeAppTab = 'navigation';
        workspaceChromeVisible.navigation = true;
        syncTabs();
        syncWorkspaceVisibility();
      }
    });

    root.addEventListener('navigationarrivalaction', event => {
      const action = event.detail?.action;
      const destination = event.detail?.destination;

      if (action === 'save' && destination) {
        beginBookmarkFromSelectedPoint(destination);
        return;
      }

      if (action === 'parking' && destination) {
        navigationFeature.finishArrival();
        selectAppTab('explore', { revealExplore: true });
        void nearbyFeature.search(destination, { expandPanel: false });
        return;
      }

      if (action === 'trip') {
        selectAppTab('trip');
      }
    });

    root.addEventListener('tripnavigate', event => {
      const place = event.detail?.place;
      const navigationContext = event.detail?.navigationContext ?? null;
      if (!place) return;

      navigationFeature.setPlannerDestination(place, {
        context: navigationContext
      });
      selectAppTab('navigation');
    });

    root.addEventListener('tripnearby', event => {
      const place = event.detail?.place;
      if (!place) return;

      selectAppTab('explore', { revealExplore: true });
      void nearbyFeature.search(place);
    });

    root.addEventListener('mapnearby', event => {
      const point = event.detail?.point;
      if (!point) return;

      selectAppTab('explore', { revealExplore: true });
      void nearbyFeature.search(point);
    });

    root.addEventListener('nearbybookmark', event => {
      const place = event.detail?.place;
      if (!place) return;

      beginBookmarkFromSelectedPoint(place);
    });

    root.addEventListener('nearbynavigate', event => {
      const place = event.detail?.place;
      if (!place) return;

      navigationFeature.setPlannerDestination(place);
      selectAppTab('navigation');
    });

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




    panelController.registerMode('regions', {
      enter: () => {
        void regionsFeature.render();
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
    const tripCatalog = new TripCatalog();
    const tripStore = new TripStore();

    let tripLibraryState = tripStore.load();

    tripFeature.onStateChange = viewState => {
      const activeId =
        tripLibraryState.activeId;

      if (!activeId) {
        return;
      }

      tripStore.setViewState(
        activeId,
        viewState
      );

      tripLibraryState =
        tripStore.load();
    };
    let tripLibraryOpen = false;
    let availableCloudTrips = [];
    let cloudTripsLoaded = false;

    const tripTitle = root.querySelector('#tripTitle');
    const tripLibraryButton = root.querySelector('#tripLibraryBtn');
    const tripLibraryView = root.querySelector('#tripLibraryView');
    const tripLibraryList = root.querySelector('#tripLibraryList');
    const tripCloudList = root.querySelector('#tripCloudList');
    const tripImportButton = root.querySelector('#tripImportBtn');

    const firstTripDay = data =>
      Object.keys(data?.trip?.days ?? {})[0] ?? '1';

    const activeTripRecord = () =>
      tripLibraryState.trips.find(
        trip => trip.id === tripLibraryState.activeId
      ) ?? null;

    const syncTripTitle = () => {
      if (!tripTitle) return;
      tripTitle.textContent =
        activeTripRecord()?.name ?? 'Your trips';
    };

    const renderTripLibrary = () => {
      if (!tripLibraryList) return;
      tripLibraryList.replaceChildren();

      if (tripLibraryState.trips.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'trip-library-empty';
        empty.innerHTML = `
          <strong>No saved trips yet</strong>
          <span>Load a trip JSON once and Atlas will keep it on this device.</span>
        `;
        tripLibraryList.append(empty);
        return;
      }

      for (const trip of tripLibraryState.trips) {
        const row = document.createElement('article');
        row.className = 'trip-library-item';
        if (trip.id === tripLibraryState.activeId) {
          row.classList.add('active');
        }

        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'trip-library-open';
        copy.dataset.tripOpen = trip.id;

        const name = document.createElement('strong');
        name.textContent = trip.name || 'Trip';
        const source = document.createElement('span');
        source.textContent = trip.sourceName;
        copy.append(name, source);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'trip-library-remove';
        remove.dataset.tripRemove = trip.id;
        remove.setAttribute('aria-label', `Remove ${trip.name || 'trip'}`);
        remove.textContent = 'Remove';

        row.append(copy, remove);
        tripLibraryList.append(row);
      }
    };

    const renderCloudTrips = () => {
      if (!tripCloudList) return;

      tripCloudList.replaceChildren();

      if (!cloudTripsLoaded) {
        const loading = document.createElement('div');
        loading.className = 'trip-library-empty';
        loading.textContent = 'Loading available trips…';
        tripCloudList.append(loading);
        return;
      }

      if (!availableCloudTrips.length) {
        const empty = document.createElement('div');
        empty.className = 'trip-library-empty';
        empty.textContent = 'No online trips available.';
        tripCloudList.append(empty);
        return;
      }

      for (const trip of availableCloudTrips) {
        const alreadySaved =
          tripLibraryState.trips.some(record =>
            record.data?.trip?.id === trip.id
          );

        const row = document.createElement('article');
        row.className = 'trip-library-item';

        const copy = document.createElement('div');
        copy.className = 'trip-library-open';

        const name = document.createElement('strong');
        name.textContent = trip.name;

        const source = document.createElement('span');
        source.textContent =
          alreadySaved
            ? 'Saved on this device'
            : 'Available online';

        copy.append(name, source);

        const action = document.createElement('button');
        action.type = 'button';
        action.className = 'trip-library-remove';

        if (alreadySaved) {
          action.textContent = 'Saved';
          action.disabled = true;
        } else {
          action.textContent = 'Download';
          action.dataset.tripDownload = trip.id;
        }

        row.append(copy, action);
        tripCloudList.append(row);
      }
    };

    const loadCloudTrips = async () => {
      try {
        availableCloudTrips =
          await tripCatalog.list();
      } catch (error) {
        console.error(error);
        availableCloudTrips = [];
      } finally {
        cloudTripsLoaded = true;
        renderCloudTrips();
      }
    };

    const setTripLibraryOpen = open => {
      tripLibraryOpen = open === true;
      tripWorkspace?.classList.toggle(
        'trip-library-open',
        tripLibraryOpen
      );
      if (tripLibraryView) {
        tripLibraryView.hidden = !tripLibraryOpen;
      }
      tripLibraryButton?.setAttribute(
        'aria-expanded',
        String(tripLibraryOpen)
      );
      if (tripLibraryOpen) {
        renderTripLibrary();
        renderCloudTrips();

        if (!cloudTripsLoaded) {
          void loadCloudTrips();
        }
      }
    };

    const activateTripRecord = (record, { reveal = true } = {}) => {
      if (!record?.data) return false;

      tripStore.setActive(record.id);
      tripLibraryState = tripStore.load();
      tripFeature.load(record.data, {
        initialDay:
          record.viewState?.day ??
          firstTripDay(record.data),

        initialStopIndex:
          record.viewState?.stopIndex ??
          null,

        initialMode:
          record.viewState?.mode ??
          'schedule'
      });
      syncTripTitle();
      setTripLibraryOpen(false);

      if (reveal) {
        selectAppTab('trip', { reveal: true });
      }

      return true;
    };

    const restoreStoredTrip = () => {
      const record = activeTripRecord();
      if (record) {
        activateTripRecord(record, { reveal: false });
      } else {
        tripFeature.unload();
        syncTripTitle();
      }
    };

    const loadTripButton =
      root.querySelector('#loadTripBtn');

    const tripFileInput =
      root.querySelector('#tripFileInput');

    const moreButton =
      root.querySelector('#moreBtn');

    const overflowMenu =
      root.querySelector('#overflowMenu');

    const menuBookmarksButton =
      root.querySelector('#menuBookmarksBtn');

    const menuRegionsButton =
      root.querySelector('#menuRegionsBtn');

    const menuSettingsButton =
      root.querySelector('#menuSettingsBtn');

    const menuGpsDiagnosticsButton =
      root.querySelector('#menuGpsDiagnosticsBtn');

    const menuAboutButton =
      root.querySelector('#menuAboutBtn');

    const GPS_DIAGNOSTICS_STORAGE_KEY =
      'atlas.gpsDiagnosticsVisible';

    let gpsDiagnosticsVisible =
      globalThis.localStorage?.getItem(
        GPS_DIAGNOSTICS_STORAGE_KEY
      ) === 'true';

    const renderGpsDiagnosticsToggle = () => {
      map.setGpsDiagnosticsVisible?.(
        gpsDiagnosticsVisible
      );

      menuGpsDiagnosticsButton?.setAttribute(
        'aria-pressed',
        String(gpsDiagnosticsVisible)
      );

      const label =
        menuGpsDiagnosticsButton
          ?.querySelector('span');

      if (label) {
        label.textContent =
          `GPS diagnostics · ${
            gpsDiagnosticsVisible
              ? 'On'
              : 'Off'
          }`;
      }
    };

    renderGpsDiagnosticsToggle();

  let activeRegionId = null;

  regionManager.subscribe(event => {
    if (
      !appState.userPosition ||
      ![
        'installed',
        'updated',
        'removed'
      ].includes(event.type)
    ) {
      return;
    }

    regionManager
      .ensureForPosition(
        appState.userPosition
      )
      .then(async region => {
        activeRegionId =
          region?.id ?? null;

        await map.setRegion(region, {
          preferOffline: false
        });
      })
      .catch(error => {
        console.error(
          'Region activation failed:',
          error
        );
      });
  });

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


      globalThis.__atlasGpsFixCount =
        (globalThis.__atlasGpsFixCount ?? 0) + 1;

      map.updateUserLocation(position, firstFix);
      appContext
        .get('navigationFeature')
        .updatePosition(appState.userPosition);

      followMode.updatePosition(position);

      if (!appContext.get('navigationFeature').isActive()) {
        status(
          '📍 You are here',
          `Accuracy: ${Math.round(position.accuracy)} m`
        );
      }
    }
  });
loadTripButton?.addEventListener(
      'click',
      () => {
        tripFileInput?.click();
      }
    );

    tripImportButton?.addEventListener('click', () => {
      tripFileInput?.click();
    });

    tripLibraryButton?.addEventListener('click', () => {
      if (!tripFeature.isLoaded()) {
        setTripLibraryOpen(true);
        return;
      }
      setTripLibraryOpen(!tripLibraryOpen);
    });

    tripLibraryList?.addEventListener('click', event => {
      const openButton = event.target.closest?.('[data-trip-open]');
      if (openButton) {
        const record = tripLibraryState.trips.find(
          trip => trip.id === openButton.dataset.tripOpen
        );
        if (record) activateTripRecord(record);
        return;
      }

      const removeButton = event.target.closest?.('[data-trip-remove]');
      if (!removeButton) return;

      const id = removeButton.dataset.tripRemove;
      const removed = tripLibraryState.trips.find(trip => trip.id === id);
      const removedActive = tripLibraryState.activeId === id;
      tripLibraryState = tripStore.remove(id);

      if (removedActive) {
        const next = activeTripRecord();
        if (next) {
          activateTripRecord(next, { reveal: false });
        } else {
          tripFeature.unload();
          syncTripTitle();
        }
      }

      setTripLibraryOpen(true);
      status('Trip removed', removed?.name ?? '');
    });

    tripCloudList?.addEventListener(
      'click',
      async event => {
        const button =
          event.target.closest?.('[data-trip-download]');

        if (!button) return;

        const trip =
          availableCloudTrips.find(
            item =>
              item.id === button.dataset.tripDownload
          );

        if (!trip) return;

        button.disabled = true;
        button.textContent = 'Downloading…';

        try {
          const tripData =
            await tripLoader.loadFromUrl(trip.url);

          const record = tripStore.upsert(
            tripData,
            {
              sourceName: `${trip.id}.json`
            }
          );

          tripLibraryState = tripStore.load();

          renderTripLibrary();
          renderCloudTrips();
          activateTripRecord(record);

          status(
            'Trip downloaded',
            trip.name
          );
        } catch (error) {
          console.error(error);

          button.disabled = false;
          button.textContent = 'Download';

          status(
            'Could not download trip',
            error.message
          );
        }
      }
    );

    restoreStoredTrip();

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

          const record = tripStore.upsert(
            tripData,
            { sourceName: file.name }
          );
          tripLibraryState = tripStore.load();
          renderTripLibrary();
          activateTripRecord(record);

          status(
            'Trip saved',
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
        mapSelectionFeature.clear();

        showBookmarksList();
        closeBookmarksOverlay();
        setWorkspaceChrome(activeAppTab, false);

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

  function showBookmarkEditor() {
    if (bookmarksContent) {
      bookmarksContent.hidden = true;
    }

    if (bookmarkEditor) {
      bookmarkEditor.hidden = false;
    }

    if (bookmarkNameInput) {
      bookmarkNameInput.value = '';
      bookmarkNameInput.focus?.({
        preventScroll: true
      });
    }
  }

  function showBookmarksList() {
    bookmarkPickMode = false;

    if (bookmarkEditor) {
      bookmarkEditor.hidden = true;
    }

    if (bookmarksContent) {
      bookmarksContent.hidden = false;
    }
  }

  const restoreAfterBookmark = () => {
    showBookmarksList();
    closeBookmarksOverlay();
  };

  function openBookmarkEditorAt({
    lat,
    lon,
    name = null
  }) {
    pendingBookmarkLocation = {
      lat,
      lon,
      name
    };

    bookmarkPickMode = true;

    map.showSelectionPin(lat, lon);

    bookmarkCoordinates.textContent =
      `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

    showBookmarksOverlay({ editor: true });

    if (bookmarkNameInput) {
      bookmarkNameInput.value =
        name &&
        name !== 'Selected point'
          ? name
          : '';
    }

    status(
      'Bookmark location selected',
      'Save it or tap another point.'
    );
  }

  function beginBookmarkFromSelectedPoint(
    point
  ) {
    openBookmarkEditorAt(point);
  }


  map.onMapClick(({ lat, lon }) => {
    if (bookmarkPickMode) {
      openBookmarkEditorAt({
        lat,
        lon
      });

      return;
    }

    if (
      appContext
        .get('navigationFeature')
        .acceptMapPoint({ lat, lon })
    ) {
      return;
    }

    mapSelectionFeature.select({
      name: 'Selected point',
      lat,
      lon
    });
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

      restoreAfterBookmark();
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

      restoreAfterBookmark();

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
      moreButton?.setAttribute('aria-expanded', 'false');
    };

    moreButton?.addEventListener(
      'click',
      event => {
        event.stopPropagation();

        if (overflowMenu) {
          overflowMenu.hidden =
            !overflowMenu.hidden;
          moreButton?.setAttribute(
            'aria-expanded',
            String(!overflowMenu.hidden)
          );
        }
      }
    );

    menuBookmarksButton?.addEventListener(
      'click',
      () => {
        closeOverflowMenu();
        showBookmarksOverlay();
      }
    );

    menuRegionsButton?.addEventListener(
      'click',
      () => {
        closeOverflowMenu();
        showRegionsOverlay();
      }
    );

    menuSettingsButton?.addEventListener(
      'click',
      () => {
        closeOverflowMenu();
        showSettingsOverlay();
      }
    );

    menuGpsDiagnosticsButton?.addEventListener(
      'click',
      () => {
        gpsDiagnosticsVisible =
          !gpsDiagnosticsVisible;

        globalThis.localStorage?.setItem(
          GPS_DIAGNOSTICS_STORAGE_KEY,
          String(gpsDiagnosticsVisible)
        );

        renderGpsDiagnosticsToggle();
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

    document.addEventListener(
      'keydown',
      event => {
        if (event.key === 'Escape' && settingsOverlay?.hidden === false) {
        closeSettingsOverlay();
        return;
      }

      if (event.key === 'Escape' && bookmarksOverlay?.hidden === false) {
          closeBookmarksOverlay();
          return;
        }

        if (event.key !== 'Escape' || overflowMenu?.hidden !== false) {
          return;
        }

        closeOverflowMenu();
        moreButton?.focus();
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




  const gpsButton =
    root.querySelector('#gpsBtn');

  const syncGpsButtonState = () => {
    const enabled = gps.enabled;

    gpsButton?.classList.toggle(
      'on',
      enabled
    );

    gpsButton?.setAttribute(
      'aria-pressed',
      String(enabled)
    );

    gpsButton?.setAttribute(
      'title',
      enabled
        ? 'Disable GPS'
        : 'Enable GPS'
    );
  };

  gpsButton?.addEventListener(
    'click',
    async () => {
      if (gps.enabled) {
        await gps.stop();
        map.adapter?.resetGpsDiagnostics?.();

        status(
          'GPS disabled',
          'Your location is no longer being tracked.'
        );
      } else {
        await gps.start();
      }

      syncGpsButtonState();
    }
  );

  syncGpsButtonState();




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
