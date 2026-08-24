export const DRIVE_TOLL_PENALTIES_MINUTES_PER_EURO = Object.freeze([
  0,
  0.5,
  1,
  1.5,
  2,
  3,
  4,
  5,
  7,
  10
]);

export function selectBalancedDriveRoute(
  frontier,
  fastest,
  noTolls
) {
  const pool = (frontier ?? []).filter(
    route => route !== fastest && route !== noTolls
  );

  if (!pool.length) {
    return null;
  }

  if (!fastest || !noTolls) {
    return pool.reduce(
      (best, route) => {
        const score =
          route.durationSeconds / 60 +
          Number(route.tolls?.totalEuros ?? 0) * 3;

        return !best || score < best.score
          ? { route, score }
          : best;
      },
      null
    )?.route ?? null;
  }

  const fastestMinutes = fastest.durationSeconds / 60;
  const noTollsMinutes = noTolls.durationSeconds / 60;
  const fastestTolls = Number(
    fastest.tolls?.totalEuros ?? 0
  );
  const noTollsCost = Number(
    noTolls.tolls?.totalEuros ?? 0
  );

  const timeRange = Math.max(
    1,
    noTollsMinutes - fastestMinutes
  );
  const tollRange = Math.max(
    0.01,
    fastestTolls - noTollsCost
  );

  // Do not call a route Balanced when it is effectively
  // the no-tolls route with only a few minutes shaved off.
  const minimumTimeSavedVsNoTolls = Math.max(
    8,
    timeRange * 0.15
  );
  const minimumTollSavedVsFastest = Math.max(
    2,
    tollRange * 0.15
  );

  const meaningful = pool.filter(route => {
    const minutes = route.durationSeconds / 60;
    const tolls = Number(route.tolls?.totalEuros ?? 0);

    return (
      noTollsMinutes - minutes >= minimumTimeSavedVsNoTolls &&
      fastestTolls - tolls >= minimumTollSavedVsFastest
    );
  });

  const candidates = meaningful.length
    ? meaningful
    : pool;

  // Pick the knee of the Pareto frontier: normalized
  // distance from the ideal point (fastest time, zero tolls).
  return candidates.reduce(
    (best, route) => {
      const minutes = route.durationSeconds / 60;
      const tolls = Number(route.tolls?.totalEuros ?? 0);

      const timeFraction = Math.max(
        0,
        Math.min(
          1,
          (minutes - fastestMinutes) / timeRange
        )
      );

      const tollFraction = Math.max(
        0,
        Math.min(
          1,
          (tolls - noTollsCost) / tollRange
        )
      );

      const score = Math.hypot(
        timeFraction,
        tollFraction
      );

      return !best || score < best.score
        ? { route, score }
        : best;
    },
    null
  )?.route ?? null;
}
