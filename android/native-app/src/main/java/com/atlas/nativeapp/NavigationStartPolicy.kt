package com.atlas.nativeapp

import kotlin.math.abs
import kotlin.math.atan2
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

    /** Rerouting prefers a fresh receiver bearing to a smoothed heading from
     * an older part of the route. Without confirmed motion, corroborate two
     * consecutive REAL fixes; never derive direction from camera prediction.
     */
    fun rerouteHeading(current: Fix?, previous: Fix?, now: Double): Double? {
        if (current == null || !freshFix(now, current.time, current.accuracy, 5.0) ||
            current.accuracy > 25.0) return null
        val speed = current.providerSpeed ?: current.speed
        if (!speed.isFinite() || speed < 2.0) return null
        val bearingError = current.bearingAccuracy
        val raw = current.providerBearing?.takeIf {
            it.isFinite() && it >= 0.0 &&
                (bearingError == null || (bearingError.isFinite() && bearingError <= 35.0))
        }?.let { ((it % 360.0) + 360.0) % 360.0 }
        // A filtered course can lag badly through turns or a U-turn. Never
        // promote that old course into a new reroute when GNSS lacks a bearing.
        val verifiedReceiver = current.motionConfirmed == true && raw != null
        if (previous == null || previous.accuracy > 25.0 ||
            !previous.time.isFinite()) return if (verifiedReceiver) raw else null
        val elapsed = current.time - previous.time
        if (elapsed !in 0.5..6.0) return if (verifiedReceiver) raw else null
        val north = (current.point.lat - previous.point.lat) * 111_320.0
        val east = (current.point.lon - previous.point.lon) * 111_320.0 *
            cos(Math.toRadians((current.point.lat + previous.point.lat) / 2.0))
        val traveled = hypot(north, east)
        if (!traveled.isFinite() ||
            traveled < max(5.0, max(current.accuracy, previous.accuracy) * 0.75) ||
            traveled / elapsed > max(10.0, speed * 2.5))
            return if (verifiedReceiver && traveled < 5.0) raw else null
        val course = ((Math.toDegrees(atan2(east, north)) % 360.0) + 360.0) % 360.0
        if (raw != null && abs(Math.IEEEremainder(raw - course, 360.0)) > 55.0)
            return null
        return raw ?: course
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
