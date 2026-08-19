const DEFAULT_WEIGHTS = Object.freeze({
  transferMinutes: 8,
  walkingMinute: 0.2,
  longWalkThresholdMinutes: 15,
  longWalkExtraMinute: 0.4,
  disruptionMinutes: 6
});

function finiteMinutes(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? number
    : fallback;
}

function stepKind(step) {
  if (step?.kind) return step.kind;
  return step?.mode === 'walking' ? 'walk' : 'transit';
}

function disruptionCount(sequence) {
  return sequence.reduce(
    (count, step) =>
      count + (Array.isArray(step?.disruptions) ? step.disruptions.length : 0),
    0
  );
}

/**
 * Derive the metrics Atlas uses to compare TfL journey alternatives.
 *
 * TfL is responsible for discovering valid journeys. Ranking them is an
 * Atlas policy decision, so the provider response order is deliberately
 * ignored by rankTransitJourneys().
 */
export function transitJourneyMetrics(journey) {
  const sequence = Array.isArray(journey?.sequence)
    ? journey.sequence
    : Array.isArray(journey?.legs)
      ? journey.legs
      : [];

  const walkingSteps = sequence.filter(step => stepKind(step) === 'walk');
  const transitSteps = sequence.filter(step => stepKind(step) === 'transit');

  const walkingMinutes = walkingSteps.reduce(
    (total, step) => total + finiteMinutes(step?.durationMinutes),
    0
  );

  const transitMinutes = transitSteps.reduce(
    (total, step) => total + finiteMinutes(step?.durationMinutes),
    0
  );

  const legMinutes = sequence.reduce(
    (total, step) => total + finiteMinutes(step?.durationMinutes),
    0
  );

  const durationMinutes = finiteMinutes(
    journey?.durationMinutes,
    legMinutes
  );

  // TfL journey duration can include waiting/interchange time that is not
  // represented by a dedicated leg. Preserve it as a useful ranking metric.
  const waitingMinutes = Math.max(0, durationMinutes - legMinutes);

  return {
    durationMinutes,
    walkingMinutes,
    transitMinutes,
    waitingMinutes,
    transferCount: Math.max(0, transitSteps.length - 1),
    transitLegCount: transitSteps.length,
    walkingLegCount: walkingSteps.length,
    disruptionCount: disruptionCount(sequence)
  };
}

/**
 * Lower score is better.
 *
 * Duration remains the base cost. An interchange is intentionally expensive:
 * saving only a few minutes should not make Atlas recommend a much more
 * complicated journey. Walking is also intentionally expensive: once a
 * journey exceeds ten minutes of walking, each additional walking minute has
 * a stronger cost so Atlas does not recommend a marginally faster journey
 * that makes the user walk noticeably more.
 */
export function calculateTransitJourneyScore(
  metrics,
  weights = DEFAULT_WEIGHTS
) {
  const longWalkMinutes = Math.max(
    0,
    metrics.walkingMinutes - weights.longWalkThresholdMinutes
  );

  return (
    metrics.durationMinutes +
    metrics.transferCount * weights.transferMinutes +
    metrics.walkingMinutes * weights.walkingMinute +
    longWalkMinutes * weights.longWalkExtraMinute +
    metrics.disruptionCount * weights.disruptionMinutes
  );
}

/**
 * Return a new array ordered by Atlas preference.
 * The original provider array and journey objects are not mutated.
 */
export function rankTransitJourneys(journeys, { weights = DEFAULT_WEIGHTS } = {}) {
  if (!Array.isArray(journeys) || journeys.length === 0) {
    return [];
  }

  const prepared = journeys.map((journey, providerIndex) => {
    const metrics = transitJourneyMetrics(journey);

    const departureMs =
      Date.parse(journey?.startTime ?? '');

    const arrivalMs =
      Date.parse(journey?.arrivalTime ?? '');

    return {
      journey,
      providerIndex,
      metrics,
      departureMs:
        Number.isFinite(departureMs)
          ? departureMs
          : null,
      arrivalMs:
        Number.isFinite(arrivalMs)
          ? arrivalMs
          : null
    };
  });

  /*
   * Journey.duration is the duration AFTER that journey starts.
   *
   * It cannot be used by itself to compare:
   *
   *   22:56 -> 23:17  (21 min)
   *   22:44 -> 23:12  (28 min)
   *
   * because the second journey actually arrives earlier.
   *
   * Use the earliest candidate departure as the common planning
   * reference and score the actual arrival ETA from that point.
   */
  const validDepartures =
    prepared
      .map(item => item.departureMs)
      .filter(Number.isFinite);

  const referenceDepartureMs =
    validDepartures.length
      ? Math.min(...validDepartures)
      : null;

  for (const item of prepared) {
    const effectiveArrivalMinutes =
      Number.isFinite(referenceDepartureMs) &&
      Number.isFinite(item.arrivalMs)
        ? Math.max(
            0,
            (item.arrivalMs - referenceDepartureMs) /
              60000
          )
        : item.metrics.durationMinutes;

    item.metrics = {
      ...item.metrics,
      effectiveArrivalMinutes
    };

    /*
     * calculateTransitJourneyScore() already includes durationMinutes
     * as its base. Replace that base with actual arrival ETA while
     * preserving transfer/walking/disruption inconvenience penalties.
     */
    const inconvenienceScore =
      calculateTransitJourneyScore(
        item.metrics,
        weights
      ) -
      item.metrics.durationMinutes;

    item.score =
      effectiveArrivalMinutes +
      inconvenienceScore;
  }

  const fastestArrivalMinutes =
    Math.min(
      ...prepared.map(
        item =>
          item.metrics.effectiveArrivalMinutes
      )
    );

  prepared.sort((a, b) =>
    a.score - b.score ||
    a.metrics.effectiveArrivalMinutes -
      b.metrics.effectiveArrivalMinutes ||
    a.metrics.transferCount -
      b.metrics.transferCount ||
    a.metrics.walkingMinutes -
      b.metrics.walkingMinutes ||
    a.providerIndex -
      b.providerIndex
  );

  const recommendedScore =
    prepared[0].score;

  return prepared.map((item, rank) => ({
    ...item.journey,
    metrics: { ...item.metrics },
    score: item.score,
    rank,
    providerIndex: item.providerIndex,
    isRecommended: rank === 0,

    /*
     * "Fastest" now means earliest arrival, not shortest
     * journey after its eventual departure.
     */
    isFastest:
      item.metrics.effectiveArrivalMinutes ===
      fastestArrivalMinutes,

    durationAboveFastestMinutes:
      item.metrics.effectiveArrivalMinutes -
      fastestArrivalMinutes,

    fastestDurationMinutes:
      fastestArrivalMinutes,

    recommendedScore
  }));
}

export { DEFAULT_WEIGHTS as TRANSIT_JOURNEY_SCORE_WEIGHTS };
