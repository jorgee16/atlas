package com.atlas.nativeapp

import kotlin.math.abs

/** Normalise and select orientation independently of MapLibre rendering. */
internal object AtlasHeading {
    fun normalize(angle: Double): Double = ((angle % 360.0) + 360.0) % 360.0
    fun signedDelta(from: Double, to: Double): Double =
        (normalize(to - from + 180.0) - 180.0)
    fun angleDifference(from: Double, to: Double): Double =
        abs(signedDelta(from, to))
    // At walking/stationary speeds the GPS course can be noisy or missing.
    // Above this threshold a real GPS course is independent of the device's
    // physical orientation (for example a phone on a dashboard or mount).
    const val MIN_GPS_COURSE_SPEED_MPS = 1.2

    fun hasTravelHeading(speed: Double, gpsBearing: Double?, lastTravelBearing: Double?): Boolean =
        speed.isFinite() && speed >= MIN_GPS_COURSE_SPEED_MPS &&
            (valid(gpsBearing) != null || valid(lastTravelBearing) != null)

    private fun valid(bearing: Double?): Double? =
        bearing?.takeIf { it.isFinite() && it >= 0.0 }

    fun choose(
        navigating: Boolean,
        speed: Double,
        routeBearing: Double?,
        gpsBearing: Double?,
        deviceBearing: Double?,
        lastTravelBearing: Double?
    ): Double {
        val travel = if (speed.isFinite() && speed >= MIN_GPS_COURSE_SPEED_MPS)
            valid(routeBearing) ?: valid(gpsBearing) ?: valid(lastTravelBearing) else null
        // While stopped, retain the last confirmed direction of movement.
        // If navigation starts at rest, the route is a more reliable heading
        // than phone magnetometer noise. Never derive travel from compass turns.
        val result = if (navigating)
            travel ?: valid(lastTravelBearing) ?: valid(routeBearing) ?: valid(deviceBearing)
        else
            // Free exploration must track the direction of *movement*, not
            // the azimuth of the handset, when a reliable course exists.
            // Retain compass behaviour when stopped and while walking slowly.
            travel ?: valid(deviceBearing) ?: valid(lastTravelBearing)
        return normalize(result ?: 0.0)
    }
}
