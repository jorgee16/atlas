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

    fun currentGuidance(fixAt: Double, guidanceFixAt: Double): Boolean =
        fixAt.isFinite() && guidanceFixAt.isFinite() &&
            abs(fixAt - guidanceFixAt) < 0.01
}
