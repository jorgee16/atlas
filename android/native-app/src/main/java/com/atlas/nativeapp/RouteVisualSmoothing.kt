package com.atlas.nativeapp

import org.maplibre.android.geometry.LatLng
import kotlin.math.*

/** Display-only geometry. Original routing/matching/guidance coordinates remain authoritative. */
internal object RouteVisualSmoothing {
    private const val METRES = 111_320.0

    class Prepared internal constructor(
        val points: List<LatLng>,
        private val original: List<LatLng>,
        private val originalAlong: DoubleArray,
        private val sampleOriginalAlong: DoubleArray,
        private val visualAlong: DoubleArray
    ) {
        /** Paint boundary on one immutable line; never rebuild curves on GPS ticks. */
        fun fraction(segment: Int, position: LatLng): Double {
            if (original.size < 2 || visualAlong.lastOrNull()?.let { it > 0 } != true) return 0.0
            val i = segment.coerceIn(0, original.size - 2)
            val a = original[i]; val b = original[i + 1]
            val sx = METRES * cos(Math.toRadians((a.latitude + b.latitude) * .5))
            val dx = (b.longitude - a.longitude) * sx
            val dy = (b.latitude - a.latitude) * METRES
            val length2 = dx * dx + dy * dy
            val t = if (length2 > 1e-12) (((position.longitude - a.longitude) * sx * dx +
                (position.latitude - a.latitude) * METRES * dy) / length2).coerceIn(0.0, 1.0) else 0.0
            val along = originalAlong[i] + (originalAlong[i + 1] - originalAlong[i]) * t
            var lo = 0; var hi = sampleOriginalAlong.lastIndex
            while (lo < hi) {
                val mid = (lo + hi) ushr 1
                if (sampleOriginalAlong[mid] < along) lo = mid + 1 else hi = mid
            }
            if (lo == 0) return 0.0
            val span = sampleOriginalAlong[lo] - sampleOriginalAlong[lo - 1]
            val f = if (span > 0) ((along - sampleOriginalAlong[lo - 1]) / span).coerceIn(0.0, 1.0) else 0.0
            return ((visualAlong[lo - 1] + f * (visualAlong[lo] - visualAlong[lo - 1])) /
                visualAlong.last()).coerceIn(0.0, 1.0)
        }
    }

    fun smooth(route: List<LatLng>): List<LatLng> = prepare(route).points

    fun prepare(route: List<LatLng>, protectedPoints: Set<Int> = emptySet(), walking: Boolean = false): Prepared {
        val original = route.toList()
        val rawAlong = DoubleArray(route.size)
        for (i in 1 until route.size) rawAlong[i] = rawAlong[i - 1] + distance(route[i - 1], route[i])
        val output = ArrayList<LatLng>(route.size * 2)
        val sampleAlong = ArrayList<Double>(route.size * 2)
        fun add(point: LatLng, at: Double) { output.add(point); sampleAlong.add(at) }
        if (route.isNotEmpty()) add(route.first(), 0.0)
        val limit = if (walking) .35 else .9
        for (i in 1 until route.lastIndex) {
            val a = route[i - 1]; val b = route[i]; val c = route[i + 1]
            val l1 = distance(a, b); val l2 = distance(b, c)
            val signedTurn = turn(route, i)
            val angle = abs(signedTurn)
            val continuousBend = listOf(i - 1, i + 1).any {
                val adjacent = turn(route, it)
                adjacent * signedTurn > 0 && abs(adjacent) in 4.0..100.0
            }
            if (i in protectedPoints || !l1.isFinite() || !l2.isFinite() || min(l1, l2) < 2.0 ||
                angle < 1.0 || angle > 100.0 || (angle > 38.0 && !continuousBend) ||
                output.size > route.size + 200_000) {
                add(b, rawAlong[i]); continue
            }
            // Trim distance adapts to perpendicular error, not an invisible 2.4m trim.
            val trim = min(35.0, min(min(l1, l2) * .4, 4.0 * limit / sin(Math.toRadians(angle))))
            val entry = mix(b, a, trim / l1)
            val exit = mix(b, c, trim / l2)
            val flatness = trim * sin(Math.toRadians(angle * .5))
            val count = ((ceil(sqrt(flatness / .05)).toInt() + 1) / 2 * 2).coerceIn(4, 16)
            val curve = (0..count).map { sample ->
                val t = sample.toDouble() / count
                val u = 1.0 - t
                LatLng(u * u * entry.latitude + 2 * u * t * b.latitude + t * t * exit.latitude,
                    u * u * entry.longitude + 2 * u * t * b.longitude + t * t * exit.longitude)
            }
            // A convex quadratic plus this explicit corridor test prevents spline overshoot.
            if (curve.any { min(segmentDistance(it, a, b), segmentDistance(it, b, c)) > limit + .01 }) {
                add(b, rawAlong[i]); continue
            }
            curve.forEachIndexed { j, point -> add(point, rawAlong[i] - trim + 2 * trim * j / count) }
        }
        if (route.size > 1) add(route.last(), rawAlong.last())
        val visualAlong = DoubleArray(output.size)
        for (i in 1 until output.size) visualAlong[i] = visualAlong[i - 1] + distance(output[i - 1], output[i])
        return Prepared(output, original, rawAlong, sampleAlong.toDoubleArray(), visualAlong)
    }

    private fun mix(a: LatLng, b: LatLng, f: Double) = LatLng(
        a.latitude + (b.latitude - a.latitude) * f, a.longitude + (b.longitude - a.longitude) * f)

    internal fun distance(a: LatLng, b: LatLng): Double = hypot(
        (b.latitude - a.latitude) * METRES,
        (b.longitude - a.longitude) * METRES * cos(Math.toRadians((a.latitude + b.latitude) * .5)))

    private fun turn(points: List<LatLng>, i: Int): Double {
        if (i <= 0 || i >= points.lastIndex) return 0.0
        val a = points[i - 1]; val b = points[i]; val c = points[i + 1]
        val scale = cos(Math.toRadians(b.latitude))
        val x1 = (b.longitude - a.longitude) * scale; val y1 = b.latitude - a.latitude
        val x2 = (c.longitude - b.longitude) * scale; val y2 = c.latitude - b.latitude
        return Math.toDegrees(atan2(x1 * y2 - y1 * x2, x1 * x2 + y1 * y2))
    }

    internal fun segmentDistance(p: LatLng, a: LatLng, b: LatLng): Double {
        val sx = METRES * cos(Math.toRadians(p.latitude))
        val dx = (b.longitude - a.longitude) * sx; val dy = (b.latitude - a.latitude) * METRES
        val px = (p.longitude - a.longitude) * sx; val py = (p.latitude - a.latitude) * METRES
        val length2 = dx * dx + dy * dy
        val t = if (length2 > 1e-12) ((px * dx + py * dy) / length2).coerceIn(0.0, 1.0) else 0.0
        return hypot(px - dx * t, py - dy * t)
    }
}
