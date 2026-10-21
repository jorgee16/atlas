package com.atlas.nativeapp

import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max

/** A route preview is not an active navigation fix. Start uses a recent fix,
 * and replans when the car has moved away from the preview's original GPS
 * origin. Normal GPS noise alone must not trigger repeated replanning.
 */
internal object NavigationStartPolicy {
    /** Freshness prevents stale route origins. Horizontal accuracy is a confidence
     * signal, NOT a prerequisite for starting: indoor/weak GPS can be hundreds
     * of metres off while still reporting a legitimate recent location fix.
     * Guidance and rerouting continue to handle uncertainty separately.
     */
    fun freshFix(
        now: Double, fixAt: Double, accuracyMeters: Double,
        maxAgeSeconds: Double = 8.0
    ): Boolean =
        now.isFinite() && fixAt.isFinite() &&
            maxAgeSeconds.isFinite() && maxAgeSeconds > 0.0 &&
            now - fixAt in 0.0..maxAgeSeconds &&
            accuracyMeters.isFinite() && accuracyMeters >= 0.0

    /** Never infer road direction from a parked car or a coarse GPS fix. */
    fun movingHeading(fix: Fix?): Double? {
        if (fix == null || fix.motionConfirmed != true || fix.accuracy > 25 ||
            fix.speed < 2.0 || !fix.speed.isFinite()) return null
        val accuracy=fix.bearingAccuracy
        if(accuracy!=null && (!accuracy.isFinite() || accuracy>40))return null
        return fix.bearing?.takeIf { it.isFinite() && it>=0.0 }?.let {
            ((it%360.0)+360.0)%360.0
        }
    }

    /** A significant heading change invalidates a nearby but reversed preview. */
    fun directionChanged(plannedHeading: Double?, latestHeading: Double?): Boolean {
        if(plannedHeading==null || latestHeading==null)return false
        return kotlin.math.abs(Math.IEEEremainder(plannedHeading-latestHeading,360.0)) > 55.0
    }

    fun requiresNewOrigin(
        plannedFrom: Coordinate?, current: Coordinate,
        accuracyMeters: Double, walking: Boolean, moving: Boolean = false
    ): Boolean {
        if (plannedFrom == null) return true
        val north = (current.lat - plannedFrom.lat) * 111_320.0
        val east = (current.lon - plannedFrom.lon) * 111_320.0 *
            cos(Math.toRadians((current.lat + plannedFrom.lat) / 2.0))
        val distance = hypot(north,east)
        if (!distance.isFinite()) return true
        val threshold = if(moving) max(if(walking) 6.0 else 9.0,accuracyMeters * 1.25)
                        else max(if(walking) 15.0 else 30.0,accuracyMeters * 1.5)
        return distance > threshold
    }
}
