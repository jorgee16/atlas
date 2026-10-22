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
    // Physical movement is independent of a potentially reversed route segment.
    // Valid only for the most recently observed GPS fix.
    private var lastDisplacementHeading: Double? = null
    private var course: Double? = null
    private var turnCandidate: Double? = null
    private var turnCount = 0
    private var routeCandidate: Double? = null
    private var routeCandidateCount = 0

    fun reset() {
        lastTime=Double.NEGATIVE_INFINITY
        lastPoint=null
        lastAccuracy=Double.POSITIVE_INFINITY
        lastDisplacementHeading=null
        course=null
        turnCandidate=null;turnCount=0
        routeCandidate=null;routeCandidateCount=0
    }
    fun ownsMovingHeading(fix: Fix) =
        fix.speed.isFinite() && fix.speed >= 2.0 && course != null

    fun resolve(fix: Fix, compass: Double?, navigating: Boolean,
        routeBearing: Double? = null, onRoute: Boolean = false): Double {
        observe(fix)
        val fallback = compass?.takeIf { it.isFinite() && it >= 0.0 }
        val route = routeBearing?.takeIf { it.isFinite() && it >= 0.0 }
        // Copy mutable filter state into a local immutable snapshot for
        // one coherent reading of movement and guidance.
        val stableCourse = course
        if (navigating && onRoute && route != null) {
            // A fresh, accurate GNSS course corroborated by actual position
            // displacement is stronger evidence than a projected route edge.
            // In particular, rerouting on roundabouts / parallel roads can
            // return an on-route but opposite-direction segment. Never steer
            // the camera toward it while the car is demonstrably moving in
            // another direction.
            val verifiedGnss = fix.providerBearing?.takeIf {
                it.isFinite() && it >= 0.0 && fix.speed >= 2.0 &&
                    fix.accuracy.isFinite() && fix.accuracy <= 25.0 &&
                    fix.bearingAccuracy != null && fix.bearingAccuracy.isFinite() &&
                    fix.bearingAccuracy <= 15.0
            }?.takeIf { raw ->
                lastDisplacementHeading?.let { displacement ->
                    abs(AtlasHeading.signedDelta(raw, displacement)) <= 26.0
                } == true
            }
            if (verifiedGnss != null &&
                abs(AtlasHeading.signedDelta(verifiedGnss, route)) > 55.0) {
                routeCandidate = null
                routeCandidateCount = 0
                return stableCourse ?: verifiedGnss
            }
            // A fresh reroute can select an opposite-direction segment on
            // dual carriageways or roundabouts. Do not flip the camera 180°
            // from one projected segment while actual travel says otherwise.
            if (stableCourse != null && fix.speed >= 2.0 &&
                abs(AtlasHeading.signedDelta(stableCourse,route)) > 110.0) {
                val repeat = routeCandidate != null &&
                    abs(AtlasHeading.signedDelta(routeCandidate!!,route)) < 25.0
                routeCandidateCount = if (repeat) routeCandidateCount + 1 else 1
                routeCandidate = route
                // Rerouting geometry alone is not enough evidence to reverse
                // travel direction; confirmed course catches up after a U-turn.
                return stableCourse
            }
            routeCandidate = null
            routeCandidateCount = 0
            // A changing map match must not pull a confirmed moving GNSS
            // direction towards a different road at every 1 Hz update,
            // then release it on the next "checking" or "reduced" state.
            // GNSS owns driving direction; route geometry only nudges it.
            val weight = if (usable(fix)) 0.16 else 0.90
            return if (stableCourse == null) route else mix(stableCourse, route, weight)
        }
        routeCandidate = null
        routeCandidateCount = 0
        // At road speeds do not use phone orientation as vehicle direction.
        if (fix.speed.isFinite() && fix.speed >= 2.0)
            return if (navigating) course ?: fix.bearing?.takeIf { it.isFinite() && it >= 0.0 }
                ?: route ?: 0.0
            else course ?: fallback ?: 0.0
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
        lastDisplacementHeading = null
        lastTime = f.time
        lastPoint = f.point
        lastAccuracy = f.accuracy
        var displacementHeading: Double? = null
        // GNSS may pause for several seconds during rerouting, screenshots or a
        // short tunnel. The first reacquired fix can still supply independent
        // position-displacement evidence for a real turn. A five-second cap
        // left an old camera course in charge even after a fresh, accurate
        // GNSS bearing and physical displacement agreed on the new direction.
        if (previous != null && elapsed in 0.5..12.0 &&
            f.accuracy.isFinite() && previousAccuracy.isFinite() &&
            f.accuracy <= 35.0) {
            val lat = Math.toRadians((previous.lat + f.point.lat) / 2.0)
            val meters = hypot((previous.lat - f.point.lat) * 111320.0,
                (previous.lon - f.point.lon) * 111320.0 * cos(lat))
            // At 1 Hz an 8 m/s car travels almost exactly eight metres.
            // An eight-metre floor discarded that evidence due to coordinate
            // rounding, so a real U-turn looked like uncorroborated GNSS noise.
            val enough = meters >= max(6.0, max(f.accuracy, previousAccuracy) * 1.3)
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
        lastDisplacementHeading = displacementHeading
        val good = usable(f)
        // C++'s heading may be calculated from successive coordinates.
        // When Android reports a credible *bearing accuracy*, prefer the
        // raw GNSS course to a direction estimated from noisy positions.
        val providerCourse = f.providerBearing?.takeIf {
            it.isFinite() && it >= 0.0 && f.bearingAccuracy != null &&
                f.bearingAccuracy.isFinite() && f.bearingAccuracy <= 35.0
        }
        val candidate = if (good) providerCourse ?: f.bearing else displacementHeading
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
        // Two reversed GNSS fixes are common after rerouting. A true U-turn
        // can commit immediately with displacement evidence, or after three
        // consistent fixes; ordinary bends retain the shorter confirmation.
        val confirmations = if (change > 110.0) 3 else 2
        if (corroborated) {
            // Independent displacement confirms the new course. The camera
            // already eases rotation per frame; limiting it again per GPS fix
            // leaves the map facing backwards for several seconds after a
            // genuine reversal. Inverted bearings without motion agreement
            // still require the existing confirmation policy below.
            course=normalized
        } else if (turnCount >= confirmations) {
            val maximumStep = AtlasHeading.signedDelta(old, normalized).coerceIn(-55.0,55.0)
            course = AtlasHeading.normalize(old + maximumStep * 0.58)
        }
    }

    private fun mix(a: Double, b: Double, weight: Double) =
        AtlasHeading.normalize(a + AtlasHeading.signedDelta(a,b) * weight)
}

