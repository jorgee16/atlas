package com.atlas.nativeapp

import kotlin.math.abs

/** Normalise and select orientation independently of MapLibre rendering. */
internal object AtlasHeading {
    fun normalize(angle: Double): Double = ((angle % 360.0) + 360.0) % 360.0
    fun signedDelta(from: Double, to: Double): Double =
        (normalize(to - from + 180.0) - 180.0)
    fun angleDifference(from: Double, to: Double): Double =
        abs(signedDelta(from, to))
    fun choose(
        navigating: Boolean,
        speed: Double,
        routeBearing: Double?,
        gpsBearing: Double?,
        deviceBearing: Double?,
        lastTravelBearing: Double?
    ): Double {
        fun valid(v: Double?): Double? = v?.takeIf { it.isFinite() && it >= 0.0 }
        val travel = if (speed >= 1.2) valid(routeBearing) ?: valid(gpsBearing) else null
        val result = if (navigating)
            travel ?: valid(lastTravelBearing) ?: valid(deviceBearing)
        else
            valid(deviceBearing) ?: travel ?: valid(lastTravelBearing)
        return normalize(result ?: 0.0)
    }
}
