package com.atlas.nativeapp

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin

/**
 * Visual heading from course over ground, displacement and route confidence.
 * Does NOT change native routing, map matching or the reported GPS position.
 */
internal class MotionHeadingStabilizer {
    private var lastTime = Double.NEGATIVE_INFINITY
    private var lastPoint: Coordinate? = null
    private var lastAccuracy = Double.POSITIVE_INFINITY
    private var course: Double? = null
    private var turnCandidate: Double? = null
    private var turnCount = 0

    fun ownsMovingHeading(fix: Fix) =
        fix.speed.isFinite() && fix.speed >= 2.0 && course != null

    fun resolve(fix: Fix, compass: Double?, navigating: Boolean,
        routeBearing: Double? = null, onRoute: Boolean = false): Double {
        observe(fix)
        val fallback = compass?.takeIf { it.isFinite() && it >= 0.0 }
        val route = routeBearing?.takeIf { it.isFinite() && it >= 0.0 }
        if (navigating && onRoute && route != null) {
            val weight = if (usable(fix)) 0.70 else 0.90
            return if (course == null) route else mix(course!!, route, weight)
        }
        // At road speeds do not use phone orientation as vehicle direction.
        if (fix.speed.isFinite() && fix.speed >= 2.0)
            return course ?: fallback ?: 0.0
        return if (navigating) course ?: route ?: fallback ?: 0.0
               else fallback ?: course ?: 0.0
    }

    private fun usable(f: Fix): Boolean {
        if (!f.speed.isFinite() || f.speed < 2.0 ||
            !f.accuracy.isFinite() || f.accuracy > 45.0 ||
            f.bearing == null || !f.bearing.isFinite() || f.bearing < 0.0) return false
        val err = f.bearingAccuracy
        return if (err != null) err.isFinite() && err <= 35.0
            else f.accuracy <= 20.0 || f.speed >= 7.0 && f.accuracy <= 35.0
    }

    private fun observe(f: Fix) {
        if (!f.time.isFinite() || f.time <= lastTime) return
        val elapsed = f.time - lastTime
        if (elapsed > 20.0) {
            course = null; turnCandidate = null; turnCount = 0
        }
        val previous = lastPoint
        val previousAccuracy = lastAccuracy
        lastTime = f.time
        lastPoint = f.point
        lastAccuracy = f.accuracy
        var displacementHeading: Double? = null
        if (previous != null && elapsed in 0.5..5.0 &&
            f.accuracy.isFinite() && previousAccuracy.isFinite() &&
            f.accuracy <= 35.0) {
            val lat = Math.toRadians((previous.lat + f.point.lat) / 2.0)
            val meters = hypot((previous.lat - f.point.lat) * 111320.0,
                (previous.lon - f.point.lon) * 111320.0 * cos(lat))
            val enough = meters >= max(8.0, max(f.accuracy, previousAccuracy) * 1.3)
            val plausible = meters / elapsed <= max(8.0, f.speed.coerceAtLeast(0.0) * 2.4 + 6.0)
            if (enough && plausible) {
                val dLon = Math.toRadians(f.point.lon - previous.lon)
                val a = Math.toRadians(previous.lat)
                val b = Math.toRadians(f.point.lat)
                displacementHeading = AtlasHeading.normalize(Math.toDegrees(atan2(
                    sin(dLon) * cos(b),
                    cos(a) * sin(b) - sin(a) * cos(b) * cos(dLon))))
            }
        }
        val good = usable(f)
        val candidate = if (good) f.bearing else displacementHeading
        if (candidate == null) return
        val normalized = AtlasHeading.normalize(candidate)
        val old = course
        if (old == null) { course = normalized; return }
        val change = abs(AtlasHeading.signedDelta(old, normalized))
        if (change < 36.0) {
            course = mix(old, normalized, if (good) 0.44 else 0.24)
            turnCandidate = null; turnCount = 0
            return
        }
        val corroborated = displacementHeading != null &&
            abs(AtlasHeading.signedDelta(displacementHeading, normalized)) <= 26.0
        val repeat = turnCandidate != null &&
            abs(AtlasHeading.signedDelta(turnCandidate!!, normalized)) <= 30.0
        turnCount = if (repeat) turnCount + 1 else 1
        turnCandidate = normalized
        if (corroborated || turnCount >= 2) {
            val maximumStep = AtlasHeading.signedDelta(old, normalized).coerceIn(-55.0,55.0)
            course = AtlasHeading.normalize(old + maximumStep * (if (corroborated) 0.75 else 0.58))
        }
    }

    private fun mix(a: Double, b: Double, weight: Double) =
        AtlasHeading.normalize(a + AtlasHeading.signedDelta(a,b) * weight)
}
