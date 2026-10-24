package com.atlas.nativeapp

import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Visual-only, route-constrained rendering between 1 Hz real GPS fixes.
 *
 * GPS, route matching, progress, arrival and reroute decisions never read this
 * class. Measurements come only from accepted C++ guidance along the route.
 * A separately marked prediction from the tunnel-gap predictor may feed a
 * visual target, but must never be predicted a second time here.
 *
 * All times use Android elapsedRealtimeNanos / 1e9, not wall-clock time.
 */
internal class NavigationRenderInterpolator {
    data class Frame(val position: Coordinate, val along: Double, val active: Boolean)
    private var vertices: List<Coordinate> = emptyList()
    private var lengths = DoubleArray(0)
    private var prefixMeters = DoubleArray(0)
    private var lineLength = 0.0
    private var routeMeters = 0.0
    private var measuredAlong = 0.0
    private var renderedAlong: Double? = null
    private var measuredAt = Double.NEGATIVE_INFINITY
    private var lastGpsAt = Double.NEGATIVE_INFINITY
    private var lastGapAt = Double.NEGATIVE_INFINITY
    private var lastFrameAt = Double.NaN
    private var measuredSpeed = 0.0
    private var accuracy = 10.0
    private var walking = false
    private var predict = false
    private var predictionQuality = 0.0
    private var lastAcceptedPosition: Coordinate? = null

    fun reset() {
        vertices = emptyList()
        lengths = DoubleArray(0)
        prefixMeters = DoubleArray(0)
        lineLength = 0.0
        routeMeters = 0.0
        measuredAlong = 0.0
        renderedAlong = null
        measuredAt = Double.NEGATIVE_INFINITY
        lastGpsAt = Double.NEGATIVE_INFINITY
        lastGapAt = Double.NEGATIVE_INFINITY
        lastFrameAt = Double.NaN
        measuredSpeed = 0.0
        predict = false
        predictionQuality = 0.0
        lastAcceptedPosition = null
    }

    fun setRoute(points: List<Coordinate>, distanceMeters: Double, previousPosition: Coordinate? = null) {
        val previousMeasurementAt = measuredAt
        reset()
        if (points.size < 2 || !distanceMeters.isFinite() || distanceMeters <= 0.0) return
        vertices = points
        routeMeters = distanceMeters
        lengths = DoubleArray(points.size - 1)
        prefixMeters = DoubleArray(points.size)
        for (i in lengths.indices) {
            lengths[i] = distance(points[i], points[i + 1])
            lineLength += lengths[i]
            prefixMeters[i + 1] = lineLength
        }
        if (lineLength <= 0.0) {
            reset()
            return
        }
        // Preserve visible continuity across rerouting: seed the new progress
        // from the last rendered cursor, but only if it is near the new route.
        // A genuinely different road must not be silently snapped.
        val seed = previousPosition?.let { closestAlong(it) }
        if (seed != null && seed.second <= 55.0) {
            measuredAlong = seed.first
            renderedAlong = seed.first
            // Display the carried position immediately. The first native
            // projection on the new route will replace this measurement.
            measuredAt = previousMeasurementAt
            lastFrameAt = Double.NaN
        }
    }

    private fun closestAlong(position: Coordinate): Pair<Double,Double>? {
        if (vertices.size < 2 || lineLength <= 0.0) return null
        var travelled = 0.0
        var bestError = Double.POSITIVE_INFINITY
        var bestAlong = 0.0
        for (index in lengths.indices) {
            val a = vertices[index]
            val b = vertices[index + 1]
            val latitude = Math.toRadians((a.lat + b.lat) * .5)
            val east = (b.lon - a.lon) * 111_320.0 * cos(latitude)
            val north = (b.lat - a.lat) * 111_320.0
            val pe = (position.lon - a.lon) * 111_320.0 * cos(latitude)
            val pn = (position.lat - a.lat) * 111_320.0
            val norm = east * east + north * north
            val factor = if (norm > 0.0) ((pe * east + pn * north) / norm).coerceIn(0.0,1.0) else 0.0
            val error = hypot(pe - factor * east, pn - factor * north)
            if (error < bestError) {
                bestError = error
                bestAlong = (travelled + lengths[index] * factor) / lineLength * routeMeters
            }
            travelled += lengths[index]
        }
        return if (bestError.isFinite()) bestAlong to bestError else null
    }

    /**
     * Called for one new, confirmed GPS-guidance fix. Duplicate state emissions
     * and out-of-order fixes do not restart the prediction clock.
     */
    fun acceptGps(
        along: Double, snapped: Coordinate, speed: Double,
        gpsAccuracy: Double, fixTime: Double, walking: Boolean, bearingAccuracy: Double? = null
    ): Boolean {
        if (vertices.isEmpty() || !along.isFinite() || !fixTime.isFinite() ||
            fixTime <= lastGpsAt) return false
        lastGpsAt = fixTime
        if (speed < (if(walking) 0.45 else 1.2) && renderedAlong != null) {
            // No confirmed motion: retain precisely what was last drawn.
            // Route-projection changes are measurement uncertainty, not travel.
            // In particular, do not animate towards a newly matched segment
            // while the device is stationary.
            measuredAlong = renderedAlong ?: measuredAlong
            measuredAt = fixTime
            measuredSpeed = 0.0
            predict = false
            return true
        }
        lastAcceptedPosition = snapped
        applyMeasurement(along, speed, gpsAccuracy, fixTime, walking, true)
        // Route-constrained prediction still depends on evidence of movement.
        // Weak GNSS course reduces the horizon; it never changes native progress.
        if (bearingAccuracy != null) {
            predictionQuality *= if (bearingAccuracy.isFinite() && bearingAccuracy >= 0.0)
                ((90.0-bearingAccuracy)/55.0).coerceIn(0.0,1.0) else 0.0
        }
        return true
    }

    /** A trustworthy, fresh and matched GPS fix has moved far beyond the
     * previously rendered cursor. Catch up once instead of replaying the
     * missed distance at a few metres per second. Never called for predictions
     * or inaccurate/off-route fixes.
     */
    fun synchronizeConfirmedGps(along: Double, snapped: Coordinate, fixTime: Double) {
        if (vertices.isEmpty() || !along.isFinite() || !fixTime.isFinite()) return
        val confirmed = along.coerceIn(0.0, routeMeters)
        measuredAlong = confirmed
        renderedAlong = confirmed
        measuredAt = fixTime
        lastGpsAt = max(lastGpsAt, fixTime)
        lastFrameAt = Double.NaN
        lastAcceptedPosition = snapped
    }

    /** Camera-only tangent along the displayed route. Does not affect GPS
     * heading, map matching or routing confidence. A short symmetric segment
     * gives the vehicle's visual direction on curved roads/roundabouts. */
    fun visualBearing(along: Double, aheadMeters: Double = 7.0): Double? {
        if (vertices.size < 2 || !along.isFinite() || routeMeters <= 0) return null
        val from=atDistance((along - 2.0).coerceAtLeast(0.0))
        val to=atDistance((along + aheadMeters.coerceIn(3.0,15.0)).coerceAtMost(routeMeters))
        val north=(to.lat-from.lat)*111_320.0
        val east=(to.lon-from.lon)*111_320.0*
            cos(Math.toRadians((from.lat+to.lat)*.5))
        if (hypot(east,north)<0.5) return null
        return (Math.toDegrees(kotlin.math.atan2(east,north))+360.0)%360.0
    }

    /**
     * Project the FINAL displayed cursor onto nearby original route segments.
     * The 1 Hz guidance progress is only a search hint: presentation limiting
     * can put the visible cursor several metres BEHIND that progress in bends.
     *
     * Prefix-length binary search + local scan bounds this 30 FPS operation
     * rather than projecting against the entire Portugal route each frame.
     * Returning null on a distant/ambiguous position preserves GNSS heading.
     */
    fun visualBearingAt(position: Coordinate, nearAlong: Double,
                        aheadMeters: Double = 7.0): Double? {
        if (vertices.size < 2 || !nearAlong.isFinite() || lineLength <= 0.0)
            return null
        val hint = nearAlong.coerceIn(0.0,routeMeters) / routeMeters * lineLength
        val lowMetres = (hint - 75.0).coerceAtLeast(0.0)
        val highMetres = (hint + 45.0).coerceAtMost(lineLength)
        fun indexFor(metres: Double): Int {
            var lo = 0; var hi = prefixMeters.lastIndex
            while (lo + 1 < hi) {
                val middle=(lo+hi) ushr 1
                if (prefixMeters[middle] <= metres) lo=middle else hi=middle
            }
            return lo.coerceIn(0,lengths.lastIndex)
        }
        val start=indexFor(lowMetres)
        val end=indexFor(highMetres)
        var bestScore=Double.POSITIVE_INFINITY
        var bestDistance=Double.POSITIVE_INFINITY
        var bestAlong=Double.NaN
        for (i in start..end) {
            val a=vertices[i]
            val b=vertices[i+1]
            val lat=Math.toRadians((a.lat+b.lat)*0.5)
            val east=(b.lon-a.lon)*111_320.0*cos(lat)
            val north=(b.lat-a.lat)*111_320.0
            val pe=(position.lon-a.lon)*111_320.0*cos(lat)
            val pn=(position.lat-a.lat)*111_320.0
            val lengthSquared=east*east+north*north
            val f=if(lengthSquared>1e-8)
                ((pe*east+pn*north)/lengthSquared).coerceIn(0.0,1.0)
                else 0.0
            val distance=hypot(pe-east*f,pn-north*f)
            val along=prefixMeters[i]+lengths[i]*f
            // Disambiguate nearby parallel carriageways / looped roads using
            // progress, without ignoring the physically drawn cursor.
            val score=distance + kotlin.math.abs(along-hint)*0.03
            if (score<bestScore) {
                bestScore=score
                bestDistance=distance
                bestAlong=along
            }
        }
        if (bestDistance>12.0 || !bestAlong.isFinite()) return null
        return visualBearing(bestAlong/lineLength*routeMeters,aheadMeters)
    }

    /** Align a stopped filter with the point the route renderer actually drew. */
    fun holdStationary(position: Coordinate) {
        measuredAlong=renderedAlong ?: measuredAlong
        measuredSpeed=0.0
        predict=false
        lastAcceptedPosition=position
    }
    /** Tunnel predictor output is a visual target, not a fresh GPS fix. */
    fun acceptGapPrediction(
        along: Double, predictedAt: Double, gpsAccuracy: Double,
        walking: Boolean
    ): Boolean {
        if (vertices.isEmpty() || !along.isFinite() || !predictedAt.isFinite() ||
            predictedAt <= lastGapAt || predictedAt <= lastGpsAt) return false
        lastGapAt = predictedAt
        // A gap target is already predicted: disable extrapolation, but retain
        // the observed speed for the correction budget. Setting speed to zero
        // capped an 8m/s car at 4m/s and accumulated visual lag in every gap.
        applyMeasurement(along, measuredSpeed, gpsAccuracy, predictedAt, walking, false)
        return true
    }

    private fun applyMeasurement(
        along: Double, speed: Double, gpsAccuracy: Double,
        time: Double, walking: Boolean, realGps: Boolean
    ) {
        measuredAlong = along.coerceIn(0.0, routeMeters)
        if (renderedAlong == null) renderedAlong = measuredAlong
        measuredSpeed = speed.takeIf { it.isFinite() && it > 0.0 }
            ?.coerceAtMost(if (walking) 3.5 else 45.0) ?: 0.0
        accuracy = gpsAccuracy.takeIf { it.isFinite() && it >= 0 } ?: 60.0
        measuredAt = time
        this.walking = walking
        // As on the original Atlas, prediction is confidence weighted, not
        // abruptly switched off when horizontal accuracy crosses 35 m.
        // Walking has a shorter horizon and stricter confidence curve.
        predictionQuality = ((
            (if (walking) 55.0 else 65.0) - accuracy
        ) / 30.0).coerceIn(0.0, 1.0)
        predict = realGps && predictionQuality > 0.0 &&
            measuredSpeed >= if (walking) 0.45 else 0.8
    }

    fun sample(now: Double): Frame? {
        if (vertices.isEmpty() || !now.isFinite() || !measuredAt.isFinite()) return null
        val limit = if (walking) 0.55 else 1.2
        val age = (now - measuredAt).coerceAtLeast(0.0)
        val prediction = if (predict)
            min(age, limit) * measuredSpeed * predictionQuality else 0.0
        val target = (measuredAlong + prediction).coerceIn(0.0, routeMeters)
        val prev = renderedAlong ?: target
        val dt = if (lastFrameAt.isFinite()) (now - lastFrameAt).coerceIn(0.0, 0.1) else 0.0
        lastFrameAt = now
        // Original Atlas exponential filter: alpha = 1 - exp(-k*dt).
        // Poor accuracy lowers the correction rate rather than causing jumps.
        val confidence = (30.0 / max(accuracy, 10.0)).coerceIn(0.12, 1.0)
        val rate = (if (walking) 3.2 else 2.8) * confidence
        val correction = (target - prev) * (1 - exp(-rate * dt))
        val budget = max(4.0,measuredSpeed*1.7+3.0)*dt
        val next = prev + correction.coerceIn(-budget,budget)
        renderedAlong = next.coerceIn(0.0, routeMeters)
        val continuing = predict && age < limit &&
            measuredAlong + measuredSpeed * predictionQuality * limit < routeMeters
        return Frame(atDistance(renderedAlong!!), renderedAlong!!,
            continuing || kotlin.math.abs(target - renderedAlong!!) > 0.10)
    }

    private fun atDistance(along: Double): Coordinate {
        val target = along.coerceIn(0.0, routeMeters) / routeMeters * lineLength
        var previous = 0.0
        for (i in lengths.indices) {
            val length = lengths[i]
            if (target <= previous + length || i == lengths.lastIndex) {
                val t = if (length > 0.0) ((target - previous) / length).coerceIn(0.0, 1.0) else 0.0
                val a = vertices[i]
                val b = vertices[i + 1]
                return Coordinate(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t)
            }
            previous += length
        }
        return vertices.last()
    }

    private fun distance(a: Coordinate, b: Coordinate): Double {
        val mid = Math.toRadians((a.lat + b.lat) * .5)
        return hypot((b.lat - a.lat) * 111_320.0,
            (b.lon - a.lon) * 111_320.0 * cos(mid))
    }
}


