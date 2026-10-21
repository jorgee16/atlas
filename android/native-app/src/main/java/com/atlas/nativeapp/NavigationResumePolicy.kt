package com.atlas.nativeapp

import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max

/** Decide whether a foreground return needs a one-shot visual reposition.
 * NavigationService and native guidance remain the sources of truth.
 */
internal object NavigationResumePolicy {
    fun shouldSynchronize(pausedAt: Double, now: Double, navigating: Boolean): Boolean =
        navigating && pausedAt.isFinite() && now.isFinite() &&
            now - pausedAt >= 0.9

    fun freshFix(now: Double, fixAt: Double): Boolean =
        now.isFinite() && fixAt.isFinite() && now - fixAt in 0.0..8.0

    fun trustworthyResumeFix(now: Double, fixAt: Double, accuracyMeters: Double): Boolean =
        freshFix(now,fixAt) && accuracyMeters.isFinite() &&
            accuracyMeters in 0.0..70.0

    /**
     * A single GPS position can be an outlier even when it claims 5 m
     * accuracy. Accept the freshest position after background only when the
     * last two REAL, native-filtered fixes are temporally ordered and mutually
     * plausible. We do not compare with the pre-background cursor: genuine
     * travel can cover kilometres and MUST synchronize immediately.
     *
     * Tight fixes permit a stationary or slow user; moderate (<=70 m) fixes
     * need native-confirmed motion in both observations. Poor/no-speed fixes
     * remain visible to the routing core but cannot force a visual teleport.
     */
    fun consecutiveResumeFix(now: Double, latest: Fix, previous: Fix?): Boolean {
        if (!trustworthyResumeFix(now, latest.time, latest.accuracy)) return false
        val prior = previous ?: return false
        val dt = latest.time - prior.time
        if (!dt.isFinite() || dt !in 0.2..12.0 ||
            !prior.accuracy.isFinite() || prior.accuracy !in 0.0..70.0) return false
        val latDelta = (latest.point.lat-prior.point.lat)*111320.0
        val eastDelta = (latest.point.lon-prior.point.lon)*111320.0*
            cos(Math.toRadians((latest.point.lat+prior.point.lat)*.5))
        val measured = hypot(latDelta,eastDelta)
        val observedSpeed = StationaryMapPosition.visualSpeed(latest)
        val limit = max(7.0, (max(0.0,observedSpeed)*1.9+4.0)*dt)
        if (measured > limit || !measured.isFinite()) return false
        val tightPair = latest.accuracy <= 35.0 && prior.accuracy <= 35.0
        val corroboratedDrive = latest.motionConfirmed == true &&
            prior.motionConfirmed == true
        return tightPair || corroboratedDrive
    }

    /** Reduced guidance preserves an old route projection, not a new GNSS
     * observation. On foreground return it must never replace a recent
     * consecutive real GPS fix. Reliable, moving guidance may use snapping.
     */
    fun useRouteOnResume(fix: Fix, guidanceState: String): Boolean =
        guidanceState == "normal" && fix.motionConfirmed == true &&
            fix.accuracy.isFinite() && fix.accuracy in 0.0..35.0

    /** A predicted route point based on the foreground anchor is not a new
     * GPS observation. It cannot move the cursor after a background resume.
     */
    fun suppressOldFixPrediction(anchorFixAt: Double, currentFixAt: Double,
                                 predicted: Boolean): Boolean =
        predicted && anchorFixAt.isFinite() && currentFixAt.isFinite() &&
            currentFixAt <= anchorFixAt + 0.000001

    fun newFixAfterResume(anchorFixAt: Double, currentFixAt: Double): Boolean =
        anchorFixAt.isFinite() && currentFixAt.isFinite() &&
            currentFixAt > anchorFixAt + 0.000001

    fun currentGuidance(fixAt: Double, guidanceFixAt: Double): Boolean =
        fixAt.isFinite() && guidanceFixAt.isFinite() &&
            abs(fixAt - guidanceFixAt) < 0.01

    /** Never aim a moving camera using an old JNI projection. During a GPS
     * delivery gap retain the last physically observed travel direction;
     * a route prediction is not an independent heading measurement.
     */
    fun currentHeadingGuidance(now: Double, fixAt: Double,
                               guidanceFixAt: Double): Boolean =
        currentGuidance(fixAt, guidanceFixAt) &&
            now.isFinite() && now - fixAt in 0.0..2.5
}
