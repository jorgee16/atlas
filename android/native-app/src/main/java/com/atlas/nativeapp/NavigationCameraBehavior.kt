package com.atlas.nativeapp

import kotlin.math.abs

/** Heading-up guidance uses a forward pointing car; the MAP rotates, not the vehicle. */
internal object NavigationCameraBehavior {
    fun cursorAngle(navigating: Boolean, follow: Boolean, headingUp: Boolean,
                    travelBearing: Double, mapBearing: Double): Double =
        if (navigating && follow && headingUp) 0.0
        else AtlasHeading.normalize(travelBearing - mapBearing)

    /**
     * Safe, display-only route heading. Physical GNSS owns direction when the
     * road match or route is questionable. In particular never use an old
     * projected heading during rerouting, tunnels, GPS loss, or when parked.
     */
    fun trustedRouteBearing(tangent: Double?, travelBearing: Double,
                           gpsProviderBearing: Double?, bearingAccuracy: Double?,
                           speed: Double, locationAccuracy: Double,
                           fixAge: Double, motionConfirmed: Boolean?,
                           guidanceFresh: Boolean, guidanceState: String,
                           offRouteMeters: Double, rerouting: Boolean): Double? {
        if (tangent == null || !tangent.isFinite() ||
            !travelBearing.isFinite() || !speed.isFinite() || speed < 2.0 ||
            motionConfirmed != true || !locationAccuracy.isFinite() ||
            locationAccuracy !in 0.0..25.0 || !fixAge.isFinite() ||
            fixAge !in 0.0..2.0 || !guidanceFresh ||
            guidanceState != "normal" || rerouting ||
            !offRouteMeters.isFinite() ||
            offRouteMeters > maxOf(22.0,locationAccuracy*1.5)) return null

        // A wrong-way map match can look "on route" near parallel roads.
        // Filtered travel and independently accurate GNSS must not disagree
        // violently with the route tangent; normal bend lag is allowed.
        if (AtlasHeading.angleDifference(travelBearing,tangent) >= 110.0)
            return null
        if (gpsProviderBearing != null && gpsProviderBearing.isFinite() &&
            bearingAccuracy != null && bearingAccuracy.isFinite() &&
            bearingAccuracy <= 15.0 &&
            AtlasHeading.angleDifference(gpsProviderBearing,tangent) >= 100.0)
            return null
        return AtlasHeading.normalize(tangent)
    }

    /** A compass tap settles quickly, but still rotates smoothly on the
     * same rendering clock. Normal live-heading changes retain slower damping.
     * Rate 14/s settles a 180° north-up switch inside the replay's 600 ms
     * bound without an instantaneous camera snap or a competing animator.
     */
    fun rotationRate(secondsSinceCompassTap: Double,
                     angularErrorDegrees: Double = 0.0,
                     speedMetersPerSecond: Double = 0.0,
                     visualRoundabout: Boolean = false): Double {
        if (secondsSinceCompassTap.isFinite() &&
            secondsSinceCompassTap in 0.0..0.85) return 14.0
        // Visual route-tangent mode only: keep tight loops in alignment.
        // This does NOT change filtered GPS bearing, guidance or map matching.
        if(visualRoundabout && speedMetersPerSecond.isFinite() &&
            speedMetersPerSecond>=2.0) return 12.0
        // Follow confirmed moving bends sooner, without any camera snap.
        // Keep the original damping for stationary/noisy GPS bearings.
        if (!speedMetersPerSecond.isFinite() || speedMetersPerSecond < 1.8)
            return 2.8
        return when {
            abs(angularErrorDegrees) >= 30.0 -> 8.0
            abs(angularErrorDegrees) >= 8.0 -> 5.5
            else -> 2.8
        }
    }

    fun shouldContinueFrame(follow: Boolean, markerActive: Boolean,
                            centerErrorMeters: Double, angularError: Double,
                            zoomError: Double, tiltError: Double): Boolean =
        markerActive || (follow && (centerErrorMeters > 0.15 ||
            abs(angularError) > 0.25 || abs(zoomError) > 0.01 ||
            abs(tiltError) > 0.1))

    /** Keep inertia for a short time while route-matching checks/rerouting are underway. */
    fun useHeldRouteFix(navigating: Boolean, trustedGuidance: Boolean,
                        ageSinceValidSeconds: Double): Boolean =
        navigating && !trustedGuidance && ageSinceValidSeconds in 0.0..2.0
}
