package com.atlas.nativeapp

import kotlin.math.abs

/** Heading-up guidance uses a forward pointing car; the MAP rotates, not the vehicle. */
internal object NavigationCameraBehavior {
    fun cursorAngle(navigating: Boolean, follow: Boolean, headingUp: Boolean,
                    travelBearing: Double, mapBearing: Double): Double =
        if (navigating && follow && headingUp) 0.0
        else AtlasHeading.normalize(travelBearing - mapBearing)

    /** A compass tap settles quickly, but still rotates smoothly on the
     * same rendering clock. Normal live-heading changes retain slower damping.
     * Rate 14/s settles a 180° north-up switch inside the replay's 600 ms
     * bound without an instantaneous camera snap or a competing animator.
     */
    fun rotationRate(secondsSinceCompassTap: Double): Double =
        if (secondsSinceCompassTap.isFinite() &&
            secondsSinceCompassTap in 0.0..0.85) 14.0 else 2.8

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
