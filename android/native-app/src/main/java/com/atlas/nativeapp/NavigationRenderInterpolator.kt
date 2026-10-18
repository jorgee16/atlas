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
        for (i in lengths.indices) {
            lengths[i] = distance(points[i], points[i + 1])
            lineLength += lengths[i]
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
        gpsAccuracy: Double, fixTime: Double, walking: Boolean
    ): Boolean {
        if (vertices.isEmpty() || !along.isFinite() || !fixTime.isFinite() ||
            fixTime <= lastGpsAt) return false
        lastGpsAt = fixTime
        if (speed < 1.2 && !walking && lastAcceptedPosition?.let {
                distance(it, snapped) < 0.4
            } == true) {
            // StationaryMapPosition already rejected the GPS jitter. Do not
            // make the cursor creep based on a different noisy along value.
            measuredAt = fixTime
            measuredSpeed = 0.0
            predict = false
            return true
        }
        lastAcceptedPosition = snapped
        applyMeasurement(along, speed, gpsAccuracy, fixTime, walking, true)
        return true
    }

    /** Tunnel predictor output is a visual target, not a fresh GPS fix. */
    fun acceptGapPrediction(
        along: Double, predictedAt: Double, gpsAccuracy: Double,
        walking: Boolean
    ): Boolean {
        if (vertices.isEmpty() || !along.isFinite() || !predictedAt.isFinite() ||
            predictedAt <= lastGapAt || predictedAt <= lastGpsAt) return false
        lastGapAt = predictedAt
        applyMeasurement(along, 0.0, gpsAccuracy, predictedAt, walking, false)
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
        val next = prev + (target - prev) * (1 - exp(-rate * dt))
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
