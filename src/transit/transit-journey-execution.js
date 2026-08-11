export class TransitJourneyExecution {
  constructor(journey, { now = () => Date.now() } = {}) {
    if (!journey || !Array.isArray(journey.sequence) || !journey.sequence.length) {
      throw new TypeError('TransitJourneyExecution requires a journey sequence.');
    }
    this.journey = journey;
    this.now = now;
    this.legIndex = 0;
    this.phase = this.#initialPhase(journey.sequence[0]);
    this.startedAt = now();
    this.completedAt = null;
    this.history = [{ type: 'journey-started', legIndex: 0, phase: this.phase, at: this.startedAt }];
  }

  getState() {
    const leg = this.journey.sequence[this.legIndex] ?? null;
    return {
      journey: this.journey,
      leg,
      legIndex: this.legIndex,
      legCount: this.journey.sequence.length,
      phase: this.phase,
      completed: this.phase === 'complete',
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      history: [...this.history]
    };
  }

  isComplete() { return this.phase === 'complete'; }

  transition(action) {
    if (this.isComplete()) return false;
    const leg = this.journey.sequence[this.legIndex];

    if (leg?.kind === 'walk' && this.phase === 'walking' && action === 'arrived') {
      this.#record('arrived', 'arrived');
      this.#advanceLeg();
      return true;
    }
    if (leg?.kind === 'transit' && this.phase === 'ready_to_board' && action === 'boarded') {
      this.phase = 'riding';
      this.#record('boarded', this.phase);
      return true;
    }
    if (leg?.kind === 'transit' && this.phase === 'riding' && action === 'get_off') {
      this.#record('alighted', 'alighted');
      this.#advanceLeg();
      return true;
    }
    return false;
  }

  #advanceLeg() {
    const nextIndex = this.legIndex + 1;
    if (nextIndex >= this.journey.sequence.length) {
      this.phase = 'complete';
      this.completedAt = this.now();
      this.#record('journey-complete', 'complete');
      return;
    }
    this.legIndex = nextIndex;
    this.phase = this.#initialPhase(this.journey.sequence[nextIndex]);
    this.#record('leg-started', this.phase);
  }

  #initialPhase(leg) {
    if (leg?.kind === 'walk') return 'walking';
    if (leg?.kind === 'transit') return 'ready_to_board';
    throw new TypeError(`Unsupported transit journey leg kind: ${leg?.kind ?? 'unknown'}`);
  }

  #record(type, phase) {
    this.history.push({ type, legIndex: this.legIndex, phase, at: this.now() });
  }
}
