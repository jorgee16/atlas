import { escapeHtml } from '../../utils.js';

export class TransitJourneyExecutionView {
  constructor({ documentRef = globalThis.document } = {}) {
    if (!documentRef) {
      throw new TypeError(
        'TransitJourneyExecutionView requires a document.'
      );
    }

    this.document = documentRef;
    this.expanded = false;
  }

  render({
    state,
    distanceToLegEnd = null,
    onAction,
    onFinish,
    onCancel
  }) {
    const container =
      this.document.createElement('section');

    container.className = 'transit-execution';

    if (state.completed) {
      container.innerHTML = `
        <div class="transit-execution-card transit-execution-card--complete">
          <small>Journey complete</small>
          <strong>Destination reached</strong>
          <span>
            All ${state.legCount} legs are complete.
          </span>

          <button
            type="button"
            data-transit-finish
          >
            Finish journey
          </button>
        </div>
      `;

      container
        .querySelector?.('[data-transit-finish]')
        ?.addEventListener('click', onFinish);

      return container;
    }

    const leg = state.leg;
    const transit = leg.kind === 'transit';

    const from =
      leg.fromName ??
      leg.from?.name ??
      '';

    const to =
      leg.toName ??
      leg.to?.name ??
      '';

    const phase = this.#phaseCopy(
      state.phase,
      leg,
      distanceToLegEnd
    );

    const action = this.#action(state.phase);

    const mode =
      transit
        ? leg.line || leg.mode || 'Transit'
        : 'Walking';

    const destination =
      to ||
      leg.instruction ||
      'Next stop';

    container.innerHTML = `
      <div
        class="
          transit-execution-card
          transit-execution-card--compact
          ${this.expanded ? 'is-expanded' : ''}
        "
      >
        <div class="transit-execution-strip">

          <button
            type="button"
            class="transit-execution-summary"
            data-transit-expand
            aria-expanded="${this.expanded}"
          >
            <span
              class="
                transit-execution-mode-icon
                ${transit ? 'is-transit' : 'is-walk'}
              "
              aria-hidden="true"
            >
              ${transit ? '◆' : '●'}
            </span>

            <span class="transit-execution-summary-copy">

              <small>
                Leg ${state.legIndex + 1}
                of ${state.legCount}
                ·
                ${escapeHtml(mode)}
              </small>

              <strong>
                ${escapeHtml(
                  transit
                    ? `To ${destination}`
                    : `Walk to ${destination}`
                )}
              </strong>

            </span>

            <span
              class="transit-execution-chevron"
              aria-hidden="true"
            >
              ${this.expanded ? '⌄' : '›'}
            </span>
          </button>

          ${action ? `
            <button
              type="button"
              class="transit-execution-action transit-execution-action--inline"
              data-transit-action="${action.id}"
            >
              ${escapeHtml(action.label)}
            </button>
          ` : ''}

        </div>

        ${this.expanded ? `
          <div class="transit-execution-details">

            ${(from || to) ? `
              <span class="transit-execution-endpoints">
                ${escapeHtml(from || 'Start')}
                →
                ${escapeHtml(to || 'Next stop')}
              </span>
            ` : ''}

            <div class="transit-execution-state">
              <small>
                ${escapeHtml(phase.kicker)}
              </small>

              <strong>
                ${escapeHtml(phase.title)}
              </strong>

              <span>
                ${escapeHtml(phase.detail)}
              </span>
            </div>

            <button
              type="button"
              class="transit-execution-cancel"
              data-transit-cancel
            >
              Cancel journey
            </button>

          </div>
        ` : ''}

      </div>
    `;

    container
      .querySelector?.('[data-transit-expand]')
      ?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        this.expanded = !this.expanded;

        const replacement = this.render({
          state,
          distanceToLegEnd,
          onAction,
          onFinish,
          onCancel
        });

        container.replaceWith(replacement);
      });

    container
      .querySelector?.('[data-transit-action]')
      ?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();

        onAction?.(
          event.currentTarget.dataset.transitAction
        );
      });

    const cancelButton =
      container.querySelector?.(
        '[data-transit-cancel]'
      );

    if (cancelButton) {
      for (
        const eventName of [
          'pointerdown',
          'pointerup'
        ]
      ) {
        cancelButton.addEventListener(
          eventName,
          event => {
            event.stopPropagation();
          }
        );
      }

      cancelButton.addEventListener(
        'click',
        event => {
          event.preventDefault();
          event.stopPropagation();
          onCancel?.();
        }
      );
    }

    return container;
  }

  #action(phase) {
    // Walking legs advance automatically through GPS arrival detection.
    if (phase === 'ready_to_board') {
      return {
        id: 'boarded',
        label: 'Boarded'
      };
    }

    if (phase === 'riding') {
      return {
        id: 'get_off',
        label: 'Get off'
      };
    }

    return null;
  }

  #phaseCopy(
    phase,
    leg,
    distanceToLegEnd = null
  ) {
    if (phase === 'walking') {
      return {
        kicker: 'Atlas Navigation',
        title: 'Walk to the next stop',
        detail:
          leg.instruction ||
          'Atlas will automatically continue when you reach the stop.'
      };
    }

    if (phase === 'ready_to_board') {
      return {
        kicker: 'Ready to board',
        title:
          leg.line
            ? `Board ${leg.line}`
            : 'Board this service',
        detail:
          leg.direction
            ? `Direction: ${leg.direction}`
            : 'Confirm once you are on board.'
      };
    }

    if (phase === 'riding') {
      if (
        Number.isFinite(distanceToLegEnd) &&
        distanceToLegEnd <= 100
      ) {
        return {
          kicker: 'Get ready',
          title:
            leg.toName
              ? `${leg.toName} is very close`
              : 'Your stop is very close',
          detail:
            'GPS indicates the alighting stop is nearby.'
        };
      }

      if (
        Number.isFinite(distanceToLegEnd) &&
        distanceToLegEnd <= 350
      ) {
        return {
          kicker: 'Approaching stop',
          title:
            leg.toName
              ? `Prepare for ${leg.toName}`
              : 'Prepare to get off',
          detail:
            `${Math.round(
              distanceToLegEnd
            )} m from the TfL leg endpoint.`
        };
      }

      return {
        kicker: 'Riding',
        title:
          leg.toName
            ? `Get off at ${leg.toName}`
            : 'Stay on until your stop',
        detail:
          'Atlas is tracking the destination stop.'
      };
    }

    return {
      kicker: 'Transit',
      title: 'Continue journey',
      detail: ''
    };
  }
}
