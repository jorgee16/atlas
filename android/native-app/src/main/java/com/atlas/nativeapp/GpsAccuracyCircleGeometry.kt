package com.atlas.nativeapp

import kotlin.math.cos
import kotlin.math.max

/** Geodesic eastward offset for the reported horizontal GNSS accuracy. */
internal object GpsAccuracyCircleGeometry {
    fun eastLongitude(latitude: Double, longitude: Double, accuracyMeters: Double): Double? {
        if(!latitude.isFinite() || latitude !in -85.0..85.0 ||
            !longitude.isFinite() || !accuracyMeters.isFinite() ||
            accuracyMeters<=0.0 || accuracyMeters>10000.0)return null
        val longitudeMetresPerDegree=111_320.0*max(
            cos(Math.toRadians(latitude)),0.05)
        return longitude+accuracyMeters/longitudeMetresPerDegree
    }
}
