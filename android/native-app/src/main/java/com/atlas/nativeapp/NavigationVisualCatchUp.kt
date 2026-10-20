package com.atlas.nativeapp

import kotlin.math.max

/** Catch up only after an accepted, accurate and CURRENT GPS projection.
 * A route-guidance prediction and a single noisy raw fix are not evidence
 * that the visual cursor has missed real movement.
 */
internal object NavigationVisualCatchUp {
    fun shouldSnap(
        visualGapMeters: Double,
        fixAgeSeconds: Double,
        gpsToProjectionMeters: Double,
        accuracyMeters: Double,
        speedMetersPerSecond: Double,
        walking: Boolean
    ): Boolean {
        if (!visualGapMeters.isFinite() || !fixAgeSeconds.isFinite() ||
            !gpsToProjectionMeters.isFinite() || !accuracyMeters.isFinite() ||
            !speedMetersPerSecond.isFinite()) return false
        if (fixAgeSeconds !in 0.0..2.5 || accuracyMeters < 0.0) return false
        if (accuracyMeters > if(walking) 15.0 else 25.0) return false
        if (speedMetersPerSecond < if(walking) 1.5 else 3.0) return false
        if (gpsToProjectionMeters > max(22.0, accuracyMeters*2.0)) return false
        val largeGap = max(if(walking) 18.0 else 35.0,
            speedMetersPerSecond * 2.5 + accuracyMeters * 1.5)
        return visualGapMeters > largeGap
    }
}
