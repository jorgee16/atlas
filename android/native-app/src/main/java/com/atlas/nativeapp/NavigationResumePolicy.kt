package com.atlas.nativeapp

import kotlin.math.abs

/** Decide whether a foreground return needs a one-shot visual reposition.
 * NavigationService and native guidance remain the sources of truth.
 */
internal object NavigationResumePolicy {
    fun shouldSynchronize(pausedAt: Double, now: Double, navigating: Boolean): Boolean =
        navigating && pausedAt.isFinite() && now.isFinite() &&
            now - pausedAt >= 2.0

    fun freshFix(now: Double, fixAt: Double): Boolean =
        now.isFinite() && fixAt.isFinite() && now - fixAt in 0.0..8.0

    fun trustworthyResumeFix(now: Double, fixAt: Double, accuracyMeters: Double): Boolean =
        freshFix(now,fixAt) && accuracyMeters.isFinite() &&
            accuracyMeters in 0.0..70.0

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
