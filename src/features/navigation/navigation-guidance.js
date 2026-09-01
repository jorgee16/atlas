import {
  escapeHtml
} from '../../utils.js';

import {
  maneuverIconSvg
} from './maneuver-icons.js';

function formatDistance(distanceMeters) {
  if (distanceMeters < 100) {
    return `${Math.max(0, Math.round(distanceMeters / 10) * 10)} m`;
  }

  if (distanceMeters < 1_000) {
    return `${Math.round(distanceMeters / 50) * 50} m`;
  }

  const digits = distanceMeters < 10_000 ? 1 : 0;
  return `${(distanceMeters / 1_000).toFixed(digits)} km`;
}

function formatManeuverDistance(distanceMeters) {
  if (Number.isFinite(distanceMeters) && distanceMeters <= 20) {
    return 'Now';
  }

  return formatDistance(distanceMeters);
}

function formatDuration(durationSeconds) {
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

function formatEta(durationSeconds, now) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(now + durationSeconds * 1_000));
}

function maneuverRoad(maneuver) {
  return [maneuver?.roadName, maneuver?.roadRef]
    .filter(Boolean)
    .join(' · ');
}

function drivingManeuverLabel(maneuver) {
  if (!maneuver) return '';

  const road = maneuverRoad(maneuver);
  const destination = String(maneuver.destination ?? '').trim();
  const exitRef = String(
    maneuver.exitRef ?? maneuver.junctionRef ?? ''
  ).trim();

  if (exitRef) {
    return [
      `Exit ${exitRef}`,
      destination || road
    ].filter(Boolean).join(' · ');
  }

  if (destination) {
    const rampLike =
      maneuver.type === 'off-ramp' ||
      maneuver.type === 'on-ramp' ||
      maneuver.type === 'exit' ||
      /^Take the ramp\b/i.test(maneuver.instruction ?? '');

    if (rampLike) {
      return `Toward ${destination}`;
    }

    return road
      ? `${road} · ${destination}`
      : `Toward ${destination}`;
  }

  return road;
}

function laneTokens(maneuver) {
  const source = maneuver?.lanes ?? maneuver?.turnLanes ?? maneuver?.turn_lanes;
  if (!source) return [];

  const lanes = Array.isArray(source)
    ? source
    : String(source).split('|');

  return lanes.map((lane, index) => {
    if (typeof lane === 'object' && lane) {
      const indication = lane.indication ?? lane.turn ?? lane.direction ?? 'straight';
      return {
        indication: String(indication),
        recommended: lane.recommended === true || lane.active === true || lane.valid === true
      };
    }

    const indication = String(lane).split(';')[0] || 'straight';
    const recommendedIndex = maneuver?.recommendedLaneIndex ?? maneuver?.laneIndex;
    return {
      indication,
      recommended: Number.isInteger(recommendedIndex) && recommendedIndex === index
    };
  });
}

function laneArrow(indication) {
  const value = String(indication ?? '').toLowerCase();
  if (value.includes('uturn') || value.includes('u_turn')) return '↶';
  if (value.includes('slight_right')) return '↗';
  if (value.includes('slight_left')) return '↖';
  if (value.includes('right')) return '→';
  if (value.includes('left')) return '←';
  return '↑';
}

function shouldExpandGuidance(maneuver, distanceMeters) {
  if (laneTokens(maneuver).length > 1 && distanceMeters <= 350) return true;
  if (distanceMeters > 220) return false;

  return new Set([
    'roundabout', 'rotary', 'exit-roundabout',
    'fork', 'merge', 'off-ramp', 'on-ramp', 'exit'
  ]).has(maneuver?.type);
}

function laneGuidanceHtml(maneuver) {
  const lanes = laneTokens(maneuver);
  if (lanes.length < 2) return '';

  return `
    <div class="navigation-lane-guidance" aria-label="Lane guidance">
      ${lanes.map(lane => `
        <span class="navigation-lane${lane.recommended ? ' is-recommended' : ''}">
          ${laneArrow(lane.indication)}
        </span>
      `).join('')}
    </div>
  `;
}

function confidenceNotice(state) {
  switch (state) {
    case 'reduced':
      return {
        className: 'navigation-confidence--reduced',
        title: 'GPS accuracy reduced',
        detail: 'Staying on the current route while the signal settles.'
      };
    case 'checking':
      return {
        className: 'navigation-confidence--checking',
        title: 'Checking route',
        detail: 'Possible deviation detected. Keeping your current route for now.'
      };
    case 'changed':
      return {
        className: 'navigation-confidence--changed',
        title: 'Route changed',
        detail: 'A new offline route is active.'
      };
    default:
      return null;
  }
}

export class NavigationGuidance {
  constructor({
    element,
    onStop,
    onToggleVoice = null,
    onUndoRoute = null,
    onArrivalAction = null,
    onTravelMode = null,
    voiceState = () => ({ enabled: false, supported: false }),
    now = () => Date.now()
  }) {
    if (!element) {
      throw new TypeError('NavigationGuidance requires an element.');
    }

    this.element = element;
    this.onStop = onStop;
    this.onToggleVoice = onToggleVoice;
    this.onUndoRoute = onUndoRoute;
    this.onArrivalAction = onArrivalAction;
    this.onTravelMode = onTravelMode;
    this.modeSwitcherOpen = false;
    this.voiceState = voiceState;
    this.now = now;

    this.element.addEventListener('click', event => {
      const modeOption = event.target.closest('[data-navigation-active-mode-option]');
      if (modeOption) {
        this.modeSwitcherOpen = false;
        this.onTravelMode?.(modeOption.dataset.navigationActiveModeOption);
        return;
      }

      if (event.target.closest('[data-navigation-active-mode]')) {
        this.modeSwitcherOpen = !this.modeSwitcherOpen;
        const switcher = this.element.querySelector?.('[data-navigation-mode-switcher]');
        if (switcher) switcher.hidden = !this.modeSwitcherOpen;
        return;
      }

      if (event.target.closest('[data-navigation-stop]')) {
        this.onStop?.();
        return;
      }

      if (event.target.closest('[data-navigation-voice]')) {
        this.onToggleVoice?.();
        return;
      }

      if (event.target.closest('[data-navigation-undo-route]')) {
        this.onUndoRoute?.();
        return;
      }

      const arrivalAction = event.target.closest('[data-navigation-arrival-action]');
      if (arrivalAction) {
        this.onArrivalAction?.(arrivalAction.dataset.navigationArrivalAction);
      }
    });
  }

  showLoading(destinationName) {
    this.element.hidden = false;
    this.element.dataset.state = 'loading';
    this.element.innerHTML = `
      <div class="navigation-guidance-banner navigation-guidance-loading">
        <span class="navigation-guidance-spinner" aria-hidden="true"></span>
        <div>
          <strong>Calculating route</strong>
          <small>${escapeHtml(destinationName ?? 'Destination')}</small>
        </div>
        ${this.#stopButton()}
      </div>
    `;
  }

  showError(message) {
    this.element.hidden = false;
    this.element.dataset.state = 'error';
    this.element.innerHTML = `
      <div class="navigation-guidance-banner navigation-guidance-error">
        <span class="navigation-guidance-alert" aria-hidden="true">!</span>
        <div>
          <strong>Route unavailable</strong>
          <small>${escapeHtml(message)}</small>
        </div>
        ${this.#stopButton()}
      </div>
    `;
  }

  showRoute({
    route,
    progress,
    destinationName,
    navigationState = 'normal',
    canUndoRoute = false,
    travelMode = 'drive',
    laneGuidanceEnabled = true
  }) {
    const maneuver = progress.nextManeuver;
    const following = progress.followingManeuver;
    const road = maneuverRoad(maneuver);
    const drivingLabel = drivingManeuverLabel(maneuver);
    const notice = confidenceNotice(navigationState);
    const expanded = shouldExpandGuidance(
      maneuver,
      progress.distanceToManeuverMeters
    );
    const showLanes = expanded && laneGuidanceEnabled;
    const completed = route.distanceMeters > 0
      ? Math.max(0, Math.min(100,
          100 - progress.remainingDistanceMeters / route.distanceMeters * 100))
      : 0;

    this.element.hidden = false;
    this.element.dataset.state = 'ready';
    this.element.dataset.navigationState = navigationState;
    this.element.innerHTML = `
      <div class="navigation-guidance-banner ${expanded ? 'navigation-guidance-expanded' : 'navigation-guidance-compact'}">
        ${notice ? `
          <div class="navigation-confidence ${notice.className}" role="status">
            <span class="navigation-confidence-dot" aria-hidden="true"></span>
            <span>
              <strong>${notice.title}</strong>
              <small>${notice.detail}</small>
            </span>
            ${navigationState === 'changed' && canUndoRoute ? `
              <button type="button" data-navigation-undo-route>Undo</button>
            ` : ''}
          </div>
        ` : ''}

        <div class="navigation-guidance-primary">
          <div class="navigation-maneuver-tile">
            ${maneuverIconSvg(maneuver)}
          </div>

          <div class="navigation-maneuver-copy">
            <strong class="navigation-maneuver-distance">
              ${formatManeuverDistance(progress.distanceToManeuverMeters)}
            </strong>
            ${travelMode === 'drive' ? (drivingLabel ? `
              <span class="navigation-maneuver-road">
                ${escapeHtml(drivingLabel)}
              </span>
            ` : '') : `
              <span class="navigation-maneuver-road">
                ${escapeHtml(maneuver.instruction)}
              </span>
              ${expanded && road ? `<small>${escapeHtml(road)}</small>` : ''}
            `}
          </div>

          ${this.#stopButton()}
        </div>

        ${showLanes ? laneGuidanceHtml(maneuver) : ''}

        ${expanded && following ? `
          <div class="navigation-following-turn${travelMode === 'drive' ? ' navigation-following-turn--visual' : ''}">
            ${travelMode === 'walk' ? '<span>Then</span>' : ''}
            ${maneuverIconSvg(following, {
              className: 'maneuver-icon maneuver-icon-small'
            })}
            ${travelMode === 'drive'
              ? (drivingManeuverLabel(following) ? `<strong>${escapeHtml(drivingManeuverLabel(following))}</strong>` : '')
              : `<strong>${escapeHtml(following.instruction)}</strong>`}
          </div>
        ` : ''}
      </div>

      <div class="navigation-journey-summary">
        <div class="navigation-eta-summary">
          <strong>${formatDuration(progress.remainingDurationSeconds)}</strong>
          <span>ETA · ${formatEta(progress.remainingDurationSeconds, this.now())}</span>
        </div>

        <div class="navigation-route-mode-summary">
          <button
            type="button"
            class="navigation-active-mode navigation-active-mode--compact"
            data-navigation-active-mode
            aria-label="Travel mode: ${travelMode === 'walk' ? 'Walk' : 'Drive'}. Change travel mode"
            aria-haspopup="true"
            aria-expanded="${this.modeSwitcherOpen}"
          >
            <span class="navigation-active-mode-icon" aria-hidden="true">
              ${travelMode === 'walk' ? '🚶' : '🚗'}
            </span>
          </button>

          <div class="navigation-route-mode-copy">
            <strong>${formatDistance(progress.remainingDistanceMeters)}</strong>
            <span>remaining</span>
          </div>

          <div
            class="navigation-mode-switcher"
            data-navigation-mode-switcher
            ${this.modeSwitcherOpen ? '' : 'hidden'}
          >
            <button
              type="button"
              data-navigation-active-mode-option="drive"
              class="${travelMode === 'drive' ? 'on' : ''}"
              aria-pressed="${travelMode === 'drive'}"
            >🚗 <span>Drive</span></button>

            <button
              type="button"
              data-navigation-active-mode-option="walk"
              class="${travelMode === 'walk' ? 'on' : ''}"
              aria-pressed="${travelMode === 'walk'}"
            >🚶 <span>Walk</span></button>
          </div>
        </div>

        ${this.#voiceButton()}
        <div class="navigation-route-progress" aria-label="Route progress">
          <span style="width: ${completed.toFixed(1)}%"></span>
        </div>
      </div>
    `;
  }

  showApproaching({
    destinationName,
    remainingDistanceMeters
  }) {
    const distance =
      Math.max(
        0,
        Math.round(remainingDistanceMeters ?? 0)
      );

    this.element.hidden = false;
    this.element.dataset.state = 'approaching';
    delete this.element.dataset.navigationState;

    this.element.innerHTML = `
      <div class="navigation-guidance-banner navigation-guidance-approaching">
        <span class="navigation-destination-pin" aria-hidden="true"></span>

        <div class="navigation-guidance-approaching-copy">
          <small>Arriving at</small>
          <strong>${escapeHtml(destinationName ?? 'Destination')}</strong>
          <span>${distance} m remaining</span>
        </div>

        ${this.#voiceButton()}
      </div>
    `;
  }

  showArrival({
    destinationName,
    context = null
  }) {
    const itinerary = context?.type === 'itinerary';
    const nextStop = itinerary ? context.nextStop : null;
    const finalStop = itinerary && context.isFinalStop === true;

    this.element.hidden = false;
    this.element.dataset.state = 'arrival';
    delete this.element.dataset.navigationState;
    this.element.innerHTML = `
      <div class="navigation-arrival-card" role="status">
        <div class="navigation-arrival-heading">
          <span class="navigation-arrival-check" aria-hidden="true">✓</span>
          <div>
            <small>Arrived</small>
            <strong>${escapeHtml(destinationName ?? 'Destination')}</strong>
          </div>
        </div>

        ${itinerary ? `
          <div class="navigation-arrival-context">
            ${finalStop
              ? `<strong>${escapeHtml(context.completionLabel ?? 'This itinerary is complete')}</strong>`
              : `<small>Next stop</small><strong>${escapeHtml(nextStop?.name ?? 'Continue your trip')}</strong>`}
          </div>
          <div class="navigation-arrival-actions">
            <button type="button" data-navigation-arrival-action="trip">View trip</button>
            <button class="primary" type="button" data-navigation-arrival-action="finish">Finish</button>
          </div>
        ` : `
          <div class="navigation-arrival-actions navigation-arrival-actions--single">
            <button type="button" data-navigation-arrival-action="parking">Parking</button>
            <button type="button" data-navigation-arrival-action="save">Save</button>
            <button class="primary" type="button" data-navigation-arrival-action="finish">Finish</button>
          </div>
        `}
      </div>
    `;
  }

  hide() {
    this.modeSwitcherOpen = false;
    this.element.hidden = true;
    this.element.dataset.state = 'idle';
    delete this.element.dataset.navigationState;
    this.element.replaceChildren();
  }

  #stopButton() {
    return `
      <button
        class="navigation-guidance-stop"
        type="button"
        data-navigation-stop
        aria-label="End navigation"
        title="End navigation"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7l10 10M17 7L7 17"></path>
        </svg>
      </button>
    `;
  }

  #voiceButton() {
    const state = this.voiceState();
    return `
      <button
        class="navigation-voice-button${state.enabled ? ' on' : ''}"
        type="button"
        data-navigation-voice
        ${state.supported ? '' : 'disabled'}
        aria-label="${state.enabled ? 'Mute voice guidance' : 'Enable voice guidance'}"
      >
        <span aria-hidden="true">${state.enabled ? '🔊' : '🔇'}</span>
        <strong>${state.enabled ? 'Voice on' : 'Voice off'}</strong>
      </button>
    `;
  }
}
