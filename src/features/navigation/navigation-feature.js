import {
  NavigationSession
} from './navigation-session.js';

import {
  distanceMeters
} from './navigation-geometry.js';

import {
  OfflineRoutingService
} from '../../routing/offline-routing-service.js';

import {
  findRouteProgress
} from '../../routing/route-progress.js';

import {
  NavigationGuidance
} from './navigation-guidance.js';

import {
  NavigationVoice,
  spokenInstruction
} from './navigation-voice.js';

import {
  maneuverIconSvg
} from './maneuver-icons.js';

import {
  queryDestinations
} from '../../nearby.js';

import {
  NavigationPlannerView
} from './navigation-planner-view.js';

import {
  DestinationHistory
} from './destination-history.js';

import { escapeHtml } from '../../utils.js';

const OFF_ROUTE_DISTANCE_METERS = 50;
const GPS_REDUCED_ACCURACY_METERS = 80;
const OFF_ROUTE_ACCURACY_MULTIPLIER = 1.5;
const OFF_ROUTE_CONFIRMATION_FIXES = 2;
const OFF_ROUTE_CONFIRMATION_MS = 1_500;
const ROUTE_CHANGED_NOTICE_MS = 6_000;
const MINIMUM_REROUTE_INTERVAL_MS = 10_000;
const REROUTE_ARM_SPEED_METERS_PER_SECOND = 1.8;
const REROUTE_ARM_DISPLACEMENT_METERS = 18;
const REROUTE_ARM_CONFIRMATION_FIXES = 2;
const REROUTE_ARM_CONFIRMATION_MS = 1_000;
const REROUTE_ARM_MAX_ACCURACY_METERS = 35;
const ROUTE_PREVIEW_COLLAPSE_MS = 4_500;
const APPROACHING_DESTINATION_METERS = 100;
const ARRIVAL_DISTANCE_METERS = 30;
const ARRIVAL_DESTINATION_RADIUS_METERS = 50;
const WALK_ARRIVAL_DISTANCE_METERS = 15;
const WALK_ARRIVAL_DESTINATION_RADIUS_METERS = 20;

import { TransitJourneyExecution } from '../../transit/transit-journey-execution.js';
import { TransitJourneyExecutionView } from './transit-journey-execution-view.js';

export class NavigationFeature {
  constructor({
    map,
    panelController,
    listElement,
    guidanceElement = null,
    guidance = null,
    status,
    session = new NavigationSession(),
    routingService =
      new OfflineRoutingService(),
    now = () => Date.now(),
    voice = new NavigationVoice(),
    destinationSearch = queryDestinations,
    searchAnchorProvider = () => null,
    destinationHistory = new DestinationHistory(),
    transitProviderRegistry = null,
    transitBridge = null,
    plannerView = null,
    onActiveChange = () => {},
    onArrivalAction = () => {},
    onBookmarkDestination = () => {},
    documentRef = globalThis.document
  }) {
    if (
      !map ||
      !panelController ||
      !listElement ||
      !documentRef
    ) {
      throw new TypeError(
        'NavigationFeature requires map, panelController and listElement.'
      );
    }

    this.map = map;
    this.panelController =
      panelController;
    this.listElement = listElement;
    this.status = status;
    this.session = session;
    this.routingService = routingService;
    this.now = now;
    this.document = documentRef;
    this.voice = voice;
    this.destinationSearch =
      destinationSearch;
    this.searchAnchorProvider =
      searchAnchorProvider;
    this.destinationHistory =
      destinationHistory;
    this.transitProviderRegistry = transitProviderRegistry ?? (transitBridge ? {
      resolve: async () => ({
        available: true,
        region: null,
        provider: { id: 'legacy', label: 'Public transport', bridge: transitBridge },
        reason: null
      })
    } : null);
    this.plannerView = plannerView ??
      new NavigationPlannerView({
        documentRef
      });
    this.onActiveChange = onActiveChange;
    this.onArrivalAction = onArrivalAction;
    this.onBookmarkDestination =
      onBookmarkDestination;

    this.guidance = guidance ??
      (guidanceElement
        ? new NavigationGuidance({
            element: guidanceElement,
            onStop: () => this.stop(),
            onToggleVoice:
              () => this.#toggleVoice(),
            onUndoRoute:
              () => this.undoLastReroute(),
            onArrivalAction:
              action => this.#handleArrivalAction(action),
            onTravelMode:
              mode => this.setTravelMode(mode),
            voiceState: () => ({
              enabled:
                this.voice.isEnabled(),
              supported:
                this.voice.isSupported()
            }),
            now
          })
        : null);

    this.routeState = 'idle';
    this.routeError = null;
    this.routeRequest = 0;
    this.routeAbortController = null;
    this.lastRouteAt = 0;
    this.routeProgress = null;
    this.lastVoiceAnnouncement = null;
    this.navigationConfidenceState = 'normal';
    this.offRouteEvidenceCount = 0;
    this.offRouteEvidenceSince = 0;
    this.rerouteArmed = false;
    this.rerouteArmReferencePosition = null;
    this.rerouteArmEvidenceCount = 0;
    this.rerouteArmEvidenceSince = 0;
    this.routeChangedUntil = 0;
    this.previousRoute = null;
    this.arrivalState = null;
    this.navigationContext = null;

    this.currentPosition = null;
    this.trackPosition = true;
    this.travelMode = this.#loadTravelMode();
    this.laneGuidanceEnabled = this.#loadBoolPref('atlas.navigation.laneGuidance', true);
    this.autoRerouteEnabled = this.#loadBoolPref('atlas.navigation.autoReroute', true);

    // The map marker should always reflect the selected planner mode,
    // even before active navigation starts.
    this.map.setNavigationTravelMode?.(
      this.travelMode === 'transit' ? null : this.travelMode
    );

    this.plannerOrigin = null;
    this.plannerDestination = null;
    this.plannerNavigationContext = null;
    this.plannerQuery = '';
    this.plannerSearchTarget = 'destination';
    this.advancedPlannerOpen = false;
    this.plannerResults = [];
    this.plannerState = 'idle';
    this.plannerError = null;
    this.plannerRequest = 0;
    this.plannerSearchTimer = null;
    this.pickMode = null;
    this.previewRoute = null;
    this.previewOrigin = null;
    this.previewState = 'idle';
    this.previewError = null;
    this.previewRequest = 0;
    this.previewAbortController = null;
    this.previewPromise = null;
    this.previewCollapsed = false;
    this.driveRouteOptions = [];
    this.selectedDriveRouteIndex = 0;
    this.transitJourneyOptions = [];
    this.selectedTransitJourneyIndex = 0;
    this.expandedTransitJourneyIndex = null;
    this.transitJourneySession = null;
    this.transitJourneyExecution = null;
    this.transitJourneyStarting = false;
    this.transitJourneyExecutionView = new TransitJourneyExecutionView({ documentRef });
    this.transitWalkRequest = 0;
    this.transitAvailability = { status: 'unknown', region: null, providerId: null, message: null };
    this.transitAvailabilityRequest = 0;

    // Transit walking-leg arrival confidence.
    // Do not advance from one noisy GPS fix.
    this.transitArrivalEvidenceCount = 0;
    this.transitArrivalEvidenceSince = 0;

    this.previewCollapseTimer = null;

    this.map.onUserMoveStart?.(() => {
      if (this.previewRoute && !this.session.isActive()) {
        this.#setPreviewCollapsed(true);
      }
    });
  }

  async start({
    origin,
    destination,
    trackPosition = true,
    context = null
  }) {
    this.#resetPreview({ clearRoute: false });
    this.#cancelRouteRequest();
    this.map.clearRoute?.();

    this.session.start({
      origin,
      destination
    });
    this.map.setNavigationTravelMode?.(
      this.travelMode === 'transit' ? null : this.travelMode
    );
    this.onActiveChange(
      true,
      { trackPosition }
    );

    this.routeState = 'loading';
    this.routeError = null;
    this.routeProgress = null;
    this.lastVoiceAnnouncement = null;
    this.trackPosition = trackPosition;
    this.navigationContext = context;
    this.arrivalState = null;
    this.pickMode = null;
    this.#resetRerouteArming();

    this.render();

    this.guidance?.showLoading(
      destination.name ?? 'Destination'
    );

    this.status?.(
      'Calculating offline route',
      destination.name ??
        'Selected destination'
    );

    return this.#calculateRoute({
      preserveCurrentRoute: false
    });
  }

  updatePosition(position) {
    const normalizedPosition = {
      name: position.name ?? 'My location',
      lat:
        position.lat ??
        position.latitude,
      lon:
        position.lon ??
        position.longitude,
      heading: position.heading,
      speed: position.speed,
      accuracy: position.accuracy
    };

    if (
      !Number.isFinite(normalizedPosition.lat) ||
      !Number.isFinite(normalizedPosition.lon)
    ) {
      return;
    }

    const firstPlannerFix =
      !this.currentPosition;

    this.currentPosition =
      normalizedPosition;

    if (!this.session.isActive()) {
      if (
        firstPlannerFix &&
        !this.plannerOrigin
      ) {
        this.render();
      }

      // Transit vehicle legs do not run the normal road-navigation
      // session, but GPS still updates the execution card so Atlas can
      // tell the user when the alighting stop is approaching.
      if (this.transitJourneyExecution) {
        this.render();
      }

      return;
    }

    if (!this.trackPosition) {
      return;
    }

    this.session.updateOrigin(
      normalizedPosition
    );

    const { route } =
      this.session.getState();

    // Arrival keeps the session context alive until Finish,
    // but no further guidance or rerouting may replace the arrival UI.
    if (this.arrivalState) {
      return;
    }

    if (route?.maneuvers?.length) {
      this.routeProgress =
        findRouteProgress(
          this.session.getState().origin,
          route,
          {
            previousPointIndex:
              this.routeProgress
                ?.pointIndex ?? null
          }
        );

      if (this.#shouldArrive(normalizedPosition)) {
        if (this.#isTransitWalkingLeg()) {
          if (this.#confirmTransitWalkArrival(normalizedPosition)) {
            void this.#completeTransitWalkLeg();
            return;
          }
        } else {
          this.#arrive();
          return;
        }
      } else if (this.#isTransitWalkingLeg()) {
        this.#resetTransitArrivalEvidence();
      }

      this.#renderGuidance();
      this.#announceGuidance();

      this.map.showManeuvers?.(
        route.maneuvers,
        this.routeProgress
          ?.nextManeuverIndex ?? 0
      );

      this.map.updateRouteProgress?.(
        route,
        this.routeProgress
      );
    }

    this.render();

    if (!route || this.routeState === 'loading') {
      return;
    }

    const now = this.now();
    const distanceFromRoute =
      this.routeProgress?.distanceFromRouteMeters ??
      this.#distanceFromRoute(
        this.session.getState().origin,
        route.points
      );

    if (
      this.travelMode === 'drive' &&
      !this.#updateRerouteArming(normalizedPosition, now)
    ) {
      this.#resetOffRouteEvidence();
      if (this.navigationConfidenceState !== 'changed') {
        this.#setNavigationConfidenceState('normal');
      }
      return;
    }

    if (
      Number.isFinite(normalizedPosition.accuracy) &&
      normalizedPosition.accuracy > GPS_REDUCED_ACCURACY_METERS
    ) {
      this.#resetOffRouteEvidence();
      this.#setNavigationConfidenceState('reduced');
      return;
    }

    const offRouteThresholdMeters = Math.max(
      OFF_ROUTE_DISTANCE_METERS,
      Number.isFinite(normalizedPosition.accuracy)
        ? normalizedPosition.accuracy * OFF_ROUTE_ACCURACY_MULTIPLIER
        : 0
    );

    if (distanceFromRoute <= offRouteThresholdMeters) {
      this.#resetOffRouteEvidence();
      if (
        this.navigationConfidenceState !== 'changed' ||
        now >= this.routeChangedUntil
      ) {
        this.#setNavigationConfidenceState('normal');
      }
      return;
    }

    if (now - this.lastRouteAt < MINIMUM_REROUTE_INTERVAL_MS) {
      return;
    }

    if (!this.offRouteEvidenceSince) {
      this.offRouteEvidenceSince = now;
      this.offRouteEvidenceCount = 1;
      this.#setNavigationConfidenceState('checking');
      return;
    }

    this.offRouteEvidenceCount += 1;
    this.#setNavigationConfidenceState('checking');

    if (
      this.offRouteEvidenceCount < OFF_ROUTE_CONFIRMATION_FIXES ||
      now - this.offRouteEvidenceSince < OFF_ROUTE_CONFIRMATION_MS
    ) {
      return;
    }

    if (!this.autoRerouteEnabled) { this.#setNavigationConfidenceState('checking'); return; }
    this.previousRoute = route;
    this.#resetOffRouteEvidence();
    void this.#calculateRoute({
      preserveCurrentRoute: true
    });
  }

  stop() {
    if (!this.session.isActive()) {
      return;
    }

    this.#cancelRouteRequest();
    this.session.stop();
    this.routeState = 'idle';
    this.routeError = null;
    this.lastRouteAt = 0;
    this.routeProgress = null;
    this.lastVoiceAnnouncement = null;
    this.navigationConfidenceState = 'normal';
    this.#resetOffRouteEvidence();
    this.#resetRerouteArming();
    this.routeChangedUntil = 0;
    this.previousRoute = null;
    this.arrivalState = null;
    this.navigationContext = null;
    this.trackPosition = true;

    this.map.clearRoute?.();

    this.map.setNavigationTravelMode?.(
      this.travelMode === 'transit' ? null : this.travelMode
    );

    this.listElement.replaceChildren();
    this.guidance?.hide();
    this.voice.stop();
    this.onActiveChange(false);

    this.render();

    this.status?.(
      'Navigation stopped',
      ''
    );
  }

  undoLastReroute() {
    if (!this.session.isActive() || !this.previousRoute) {
      return false;
    }

    const route = this.previousRoute;
    this.previousRoute = null;
    this.session.setRoute(route);
    this.routeState = 'ready';
    this.routeChangedUntil = 0;
    this.navigationConfidenceState = 'normal';

    const { origin, destination } = this.session.getState();
    this.routeProgress = route.maneuvers?.length
      ? findRouteProgress(origin, route)
      : null;

    this.map.showRoute?.(route, { origin, destination });
    this.map.updateRouteProgress?.(route, this.routeProgress);
    this.map.showManeuvers?.(
      route.maneuvers ?? [],
      this.routeProgress?.nextManeuverIndex ?? 0
    );
    this.#renderGuidance();
    this.render();
    this.status?.('Previous route restored', '');
    return true;
  }

  finishArrival() {
    if (!this.arrivalState) return false;
    this.stop();
    this.status?.('Arrival complete', '');
    return true;
  }

  #shouldArrive(position) {
    if (this.arrivalState || !this.routeProgress) return false;

    const destination = this.session.getState().destination;
    if (!destination) return false;

    const remaining = this.routeProgress.remainingDistanceMeters;
    const direct = distanceMeters(position, destination);
    const walking =
      this.travelMode === 'walk' ||
      this.#isTransitWalkingLeg();
    const remainingThreshold = walking
      ? WALK_ARRIVAL_DISTANCE_METERS
      : ARRIVAL_DISTANCE_METERS;
    const destinationRadius = walking
      ? WALK_ARRIVAL_DESTINATION_RADIUS_METERS
      : ARRIVAL_DESTINATION_RADIUS_METERS;

    return Number.isFinite(remaining) &&
      remaining <= remainingThreshold &&
      direct <= destinationRadius;
  }

  #isTransitWalkingLeg() {
    const state = this.transitJourneyExecution?.getState?.();

    return Boolean(
      state &&
      !state.completed &&
      state.leg?.kind === 'walk' &&
      state.phase === 'walking'
    );
  }

  #resetTransitArrivalEvidence() {
    this.transitArrivalEvidenceCount = 0;
    this.transitArrivalEvidenceSince = 0;
  }

  #confirmTransitWalkArrival(position) {
    if (
      !Number.isFinite(position.accuracy) ||
      position.accuracy > 35
    ) {
      this.#resetTransitArrivalEvidence();
      return false;
    }

    const now = this.now();

    if (!this.transitArrivalEvidenceSince) {
      this.transitArrivalEvidenceSince = now;
      this.transitArrivalEvidenceCount = 1;

      this.status?.(
        'Checking arrival',
        'GPS indicates you are at the next stop.'
      );

      return false;
    }

    this.transitArrivalEvidenceCount += 1;

    return (
      this.transitArrivalEvidenceCount >= 3 &&
      now - this.transitArrivalEvidenceSince >= 3000
    );
  }

  async #completeTransitWalkLeg() {
    if (!this.#isTransitWalkingLeg()) {
      return false;
    }

    this.#resetTransitArrivalEvidence();
    this.#cancelRouteRequest();

    if (this.session.isActive()) {
      this.session.stop();
    }

    this.routeState = 'idle';
    this.routeError = null;
    this.routeProgress = null;
    this.arrivalState = null;
    this.previousRoute = null;
    this.lastVoiceAnnouncement = null;

    this.guidance?.hide();
    this.voice.stop();
    this.map.clearManeuvers?.();

    this.status?.(
      'Stop reached',
      'Walking leg completed automatically from GPS.'
    );

    return this.transitionTransitJourney('arrived');
  }

  #arrive() {
    if (this.arrivalState || !this.session.isActive()) return;

    const { destination } = this.session.getState();
    this.arrivalState = { destination, context: this.navigationContext };
    this.#resetOffRouteEvidence();
    this.navigationConfidenceState = 'normal';
    this.voice.stop();

    if (this.voice.isEnabled()) {
      this.voice.speak(
        `You have arrived at ${
          destination?.name ?? 'your destination'
        }.`
      );
    }

    this.map.clearManeuvers?.();

    this.guidance?.showArrival({
      destinationName: destination?.name ?? 'Destination',
      context: this.navigationContext
    });

    this.status?.('Arrived', destination?.name ?? 'Destination');
  }

  #handleArrivalAction(action) {
    if (!this.arrivalState) return;

    if (action === 'finish') {
      this.finishArrival();
      return;
    }

    const detail = {
      destination: this.arrivalState.destination,
      context: this.arrivalState.context
    };

    if (action === 'trip') {
      this.finishArrival();
    }

    this.onArrivalAction(action, detail);
  }

  isActive() {
    return this.session.isActive();
  }

  getVoiceGuidanceState() {
    return {
      enabled: this.voice.isEnabled(),
      supported: this.voice.isSupported()
    };
  }

  setVoiceGuidanceEnabled(enabled) {
    const value = this.voice.setEnabled(enabled);

    if (this.session.isActive()) {
      this.#renderGuidance();
    }

    this.render();
    return value;
  }

  getPlannerState() {
    return {
      origin: this.#plannerStart(),
      travelMode: this.travelMode,
      originMode:
        this.plannerOrigin
          ? 'picked'
          : 'gps',
      destination:
        this.plannerDestination,
      query: this.plannerQuery,
      searchTarget: this.plannerSearchTarget,
      advancedPlannerOpen: this.advancedPlannerOpen,
      results: [...this.plannerResults],
      recent: this.destinationHistory.list(),
      state: this.plannerState,
      error: this.plannerError,
      pickMode: this.pickMode,
      previewRoute: this.previewRoute,
      previewState: this.previewState,
      previewError: this.previewError,
      previewCollapsed: this.previewCollapsed,
      driveRoutes: [...this.driveRouteOptions],
      selectedDriveRouteIndex:
        this.selectedDriveRouteIndex,
      transitJourneys: [...this.transitJourneyOptions],
      selectedTransitJourneyIndex:
        this.selectedTransitJourneyIndex,
      expandedTransitJourneyIndex:
        this.expandedTransitJourneyIndex,
      transitJourneySession:
        this.transitJourneySession,
      transitAvailability: { ...this.transitAvailability }
    };
  }

  setTravelMode(mode) {
    if (!['drive', 'walk', 'transit'].includes(mode)) {
      return false;
    }

    const changed = this.travelMode !== mode;
    this.travelMode = mode;

    if (changed) {
      this.#saveTravelMode();
    }

    this.map.setNavigationTravelMode?.(
      mode === 'transit' ? null : mode
    );

    if (this.session.isActive()) {
      if (mode === 'transit') {
        this.#cancelRouteRequest();

        this.session.stop();
        this.routeState = 'idle';
        this.routeError = null;
        this.routeProgress = null;
        this.arrivalState = null;
        this.navigationContext = null;

        this.guidance?.hide();
        this.voice.stop();

        this.map.clearRoute?.();
        this.map.clearManeuvers?.();
        this.map.setNavigationTravelMode?.(null);

        this.onActiveChange(false);
      } else {
        if (this.currentPosition && this.trackPosition) {
          this.session.updateOrigin(this.currentPosition);
        }

        void this.#calculateRoute({
          preserveCurrentRoute: true
        });

        return true;
      }
    }

    this.#resetPreview({ clearRoute: true });
    this.render();

    if (
      this.plannerDestination &&
      this.#plannerStart()
    ) {
      if (
        mode === 'transit' &&
        this.transitAvailability.status === 'unavailable'
      ) {
        this.previewState = 'error';
        this.previewError =
          this.transitAvailability.message ??
          'Public transport routing isn’t available in this region yet.';
        this.render();
      } else {
        void this.previewPlannedRoute();
      }
    }

    return true;
  }

  getNavigationPreferences() { return { laneGuidance: this.laneGuidanceEnabled, autoReroute: this.autoRerouteEnabled }; }
  setLaneGuidanceEnabled(value) { this.laneGuidanceEnabled=value===true; this.#saveBoolPref('atlas.navigation.laneGuidance',this.laneGuidanceEnabled); this.#renderGuidance(); return this.laneGuidanceEnabled; }
  setAutoRerouteEnabled(value) { this.autoRerouteEnabled=value===true; this.#saveBoolPref('atlas.navigation.autoReroute',this.autoRerouteEnabled); if (!this.autoRerouteEnabled) this.#resetOffRouteEvidence(); return this.autoRerouteEnabled; }
  #loadBoolPref(key,fallback) { try { const v=globalThis.localStorage?.getItem(key); return v == null ? fallback : v !== 'false'; } catch { return fallback; } }
  #saveBoolPref(key,value) { try { globalThis.localStorage?.setItem(key,String(value)); } catch {} }

  #loadTravelMode() {
    try {
      const saved = globalThis.localStorage?.getItem('atlas.navigation.travelMode');
      return ['drive', 'walk', 'transit'].includes(saved)
        ? saved
        : 'drive';
    } catch {
      return 'drive';
    }
  }

  #saveTravelMode() {
    try {
      globalThis.localStorage?.setItem(
        'atlas.navigation.travelMode',
        this.travelMode
      );
    } catch {
    }
  }

  useCurrentLocation() {
    this.plannerOrigin = null;
    this.plannerSearchTarget = 'destination';
    if (this.plannerDestination) {
      this.advancedPlannerOpen = false;
    }
    this.plannerQuery = '';
    this.plannerResults = [];
    this.plannerState = 'idle';
    this.plannerError = null;
    this.#resetPreview({ clearRoute: true });
    this.render();

    if (this.plannerDestination && this.#plannerStart()) {
      void this.previewPlannedRoute();
    }
  }

  swapPlannerEndpoints() {
    const origin = this.#plannerStart();

    if (!origin || !this.plannerDestination) {
      return false;
    }

    const previousDestination =
      this.plannerDestination;

    this.plannerOrigin = {
      ...previousDestination,
      name: previousDestination.name ?? 'Picked starting point'
    };

    this.plannerDestination = {
      ...origin,
      name: origin.name ?? 'Destination'
    };
    this.plannerNavigationContext = null;

    this.plannerResults = [];
    this.plannerQuery = '';
    this.plannerError = null;
    this.plannerState = 'idle';
    this.advancedPlannerOpen = false;
    this.plannerSearchTarget = 'destination';
    this.#resetPreview({ clearRoute: true });
    this.render();
    void this.previewPlannedRoute();
    return true;
  }

  openAdvancedPlanner({ focus = 'destination' } = {}) {
    if (this.session.isActive()) {
      return false;
    }

    this.advancedPlannerOpen = true;
    this.plannerSearchTarget =
      focus === 'origin' ? 'origin' : 'destination';
    this.plannerQuery = '';
    this.plannerResults = [];
    this.plannerState = 'idle';
    this.plannerError = null;
    this.render();

    const focusInput = () => {
      const input = this.document?.querySelector?.(
        '[data-navigation-query-input]'
      );
      input?.focus?.();
      input?.select?.();
    };

    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(focusInput);
    } else {
      queueMicrotask(focusInput);
    }

    return true;
  }

  closeAdvancedPlanner() {
    if (this.session.isActive() || !this.advancedPlannerOpen) {
      return false;
    }

    this.advancedPlannerOpen = false;
    this.plannerSearchTarget = 'destination';
    this.plannerQuery = '';
    this.plannerResults = [];
    this.plannerState = 'idle';
    this.plannerError = null;
    this.render();
    return true;
  }

  activatePlannerEndpoint(kind) {
    if (kind !== 'origin' && kind !== 'destination') {
      return false;
    }

    this.advancedPlannerOpen = true;
    this.plannerSearchTarget = kind;
    this.plannerQuery = '';
    this.plannerResults = [];
    this.plannerState = 'idle';
    this.plannerError = null;
    this.render();
    return true;
  }

  setPlannerOrigin(origin) {
    this.#validatePlannerPoint(origin);

    this.plannerOrigin = {
      ...origin,
      name: origin.name ?? 'Starting point'
    };
    this.plannerQuery = '';
    this.plannerResults = [];
    this.plannerState = 'idle';
    this.plannerError = null;
    this.#resetPreview({ clearRoute: true });

    if (this.plannerDestination) {
      this.advancedPlannerOpen = false;
      this.plannerSearchTarget = 'destination';
      this.render();
      void this.#refreshTransitAvailability();
      void this.previewPlannedRoute();
      return;
    }

    this.plannerSearchTarget = 'destination';
    this.render();
  }

  updatePlannerQuery(query) {
    this.plannerQuery = String(query ?? '');
    clearTimeout(this.plannerSearchTimer);
    this.plannerRequest += 1;

    if (this.plannerQuery.trim().length < 2) {
      this.plannerResults = [];
      this.plannerState = 'idle';
      this.plannerError = null;
      this.render();
      return;
    }

    this.plannerSearchTimer = setTimeout(
      () => void this.searchPlanner(this.plannerQuery),
      275
    );
  }

  clearPlannerSearch() {
    clearTimeout(this.plannerSearchTimer);
    this.plannerRequest += 1;
    this.plannerQuery = '';
    this.plannerResults = [];
    this.plannerState = 'idle';
    this.plannerError = null;
    this.render();
  }

  openDestinationSearch() {
    this.advancedPlannerOpen = false;
    this.plannerSearchTarget = 'destination';
    this.clearPlannerDestination();

    const focusSearch = () => {
      const input = this.document?.querySelector?.(
        '[data-navigation-query-input]'
      );

      input?.focus?.();
      input?.select?.();
    };

    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(focusSearch);
    } else {
      queueMicrotask(focusSearch);
    }
  }

  clearPlannerDestination() {
    this.advancedPlannerOpen = false;
    this.plannerSearchTarget = 'destination';
    this.travelMode = 'drive';
    this.map.setNavigationTravelMode?.('drive');
    this.#resetPreview({ clearRoute: true });
    this.plannerDestination = null;
    this.plannerNavigationContext = null;
    this.plannerQuery = '';
    this.plannerResults = [];
    this.plannerState = 'idle';
    this.plannerError = null;
    this.map.clearSelectionPin?.();
    this.render();
  }

  beginMapPick(kind) {
    if (
      kind !== 'origin' &&
      kind !== 'destination'
    ) {
      throw new TypeError(
        'Navigation map picking requires origin or destination.'
      );
    }

    if (this.session.isActive()) {
      return false;
    }

    this.pickMode = kind;
    this.map.clearSelectionPin?.();
    this.panelController.hidePanel?.();
    this.render();

    this.status?.(
      kind === 'origin'
        ? 'Choose a starting point'
        : 'Choose a destination',
      'Tap the map to place it.'
    );

    return true;
  }

  acceptMapPoint(point) {
    if (!this.pickMode) {
      return false;
    }

    this.#validatePlannerPoint(point);

    const kind = this.pickMode;
    const selected = {
      name:
        kind === 'origin'
          ? 'Picked starting point'
          : 'Picked destination',
      lat: point.lat,
      lon: point.lon
    };

    this.#resetPreview({ clearRoute: true });

    if (kind === 'origin') {
      this.plannerOrigin = selected;
      this.plannerResults = [];
    } else {
      this.plannerDestination = selected;
      this.plannerNavigationContext = null;
      this.plannerResults = [];
      this.plannerState = 'idle';
    }

    this.pickMode = null;
    this.plannerError = null;

    if (this.plannerDestination && this.#plannerStart()) {
      this.advancedPlannerOpen = false;
      this.plannerSearchTarget = 'destination';
    }

    this.map.showSelectionPin?.(
      selected.lat,
      selected.lon
    );

    this.map.focus?.(
      selected.lat,
      selected.lon,
      15
    );

    this.render();

    this.status?.(
      kind === 'origin'
        ? 'Starting point selected'
        : 'Destination selected',
      selected.name
    );

    if (this.plannerDestination && this.#plannerStart()) {
      void this.previewPlannedRoute();
    }

    return true;
  }

  setPlannerDestination(destination, { context = null } = {}) {
    this.#validatePlannerPoint(
      destination
    );

    this.#resetPreview({ clearRoute: true });

    this.advancedPlannerOpen = false;
    this.plannerSearchTarget = 'destination';

    this.plannerDestination = {
      ...destination,
      name:
        destination.name ??
        'Destination'
    };

    this.destinationHistory.add(
      this.plannerDestination
    );

    this.plannerNavigationContext = context;

    this.plannerResults = [];
    this.plannerState = 'idle';
    this.plannerError = null;
    this.render();
    void this.#refreshTransitAvailability();

    this.map.showSelectionPin?.(
      destination.lat,
      destination.lon
    );

    this.map.focus?.(
      destination.lat,
      destination.lon,
      15
    );

    if (this.#plannerStart()) {
      void this.previewPlannedRoute();
    }
  }

  async searchPlanner(query) {
    const rawQuery =
      String(query ?? '');

    const normalizedQuery =
      rawQuery
        .trim()
        .replace(/\s+/g, ' ');

    this.plannerQuery = rawQuery;
    this.plannerError = null;

    if (normalizedQuery.length < 2) {
      this.plannerState = 'idle';
      this.plannerResults = [];
      this.plannerError =
        'Type at least two characters.';
      this.render();
      return [];
    }

    const origin = this.#plannerStart();
    const searchAnchor =
      origin ?? this.searchAnchorProvider?.();

    if (!searchAnchor) {
      this.plannerState = 'idle';
      this.plannerResults = [];
      this.plannerError =
        'Move the map to an area to search, or enable GPS.';
      this.render();
      return [];
    }

    const request = this.plannerRequest;
    this.plannerState = 'loading';

    try {
      const results =
        await this.destinationSearch(
          normalizedQuery,
          searchAnchor,
          { limit: 12 }
        );

      if (request !== this.plannerRequest) {
        return [];
      }

      this.plannerResults = results;
      this.plannerState = 'ready';

      if (!results.length) {
        this.plannerError =
          'No offline places matched. You can pick the destination on the map.';
      }

      this.render();
      return results;
    } catch (error) {
      if (request !== this.plannerRequest) {
        return [];
      }

      console.error(error);

      this.plannerState = 'error';
      this.plannerResults = [];
      this.plannerError =
        error.message ??
        'Offline destination search is unavailable.';
      this.render();
      return [];
    }
  }

  async startTransitJourney(journey = this.getSelectedTransitJourney()) {
    if (!journey || this.transitJourneyStarting) {
      return false;
    }

    this.transitJourneyStarting = true;

    try {
      this.transitJourneyExecution =
        new TransitJourneyExecution(
          journey,
          { now: this.now }
        );

      this.map.clearSelectionPin?.();

      this.status?.(
        'Journey started',
        `${journey.sequence.length} legs`
      );

      await this.#activateTransitExecutionLeg();

      return true;
    } finally {
      this.transitJourneyStarting = false;
    }
  }

  async transitionTransitJourney(action) {
    if (!this.transitJourneyExecution) return false;
    const changed = this.transitJourneyExecution.transition(action);
    if (!changed) return false;
    await this.#activateTransitExecutionLeg();
    return true;
  }

  finishTransitJourney() {
    if (!this.transitJourneyExecution?.isComplete()) return false;
    this.transitJourneyExecution = null;
    this.transitWalkRequest += 1;
    this.map.clearRoute?.();
    this.status?.('Transit journey finished', this.plannerDestination?.name ?? 'Destination');
    this.render();
    return true;
  }

  cancelTransitJourney() {
    if (!this.transitJourneyExecution) {
      return false;
    }

    this.transitJourneyExecution = null;
    this.transitWalkRequest += 1;
    this.transitJourneySession = null;
    this.transitJourneyOptions = [];
    this.selectedTransitJourneyIndex = 0;

    if ('expandedTransitJourneyIndex' in this) {
      this.expandedTransitJourneyIndex = null;
    }

    this.#cancelRouteRequest();
    this.#cancelPreviewRequest();

    if (this.session.isActive()) {
      this.session.stop();
    }

    this.routeState = 'idle';
    this.routeError = null;
    this.lastRouteAt = 0;
    this.routeProgress = null;
    this.lastVoiceAnnouncement = null;
    this.navigationConfidenceState = 'normal';
    this.#resetOffRouteEvidence();
    this.routeChangedUntil = 0;
    this.previousRoute = null;
    this.arrivalState = null;
    this.navigationContext = null;
    this.trackPosition = true;

    this.transitArrivalEvidenceCount = 0;
    this.transitArrivalEvidenceSince = 0;

    this.map.clearRoute?.();
    this.map.clearManeuvers?.();
    this.map.setNavigationTravelMode?.(null);

    this.guidance?.hide();
    this.voice.stop();
    this.onActiveChange(false);

    this.previewRoute = null;
    this.previewState = 'idle';
    this.previewError = null;
    this.previewCollapsed = false;

    this.render();

    this.status?.(
      'Journey cancelled',
      'Returned to route planning.'
    );

    return true;
  }

  async #activateTransitExecutionLeg() {
    const execution = this.transitJourneyExecution;
    if (!execution) return;
    const state = execution.getState();

    if (state.completed) {
      this.transitWalkRequest += 1;

      this.#cancelRouteRequest();

      if (this.session.isActive()) {
        this.session.stop();
      }

      this.routeState = 'idle';
      this.routeError = null;
      this.routeProgress = null;
      this.arrivalState = null;
      this.navigationContext = null;
      this.lastVoiceAnnouncement = null;

      this.#resetTransitArrivalEvidence();

      this.guidance?.hide();
      this.voice.stop();

      this.map.clearRoute?.();
      this.map.clearManeuvers?.();
      this.map.setNavigationTravelMode?.(null);

      this.onActiveChange(false);

      this.status?.(
        'Destination reached',
        'All journey legs are complete.'
      );

      this.render();
      return;
    }

    const leg = state.leg;
    const points = (leg.points ?? []).filter(point =>
      Number.isFinite(point?.lat) && Number.isFinite(point?.lon)
    );

    if (leg.kind === 'walk' && points.length < 2) {
      this.transitWalkRequest += 1;
      this.#resetTransitArrivalEvidence();

      if (this.session.isActive()) {
        this.#cancelRouteRequest();
        this.session.stop();
      }

      this.routeState = 'idle';
      this.routeError = null;
      this.routeProgress = null;
      this.arrivalState = null;
      this.navigationContext = null;

      this.guidance?.hide();
      this.voice.stop();

      this.map.clearRoute?.();
      this.map.clearManeuvers?.();
      this.map.setNavigationTravelMode?.(null);

      this.status?.(
        'Walking leg',
        leg.toName ?? 'Continue to the next stop'
      );

      this.render();
      return;
    }

    if (leg.kind === 'walk' && points.length >= 2) {
      const request = ++this.transitWalkRequest;
      const origin = { ...points[0], name: leg.fromName ?? 'Walk start' };
      const destination = { ...points.at(-1), name: leg.toName ?? 'Next stop' };
      try {
        const route = await this.routingService.route(
          origin,
          destination,
          { profile: 'walk' }
        );

        if (
          request !== this.transitWalkRequest ||
          execution !== this.transitJourneyExecution
        ) {
          return;
        }

        this.session.start({
          origin,
          destination,
          route
        });

        this.trackPosition = true;
        this.routeState = 'ready';
        this.routeError = null;
        this.lastRouteAt = this.now();
        this.arrivalState = null;
        this.previousRoute = null;
        this.lastVoiceAnnouncement = null;

        this.navigationContext = {
          type: 'transit-walk-leg',
          legIndex: state.legIndex
        };

        this.routeProgress = route.maneuvers?.length
          ? findRouteProgress(origin, route)
          : null;

        this.#resetTransitArrivalEvidence();

        this.map.setNavigationTravelMode?.('walk');
        this.map.showRoute?.(route, { origin, destination });

        this.map.updateRouteProgress?.(
          route,
          this.routeProgress
        );

        this.map.showManeuvers?.(
          route.maneuvers ?? [],
          this.routeProgress?.nextManeuverIndex ?? 0
        );

        this.#renderGuidance();
      } catch (error) {
        if (
          request !== this.transitWalkRequest ||
          execution !== this.transitJourneyExecution
        ) {
          return;
        }

        console.error(error);

        this.map.showRoute?.({
          points,
          distanceMeters: leg.distanceMeters ?? 0,
          durationSeconds:
            Math.max(60, (leg.durationMinutes ?? 1) * 60),
          maneuvers: [],
          kind: 'walk'
        }, {
          origin,
          destination
        });
      }

      this.status?.(
        'Walking leg',
        leg.toName ?? 'Follow Atlas Navigation'
      );
    } else {
      this.transitWalkRequest += 1;
      this.#resetTransitArrivalEvidence();

      if (this.session.isActive()) {
        this.#cancelRouteRequest();
        this.session.stop();
      }

      this.routeState = 'idle';
      this.routeError = null;
      this.routeProgress = null;
      this.arrivalState = null;
      this.navigationContext = null;

      this.guidance?.hide();
      this.voice.stop();
      this.map.clearManeuvers?.();
      this.map.setNavigationTravelMode?.(null);

      if (points.length >= 2) {
        this.map.showRoute?.({
          points,
          distanceMeters:
            leg.distanceMeters ?? 0,
          durationSeconds:
            Math.max(
              60,
              (leg.durationMinutes ?? 1) * 60
            ),
          maneuvers: [],
          kind: 'transit-leg'
        }, {
          origin: {
            ...points[0],
            name:
              leg.fromName ?? 'Board here'
          },
          destination: {
            ...points.at(-1),
            name:
              leg.toName ?? 'Get off here'
          }
        });
      } else {
        this.map.clearRoute?.();
      }

      this.status?.(
        state.phase === 'riding'
          ? 'Riding'
          : 'Ready to board',
        [leg.line, leg.direction]
          .filter(Boolean)
          .join(' · ') ||
          leg.mode ||
          'Transit'
      );
    }

    this.render();
  }

  #renderTransitJourneyExecution() {
    const state = this.transitJourneyExecution.getState();
    const legEnd =
      state.leg?.points?.at?.(-1) ?? null;

    const distanceToLegEnd =
      this.currentPosition &&
      legEnd &&
      Number.isFinite(legEnd.lat) &&
      Number.isFinite(legEnd.lon)
        ? distanceMeters(this.currentPosition, legEnd)
        : null;

    const view = this.transitJourneyExecutionView.render({
      state,
      distanceToLegEnd,
      onAction: action => {
        void this.transitionTransitJourney(action);
      },
      onFinish: () => this.finishTransitJourney(),
      onCancel: () => this.cancelTransitJourney()
    });
    this.listElement.replaceChildren(view);
  }

  #transitPreviewRoute(journey) {
    const points = [];
    for (const step of journey?.sequence ?? []) {
      for (const point of step.points ?? []) {
        const previous = points.at(-1);
        if (!previous || previous.lat !== point.lat || previous.lon !== point.lon) {
          points.push({ lat: point.lat, lon: point.lon });
        }
      }
    }
    if (points.length < 2) {
      throw new Error('Transit provider did not return enough route geometry to preview this journey.');
    }
    const distanceMeters = (journey.legs ?? []).reduce(
      (total, leg) => total + (Number.isFinite(leg.distanceMeters) ? leg.distanceMeters : 0), 0
    );
    return {
      points,
      distanceMeters,
      durationSeconds: Math.max(60, journey.durationMinutes * 60),
      maneuvers: [],
      kind: 'transit',
      transitJourney: journey
    };
  }

  selectDriveRoute(index) {
    if (this.travelMode !== 'drive') {
      return false;
    }

    const option = this.driveRouteOptions[index];
    const origin = this.#plannerStart();
    const destination = this.plannerDestination;

    if (!option?.route || !origin || !destination) {
      return false;
    }

    this.selectedDriveRouteIndex = index;
    this.previewRoute = option.route;
    this.previewState = 'ready';
    this.previewError = null;
    this.previewCollapsed = false;

    this.map.showRoute?.(option.route, {
      origin,
      destination
    });

    this.render();
    this.#schedulePreviewCollapse();
    return true;
  }

  selectTransitJourney(index) {
    if (this.travelMode !== 'transit') {
      return false;
    }

    const journey =
      this.transitJourneyOptions[index];

    const origin =
      this.#plannerStart();

    const destination =
      this.plannerDestination;

    if (!journey || !origin || !destination) {
      return false;
    }

    const sameOption =
      this.selectedTransitJourneyIndex === index;

    if (
      sameOption &&
      this.expandedTransitJourneyIndex === index
    ) {
      this.expandedTransitJourneyIndex = null;
      this.render();
      return true;
    }

    this.selectedTransitJourneyIndex = index;
    this.expandedTransitJourneyIndex = index;

    this.previewRoute =
      this.#transitPreviewRoute(journey);

    this.previewState = 'ready';
    this.previewError = null;

    this.transitJourneySession = {
      journey,
      origin: { ...origin },
      destination: { ...destination },
      selectedAt: this.now()
    };

    this.map.showRoute?.(
      this.previewRoute,
      { origin, destination }
    );

    clearTimeout(this.previewCollapseTimer);

    this.render();

    void this.#enrichTransitJourneyOption(
      index,
      journey
    );

    this.status?.(
      'Transit option selected',
      `${journey.durationMinutes} min · ${journey.sequence.length} legs`
    );

    return true;
  }

  async #enrichTransitJourneyOption(
    index,
    journey
  ) {
    if (
      typeof this.transitBridge
        ?.enrichOperationalDetails !==
        'function'
    ) {
      return;
    }

    let enriched;

    try {
      enriched =
        await this.transitBridge
          .enrichOperationalDetails(
            journey
          );
    } catch {
      return;
    }

    if (
      this.selectedTransitJourneyIndex !==
        index ||
      this.expandedTransitJourneyIndex !==
        index
    ) {
      return;
    }

    this.transitJourneyOptions[index] =
      enriched;

    if (
      this.transitJourneySession?.journey ===
      journey
    ) {
      this.transitJourneySession = {
        ...this.transitJourneySession,
        journey: enriched
      };
    }

    this.render();
  }

  getSelectedTransitJourney() {
    return this.transitJourneySession?.journey ?? null;
  }

  async #resolveTransitProvider(origin, destination) {
    const request = ++this.transitAvailabilityRequest;

    if (!this.transitProviderRegistry) {
      const unavailable = {
        available: false,
        region: null,
        provider: null,
        reason: 'Public transport routing isn’t available in this region yet.'
      };

      this.transitAvailability = {
        status: 'unavailable',
        region: null,
        providerId: null,
        message: unavailable.reason
      };

      return unavailable;
    }

    const resolution = await this.transitProviderRegistry.resolve(
      origin,
      destination
    );

    if (request === this.transitAvailabilityRequest) {
      this.transitAvailability = resolution.available
        ? {
            status: 'available',
            region: resolution.region?.id ?? null,
            providerId: resolution.provider?.id ?? null,
            message: null
          }
        : {
            status: 'unavailable',
            region: resolution.region?.id ?? null,
            providerId: null,
            message: resolution.reason
          };
    }

    return resolution;
  }

  async #refreshTransitAvailability() {
    const origin = this.#plannerStart();
    const destination = this.plannerDestination;

    if (!origin || !destination) {
      this.transitAvailability = {
        status: 'unknown',
        region: null,
        providerId: null,
        message: null
      };
      return;
    }

    await this.#resolveTransitProvider(origin, destination);
    this.render();
  }

  async previewPlannedRoute() {
    const origin = this.#plannerStart();
    const destination = this.plannerDestination;

    if (!origin || !destination) {
      return false;
    }

    this.#cancelPreviewRequest();

    const request = ++this.previewRequest;
    const abortController = new AbortController();
    this.previewAbortController = abortController;
    this.previewState = 'loading';
    this.previewError = null;
    this.previewRoute = null;
    this.previewOrigin = null;
    this.previewCollapsed = false;
    clearTimeout(this.previewCollapseTimer);
    this.render();

    const promise = (async () => {
      try {
        let route;
        let driveRoutes = null;
        let transitJourneys = null;
        let transitSession = null;

        const requestedTravelMode =
          this.travelMode;

        if (requestedTravelMode === 'transit') {
          const transitResolution =
            await this.#resolveTransitProvider(origin, destination);

          if (!transitResolution.available) {
            throw new Error(transitResolution.reason);
          }

          const journeys =
            await transitResolution.provider.bridge.plan(
              origin,
              destination,
              {
                signal:
                  abortController.signal
              }
            );

          if (!journeys.length) {
            throw new Error(
              'No transit journeys were returned.'
            );
          }

          const scoredJourneys = journeys
            .map((journey, providerOrder) => {
              const sequence =
                Array.isArray(journey.sequence)
                  ? journey.sequence
                  : [];

              const transitSteps =
                sequence.filter(
                  step => step.kind === 'transit'
                );

              const walkingMinutes =
                sequence
                  .filter(step => step.kind === 'walk')
                  .reduce(
                    (total, step) =>
                      total +
                      Number(
                        step.durationMinutes ?? 0
                      ),
                    0
                  );

              const durationMinutes =
                Number(
                  journey.durationMinutes ?? 0
                );

              const transferCount =
                Number.isFinite(
                  Number(
                    journey.metrics?.transferCount
                  )
                )
                  ? Number(
                      journey.metrics.transferCount
                    )
                  : Math.max(
                      0,
                      transitSteps.length - 1
                    );

              const walkingOnly =
                transitSteps.length === 0;

              const lines =
                transitSteps
                  .map(step =>
                    String(step.line ?? '')
                      .trim()
                      .toLowerCase()
                  )
                  .filter(Boolean);

              const modes =
                transitSteps
                  .map(step =>
                    String(step.mode ?? '')
                      .trim()
                      .toLowerCase()
                  )
                  .filter(Boolean);

              const rankingScore =
                Number.isFinite(journey.score)
                  ? journey.score
                  : (
                      durationMinutes +
                      walkingMinutes +
                      transferCount * 8 +
                      (walkingOnly ? 20 : 0)
                    );

              return {
                journey,
                providerOrder,
                durationMinutes,
                walkingMinutes,
                transferCount,
                walkingOnly,
                lines,
                modes,
                rankingScore
              };
            })
            .sort((a, b) =>
              a.rankingScore - b.rankingScore ||
              a.transferCount - b.transferCount ||
              a.walkingMinutes - b.walkingMinutes ||
              a.durationMinutes - b.durationMinutes ||
              a.providerOrder - b.providerOrder
            );

          const transitCandidates =
            scoredJourneys.filter(
              candidate => !candidate.walkingOnly
            );

          const walkingCandidates =
            scoredJourneys.filter(
              candidate => candidate.walkingOnly
            );

          const selectedCandidates = [];
          const selectedJourneys = new Set();
          const selectedRailLines = new Set();

          const railLikeModes = new Set([
            'tube',
            'underground',
            'overground',
            'elizabeth-line',
            'dlr',
            'national-rail',
            'rail'
          ]);

          const primaryRailLine = candidate => {
            for (
              let index = 0;
              index < candidate.modes.length;
              index += 1
            ) {
              if (
                railLikeModes.has(
                  candidate.modes[index]
                )
              ) {
                return (
                  candidate.lines[index] ??
                  candidate.modes[index]
                );
              }
            }

            return candidate.lines[0] ?? '';
          };

          if (transitCandidates.length) {
            const best =
              transitCandidates[0];

            selectedCandidates.push(best);
            selectedJourneys.add(best.journey);

            const line =
              primaryRailLine(best);

            if (line) {
              selectedRailLines.add(line);
            }
          }

          const competitiveTransit =
            transitCandidates.filter(
              candidate =>
                !selectedJourneys.has(
                  candidate.journey
                )
            );

          const diverseCandidate =
            competitiveTransit.find(
              candidate => {
                const line =
                  primaryRailLine(candidate);

                return (
                  line &&
                  !selectedRailLines.has(line)
                );
              }
            );

          const secondCandidate =
            diverseCandidate ??
            competitiveTransit[0];

          if (secondCandidate) {
            selectedCandidates.push(
              secondCandidate
            );

            selectedJourneys.add(
              secondCandidate.journey
            );

            const line =
              primaryRailLine(secondCandidate);

            if (line) {
              selectedRailLines.add(line);
            }
          }

          const remainingTransit =
            competitiveTransit.filter(
              candidate =>
                !selectedJourneys.has(
                  candidate.journey
                )
            );

          const thirdDiverse =
            remainingTransit.find(
              candidate => {
                const line =
                  primaryRailLine(candidate);

                return (
                  line &&
                  !selectedRailLines.has(line)
                );
              }
            );

          const thirdTransit =
            thirdDiverse ??
            remainingTransit[0];

          if (
            thirdTransit &&
            selectedCandidates.length < 3
          ) {
            selectedCandidates.push(
              thirdTransit
            );

            selectedJourneys.add(
              thirdTransit.journey
            );
          }

          if (
            selectedCandidates.length < 3 &&
            walkingCandidates.length
          ) {
            selectedCandidates.push(
              walkingCandidates[0]
            );
          }

          for (const candidate of scoredJourneys) {
            if (selectedCandidates.length >= 3) {
              break;
            }

            if (
              selectedCandidates.some(
                selected =>
                  selected.journey ===
                  candidate.journey
              )
            ) {
              continue;
            }

            selectedCandidates.push(candidate);
          }

          const rankedJourneys =
            selectedCandidates.map(
              candidate => candidate.journey
            );

          route =
            this.#transitPreviewRoute(
              rankedJourneys[0]
            );

          transitJourneys = rankedJourneys;

          transitSession = {
            journey: rankedJourneys[0],
            origin: { ...origin },
            destination: { ...destination },
            selectedAt: this.now()
          };
        } else if (requestedTravelMode === 'drive') {
          if (typeof this.routingService.driveOptions === 'function') {
            driveRoutes =
              await this.routingService.driveOptions(
                origin,
                destination,
                {
                  signal:
                    abortController.signal,
                  vehicleClass: 1
                }
              );
          } else {
            const fallbackRoute =
              await this.routingService.route(
                origin,
                destination,
                {
                  signal:
                    abortController.signal,
                  profile: 'drive'
                }
              );

            driveRoutes = [{
              kind: 'fastest',
              label: 'Fastest',
              recommended: true,
              route: fallbackRoute
            }];
          }

          if (!driveRoutes.length) {
            throw new Error(
              'No legal car route connects these endpoints.'
            );
          }

          const recommendedIndex =
            driveRoutes.findIndex(
              option => option.recommended
            );

          this.selectedDriveRouteIndex =
            recommendedIndex >= 0
              ? recommendedIndex
              : 0;

          route =
            driveRoutes[
              this.selectedDriveRouteIndex
            ].route;
        } else {
          route =
            await this.routingService.route(
              origin,
              destination,
              {
                signal:
                  abortController.signal,
                profile:
                  requestedTravelMode
              }
            );
        }

        if (
          request !== this.previewRequest ||
          this.session.isActive() ||
          this.travelMode !== requestedTravelMode
        ) {
          return false;
        }

        if (requestedTravelMode === 'drive') {
          this.driveRouteOptions =
            driveRoutes ?? [];
        } else {
          this.driveRouteOptions = [];
          this.selectedDriveRouteIndex = 0;
        }

        if (requestedTravelMode === 'transit') {
          this.transitJourneyOptions =
            transitJourneys;

          this.selectedTransitJourneyIndex =
            0;

          this.expandedTransitJourneyIndex =
            null;

          this.transitJourneySession =
            transitSession;
        } else {
          this.transitJourneyOptions = [];
          this.selectedTransitJourneyIndex =
            0;
          this.expandedTransitJourneyIndex = null;
          this.transitJourneySession = null;
        }

        this.previewRoute = route;
        this.previewOrigin = {
          lat: origin.lat,
          lon: origin.lon
        };
        this.previewState = 'ready';
        this.previewError = null;

        this.map.clearSelectionPin?.();
        this.map.showRoute?.(route, {
          origin,
          destination
        });

        this.render();
        this.#refitPreviewRoute();
        this.#schedulePreviewCollapse();

        this.status?.(
          this.travelMode === 'transit' ? 'Transit options ready' : 'Route preview ready',
          `${this.#formatDistance(route.distanceMeters)} · ${this.#formatDuration(route.durationSeconds)}`
        );

        return true;
      } catch (error) {
        if (
          error.name === 'AbortError' ||
          request !== this.previewRequest
        ) {
          return false;
        }

        console.error(error);

        this.previewRoute = null;
        this.previewState = 'error';

        if (this.travelMode === 'transit') {
          this.transitJourneyOptions = [];
          this.selectedTransitJourneyIndex = 0;
          this.expandedTransitJourneyIndex = null;
          this.transitJourneySession = null;

          const message =
            String(error?.message ?? '');

          if (
            message.includes(
              'No transit journeys were returned'
            )
          ) {
            this.previewError =
              'No transit journey found for this route.';
          } else if (
            message.includes(
              'TfL journey request failed'
            ) ||
            message.includes(
              'Failed to fetch'
            ) ||
            message.includes(
              'NetworkError'
            )
          ) {
            this.previewError =
              'Public transport service is temporarily unavailable.';
          } else if (
            message.includes(
              'TfL returned invalid JSON'
            )
          ) {
            this.previewError =
              'The public transport provider returned an invalid response.';
          } else if (
            message.includes(
              'TfL geometry unsupported'
            )
          ) {
            this.previewError =
              'Transit route details could not be processed.';
          } else {
            this.previewError =
              message ||
              'Transit planning is unavailable.';
          }
        } else {
          this.previewError =
            error.message ??
            'No route could be calculated.';
        }

        this.map.clearRoute?.();
        this.render();
        return false;
      } finally {
        if (request === this.previewRequest) {
          this.previewAbortController = null;
          this.previewPromise = null;
        }
      }
    })();

    this.previewPromise = promise;
    return promise;
  }

  previewRouteOnMap() {
    if (
      !this.previewRoute ||
      this.session.isActive()
    ) {
      return false;
    }

    clearTimeout(this.previewCollapseTimer);

    this.#setPreviewCollapsed(true);

    return true;
  }

  expandRoutePreview() {
    if (!this.previewRoute || this.session.isActive()) {
      return false;
    }

    this.#setPreviewCollapsed(false);
    this.#schedulePreviewCollapse();
    return true;
  }

  async startPlannedRoute() {
    const origin = this.#plannerStart();
    const destination = this.plannerDestination;

    if (!origin || !destination) {
      this.plannerError = !origin
        ? 'Enable GPS or pick a starting point.'
        : 'Search for or pick a destination.';
      this.render();
      return false;
    }

    if (this.travelMode === 'transit') {
      if (
        this.previewState === 'loading' &&
        this.previewPromise
      ) {
        await this.previewPromise;
      }

      if (this.travelMode !== 'transit') {
        return false;
      }

      if (!this.previewRoute) {
        const ready =
          await this.previewPlannedRoute();

        if (!ready || !this.previewRoute) {
          return false;
        }
      }

      if (this.travelMode !== 'transit') {
        return false;
      }

      const currentOrigin =
        this.#plannerStart();

      const currentDestination =
        this.plannerDestination;

      const transitSession =
        this.transitJourneySession;

      if (
        !currentOrigin ||
        !currentDestination ||
        !transitSession
      ) {
        return false;
      }

      const samePoint = (a, b) =>
        Number.isFinite(a?.lat) &&
        Number.isFinite(a?.lon) &&
        Number.isFinite(b?.lat) &&
        Number.isFinite(b?.lon) &&
        a.lat === b.lat &&
        a.lon === b.lon;

      if (
        this.plannerOrigin &&
        !samePoint(
          currentOrigin,
          transitSession.origin
        )
      ) {
        return false;
      }

      if (
        !samePoint(
          currentDestination,
          transitSession.destination
        )
      ) {
        return false;
      }

      const selected =
        this.transitJourneyOptions[
          this.selectedTransitJourneyIndex
        ];

      if (
        !selected ||
        transitSession.journey !== selected
      ) {
        return false;
      }

      return this.startTransitJourney(
        selected
      );
    }

    if (this.previewState === 'loading' && this.previewPromise) {
      await this.previewPromise;
    }

    if (!this.previewRoute) {
      const ready = await this.previewPlannedRoute();
      if (!ready || !this.previewRoute) {
        return false;
      }
    }

    if (this.plannerOrigin === null) {
      const latestOrigin = this.#plannerStart();
      const previewOrigin = this.previewOrigin;

      const movedMeters = (
        latestOrigin &&
        previewOrigin &&
        Number.isFinite(latestOrigin.lat) &&
        Number.isFinite(latestOrigin.lon) &&
        Number.isFinite(previewOrigin.lat) &&
        Number.isFinite(previewOrigin.lon)
      )
        ? (() => {
            const toRadians = value => value * Math.PI / 180;
            const earthRadiusMeters = 6371000;
            const dLat = toRadians(
              latestOrigin.lat - previewOrigin.lat
            );
            const dLon = toRadians(
              latestOrigin.lon - previewOrigin.lon
            );
            const lat1 = toRadians(previewOrigin.lat);
            const lat2 = toRadians(latestOrigin.lat);

            const a =
              Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1) *
              Math.cos(lat2) *
              Math.sin(dLon / 2) ** 2;

            return earthRadiusMeters * 2 *
              Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          })()
        : Infinity;

      if (movedMeters > 25) {
        const ready = await this.previewPlannedRoute();

        if (!ready || !this.previewRoute) {
          return false;
        }
      }
    }

    const startOrigin = this.#plannerStart();
    const route = this.previewRoute;

    if (!startOrigin || !route) {
      return false;
    }

    this.#cancelPreviewRequest();
    clearTimeout(this.previewCollapseTimer);

    this.session.start({
      origin: startOrigin,
      destination,
      route
    });
    this.navigationContext = this.plannerNavigationContext;
    this.arrivalState = null;
    this.trackPosition = this.plannerOrigin === null;
    this.routeState = 'ready';
    this.routeError = null;
    this.lastRouteAt = this.now();
    this.lastVoiceAnnouncement = null;
    this.routeProgress = route.maneuvers?.length
      ? findRouteProgress(startOrigin, route)
      : null;

    this.previewRoute = null;
    this.previewOrigin = null;
    this.previewState = 'idle';
    this.previewError = null;
    this.previewCollapsed = false;

    this.onActiveChange(true, {
      trackPosition: this.trackPosition
    });

    this.map.updateRouteProgress?.(
      route,
      this.routeProgress
    );
    this.map.showManeuvers?.(
      route.maneuvers ?? [],
      this.routeProgress?.nextManeuverIndex ?? 0
    );
    this.#renderGuidance();
    this.#announceGuidance();
    this.render();

    this.status?.(
      'Navigation started',
      `${this.#formatDistance(route.distanceMeters)} · ${this.#formatDuration(route.durationSeconds)}`
    );

    return true;
  }

  render() {
    if (this.transitJourneyExecution) {
      this.#renderTransitJourneyExecution();
      return;
    }

    const {
      origin,
      destination
    } = this.session.getState();

    if (
      !this.session.isActive() ||
      !origin ||
      !destination
    ) {
      this.#renderPlanner();
      return;
    }

    this.listElement.replaceChildren();
  }

  #renderPlanner() {
    const state = this.getPlannerState();
    const activeElement =
      this.document.activeElement;

    const restoreSearchFocus =
      activeElement?.matches?.(
        '[data-navigation-query-input]'
      ) === true;

    const selectionStart =
      restoreSearchFocus
        ? activeElement.selectionStart
        : null;

    const selectionEnd =
      restoreSearchFocus
        ? activeElement.selectionEnd
        : null;

    const view = this.plannerView.render({
      ...state,
      onUseGps:
        () => this.useCurrentLocation(),
      onTravelMode:
        mode => this.setTravelMode(mode),
      onPick:
        kind => this.beginMapPick(kind),
      onSwap:
        () => this.swapPlannerEndpoints(),
      onOpenAdvancedPlanner:
        () => this.openAdvancedPlanner({ focus: 'destination' }),
      onCloseAdvancedPlanner:
        () => this.closeAdvancedPlanner(),
      onQuery:
        query => this.updatePlannerQuery(query),
      onClear:
        () => this.clearPlannerSearch(),
      onSearch:
        query => {
          void this.searchPlanner(query);
        },
      onSelect:
        index => {
          const place =
            this.plannerResults[index];

          if (!place) {
            return;
          }

          if (this.plannerSearchTarget === 'origin') {
            this.setPlannerOrigin(place);
          } else {
            this.setPlannerDestination(place);
          }
        },
      onActivateEndpoint:
        kind => this.activatePlannerEndpoint(kind),
      onSelectRecent:
        index => {
          const destination =
            state.recent[index];

          if (destination) {
            this.setPlannerDestination(destination);
          }
        },
      onChangeDestination:
        () => this.openDestinationSearch(),
      onBookmarkDestination:
        () => {
          const destination =
            this.plannerDestination;

          if (destination) {
            this.onBookmarkDestination(destination);
          }
        },
      onPreviewMap:
        () => this.previewRouteOnMap(),
      onExpandPreview:
        () => this.expandRoutePreview(),
      onSelectDriveRoute:
        index => this.selectDriveRoute(index),
      onSelectTransitJourney:
        index => this.selectTransitJourney(index),
      onStart:
        () => {
          void this.startPlannedRoute();
        },
      onRetryPreview:
        () => {
          void this.previewPlannedRoute();
        }
    });

    this.listElement.replaceChildren(view);

    if (restoreSearchFocus) {
      const input = view.querySelector?.(
        '[data-navigation-query-input]'
      );

      input?.focus?.({
        preventScroll: true
      });

      if (
        input?.setSelectionRange &&
        Number.isInteger(selectionStart) &&
        Number.isInteger(selectionEnd)
      ) {
        input.setSelectionRange(
          selectionStart,
          selectionEnd
        );
      }
    }
  }
  #plannerStart() {
    return this.plannerOrigin ??
      this.currentPosition;
  }

  #validatePlannerPoint(point) {
    if (
      !Number.isFinite(point?.lat) ||
      !Number.isFinite(point?.lon)
    ) {
      throw new TypeError(
        'Navigation point requires lat and lon.'
      );
    }
  }

  #formatCoordinates(point) {
    return `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
  }

  async #calculateRoute({
    preserveCurrentRoute
  }) {
    const {
      origin,
      destination
    } = this.session.getState();

    if (!origin || !destination) {
      return false;
    }

    if (this.travelMode === 'transit') {
      return false;
    }

    this.#cancelRouteRequest();

    const request =
      ++this.routeRequest;

    const abortController =
      new AbortController();

    this.routeAbortController =
      abortController;

    this.routeState = 'loading';
    this.routeError = null;
    this.render();

    if (preserveCurrentRoute) {
      this.navigationConfidenceState = 'checking';
      this.#renderGuidance();
      this.status?.(
        'Checking route',
        'Deviation confirmed. Calculating an updated offline route.'
      );
    } else {
      this.guidance?.showLoading(
        destination.name ?? 'Destination'
      );
    }

    try {
      const route =
        await this.routingService.route(
          origin,
          destination,
          {
            signal:
              abortController.signal,
            profile: this.travelMode
          }
        );

      if (
        request !== this.routeRequest ||
        !this.session.isActive()
      ) {
        return false;
      }

      this.session.setRoute(route);
      this.routeState = 'ready';
      this.routeError = null;
      this.lastRouteAt = this.now();
      this.lastVoiceAnnouncement = null;

      if (preserveCurrentRoute) {
        this.navigationConfidenceState = 'changed';
        this.routeChangedUntil = this.now() + ROUTE_CHANGED_NOTICE_MS;
      } else {
        this.navigationConfidenceState = 'normal';
        this.previousRoute = null;
      }

      this.routeProgress =
        route.maneuvers?.length
          ? findRouteProgress(
              origin,
              route
            )
          : null;

      this.map.showRoute?.(
        route,
        {
          origin,
          destination
        }
      );

      this.map.updateRouteProgress?.(
        route,
        this.routeProgress
      );

      this.#renderGuidance();
      this.#announceGuidance();

      this.map.showManeuvers?.(
        route.maneuvers ?? [],
        this.routeProgress
          ?.nextManeuverIndex ?? 0
      );

      this.render();

      this.status?.(
        preserveCurrentRoute
          ? 'Route changed'
          : 'Offline route ready',
        `${this.#formatDistance(
          route.distanceMeters
        )} · ${this.#formatDuration(
          route.durationSeconds
        )}`
      );

      return true;
    } catch (error) {
      if (
        error.name === 'AbortError' ||
        request !== this.routeRequest
      ) {
        return false;
      }

      console.error(error);

      if (
        preserveCurrentRoute &&
        this.session.getState().route
      ) {
        this.routeState = 'ready';

        this.#renderGuidance();

        this.status?.(
          'Route update unavailable',
          error.message ??
            'The previous route remains active.'
        );
      } else {
        this.routeState = 'error';
        this.routeError =
          error.message ??
          'No route could be calculated.';

        this.map.clearRoute?.();

        this.guidance?.showError(
          this.routeError
        );

        this.status?.(
          'Offline route unavailable',
          this.routeError
        );
      }

      this.render();
      return false;
    } finally {
      if (request === this.routeRequest) {
        this.routeAbortController = null;
      }
    }
  }

  #setPreviewCollapsed(collapsed) {
    if (
      !this.previewRoute ||
      this.session.isActive() ||
      this.previewCollapsed === collapsed
    ) {
      return;
    }

    this.previewCollapsed = collapsed;
    this.render();
    this.#refitPreviewRoute();
  }

  #refitPreviewRoute() {
    if (
      !this.previewRoute ||
      this.session.isActive()
    ) {
      return;
    }

    const refit = () =>
      this.map.fitRoute?.(
        this.previewRoute
      );

    if (
      typeof globalThis.requestAnimationFrame ===
      'function'
    ) {
      globalThis.requestAnimationFrame(refit);
      return;
    }

    setTimeout(refit, 0);
  }

  #schedulePreviewCollapse() {
    clearTimeout(this.previewCollapseTimer);

    if (!this.previewRoute || this.previewCollapsed) {
      return;
    }

    this.previewCollapseTimer = setTimeout(
      () => this.#setPreviewCollapsed(true),
      ROUTE_PREVIEW_COLLAPSE_MS
    );
  }

  #cancelPreviewRequest() {
    this.previewAbortController?.abort();
    this.previewAbortController = null;
    this.previewPromise = null;
  }

  #resetPreview({ clearRoute = false } = {}) {
    this.#cancelPreviewRequest();
    this.previewRequest += 1;
    clearTimeout(this.previewCollapseTimer);

    this.previewRoute = null;
    this.previewState = 'idle';
    this.previewError = null;
    this.previewCollapsed = false;

    this.driveRouteOptions = [];
    this.selectedDriveRouteIndex = 0;

    this.transitJourneyOptions = [];
    this.selectedTransitJourneyIndex = 0;
    this.expandedTransitJourneyIndex = null;
    this.transitJourneySession = null;

    if (clearRoute && !this.session.isActive()) {
      this.map.clearRoute?.();
    }
  }

  #cancelRouteRequest() {
    this.routeAbortController?.abort();
    this.routeAbortController = null;
  }

  #renderGuidance() {
    const {
      route,
      destination
    } = this.session.getState();

    if (
      !this.guidance ||
      !route ||
      !this.routeProgress
    ) {
      return;
    }

    if (
      this.navigationConfidenceState === 'changed' &&
      this.now() >= this.routeChangedUntil
    ) {
      this.navigationConfidenceState = 'normal';
      this.previousRoute = null;
    }

    const approachingDestination =
      this.routeProgress.remainingDistanceMeters <=
        APPROACHING_DESTINATION_METERS &&
      this.routeProgress.nextManeuver?.type === 'arrive';

    if (approachingDestination) {
      this.guidance.showApproaching({
        destinationName:
          destination?.name ?? 'Destination',
        remainingDistanceMeters:
          this.routeProgress.remainingDistanceMeters
      });
      return;
    }

    const activeGuidanceTravelMode =
      this.navigationContext?.type === 'transit-walk-leg'
        ? 'walk'
        : this.travelMode;

    this.guidance.showRoute({
      route,
      progress: this.routeProgress,
      destinationName:
        destination?.name ??
        'Destination',
      navigationState: this.navigationConfidenceState,
      canUndoRoute:
        this.navigationConfidenceState === 'changed' &&
        Boolean(this.previousRoute),
      travelMode: activeGuidanceTravelMode,
      laneGuidanceEnabled: this.laneGuidanceEnabled
    });
  }

  #setNavigationConfidenceState(state) {
    if (this.navigationConfidenceState === state) {
      return;
    }

    this.navigationConfidenceState = state;
    this.#renderGuidance();

    if (state === 'reduced') {
      this.status?.(
        'GPS accuracy reduced',
        'Staying on the current route while the signal settles.'
      );
    } else if (state === 'checking') {
      this.status?.(
        'Checking route',
        'Possible deviation detected.'
      );
    }
  }

  #updateRerouteArming(position, now) {
    if (this.rerouteArmed) {
      return true;
    }

    if (
      Number.isFinite(position?.accuracy) &&
      position.accuracy > REROUTE_ARM_MAX_ACCURACY_METERS
    ) {
      this.rerouteArmEvidenceCount = 0;
      this.rerouteArmEvidenceSince = 0;
      return false;
    }

    if (!this.rerouteArmReferencePosition) {
      this.rerouteArmReferencePosition = {
        lat: position.lat,
        lon: position.lon
      };
      return false;
    }

    const displacement = distanceMeters(
      this.rerouteArmReferencePosition,
      position
    );

    const movementThreshold = Math.max(
      REROUTE_ARM_DISPLACEMENT_METERS,
      Number.isFinite(position?.accuracy)
        ? position.accuracy * 2
        : 0
    );

    const moving =
      (
        Number.isFinite(position?.speed) &&
        position.speed >= REROUTE_ARM_SPEED_METERS_PER_SECOND
      ) ||
      displacement >= movementThreshold;

    if (!moving) {
      this.rerouteArmEvidenceCount = 0;
      this.rerouteArmEvidenceSince = 0;
      return false;
    }

    if (!this.rerouteArmEvidenceSince) {
      this.rerouteArmEvidenceSince = now;
      this.rerouteArmEvidenceCount = 1;
      return false;
    }

    this.rerouteArmEvidenceCount += 1;

    if (
      this.rerouteArmEvidenceCount < REROUTE_ARM_CONFIRMATION_FIXES ||
      now - this.rerouteArmEvidenceSince < REROUTE_ARM_CONFIRMATION_MS
    ) {
      return false;
    }

    this.rerouteArmed = true;
    this.rerouteArmReferencePosition = null;
    this.rerouteArmEvidenceCount = 0;
    this.rerouteArmEvidenceSince = 0;
    return true;
  }

  #resetRerouteArming() {
    this.rerouteArmed = false;
    this.rerouteArmReferencePosition = null;
    this.rerouteArmEvidenceCount = 0;
    this.rerouteArmEvidenceSince = 0;
  }

  #resetOffRouteEvidence() {
    this.offRouteEvidenceCount = 0;
    this.offRouteEvidenceSince = 0;
  }

  #toggleVoice() {
    if (!this.voice.isSupported()) {
      this.status?.(
        'Voice guidance unavailable',
        'Install an offline Android text-to-speech voice to use spoken directions.'
      );
      return;
    }

    const enabled = this.voice.toggle();

    this.lastVoiceAnnouncement = null;
    this.#renderGuidance();
    this.render();

    if (enabled) {
      this.#announceGuidance();
    }

    this.status?.(
      enabled
        ? 'Voice guidance on'
        : 'Voice guidance off',
      enabled
        ? 'Directions will use an installed device voice.'
        : ''
    );
  }

  #announceGuidance() {
    if (
      !this.voice.isEnabled() ||
      !this.routeProgress?.nextManeuver
    ) {
      return;
    }

    const distance =
      this.routeProgress
        .distanceToManeuverMeters;

    let stage = null;

    if (distance <= 35) {
      stage = 'now';
    } else if (distance <= 150) {
      stage = 'soon';
    } else if (distance <= 500) {
      stage = 'prepare';
    }

    if (!stage) {
      return;
    }

    const maneuver =
      this.routeProgress.nextManeuver;

    const key = `${maneuver.id}:${stage}`;

    if (key === this.lastVoiceAnnouncement) {
      return;
    }

    this.lastVoiceAnnouncement = key;

    this.voice.speak(
      spokenInstruction(
        maneuver,
        distance
      )
    );
  }

  #distanceFromRoute(position, points) {
    if (!points?.length) {
      return Infinity;
    }

    if (points.length === 1) {
      return distanceMeters(
        position,
        points[0]
      );
    }

    const metersPerLatitudeDegree =
      111_320;

    const metersPerLongitudeDegree =
      metersPerLatitudeDegree *
      Math.max(
        Math.cos(
          position.lat * Math.PI / 180
        ),
        0.01
      );

    let nearestSquared = Infinity;

    for (
      let index = 1;
      index < points.length;
      index += 1
    ) {
      const start = points[index - 1];
      const end = points[index];

      const startX =
        (start.lon - position.lon) *
        metersPerLongitudeDegree;

      const startY =
        (start.lat - position.lat) *
        metersPerLatitudeDegree;

      const segmentX =
        (end.lon - start.lon) *
        metersPerLongitudeDegree;

      const segmentY =
        (end.lat - start.lat) *
        metersPerLatitudeDegree;

      const segmentSquared =
        segmentX * segmentX +
        segmentY * segmentY;

      const projection =
        segmentSquared > 0
          ? Math.max(
              0,
              Math.min(
                1,
                -(
                  startX * segmentX +
                  startY * segmentY
                ) / segmentSquared
              )
            )
          : 0;

      const nearestX =
        startX + projection * segmentX;

      const nearestY =
        startY + projection * segmentY;

      nearestSquared = Math.min(
        nearestSquared,
        nearestX * nearestX +
          nearestY * nearestY
      );
    }

    return Math.sqrt(nearestSquared);
  }

  #formatDistance(distance) {
    if (distance < 1000) {
      return `${Math.round(distance)} m`;
    }

    return `${(
      distance / 1000
    ).toFixed(1)} km`;
  }

  #formatDuration(durationSeconds) {
    const totalMinutes = Math.max(
      1,
      Math.round(durationSeconds / 60)
    );

    if (totalMinutes < 60) {
      return `${totalMinutes} min`;
    }

    const hours = Math.floor(
      totalMinutes / 60
    );

    const minutes = totalMinutes % 60;

    return minutes
      ? `${hours} h ${minutes} min`
      : `${hours} h`;
  }
}
