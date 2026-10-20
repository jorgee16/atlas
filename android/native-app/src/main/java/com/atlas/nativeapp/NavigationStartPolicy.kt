package com.atlas.nativeapp

import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max

/** A route preview is not an active navigation fix. Start uses a recent fix,
 * and replans when the car has moved away from the preview's original GPS
 * origin. Normal GPS noise alone must not trigger repeated replanning.
 */
internal object NavigationStartPolicy {
    fun freshFix(now: Double, fixAt: Double, accuracyMeters: Double): Boolean =
        now.isFinite() && fixAt.isFinite() && now - fixAt in 0.0..8.0 &&
            accuracyMeters.isFinite() && accuracyMeters in 0.0..70.0

    fun requiresNewOrigin(
        plannedFrom: Coordinate?, current: Coordinate,
        accuracyMeters: Double, walking: Boolean
    ): Boolean {
        if (plannedFrom == null) return true
        val north = (current.lat - plannedFrom.lat) * 111_320.0
        val east = (current.lon - plannedFrom.lon) * 111_320.0 *
            cos(Math.toRadians((current.lat + plannedFrom.lat) / 2.0))
        val distance = hypot(north,east)
        if (!distance.isFinite()) return true
        val threshold = max(if(walking) 15.0 else 30.0,accuracyMeters * 1.5)
        return distance > threshold
    }
}
