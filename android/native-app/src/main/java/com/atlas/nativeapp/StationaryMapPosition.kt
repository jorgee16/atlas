package com.atlas.nativeapp

import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max

/**
 * Visual-only position stabilizer for a stopped car. Navigation decisions,
 * off-route checks and voice guidance still use real GPS fixes in C++.
 * Every candidate must come from the current guidance's route projection.
 */
internal class StationaryMapPosition {
    private var stable: Coordinate? = null
    private var candidateGroup: Coordinate? = null
    private var candidateFixes = 0
    private var previousFixTime = Double.NEGATIVE_INFINITY

    fun reset() {
        stable = null
        candidateGroup = null
        candidateFixes = 0
        previousFixTime = Double.NEGATIVE_INFINITY
    }

    fun select(position: Coordinate, fix: Fix, navigating: Boolean, walking: Boolean): Coordinate {
        if (!navigating || walking || !fix.speed.isFinite() || fix.speed >= 1.2) {
            reset()
            if (navigating && !walking) stable = position
            return position
        }
        val anchor = stable
        if (anchor == null) {
            stable = position
            previousFixTime = fix.time
            return position
        }
        // Inaccurate stationary fixes can shift road projections by tens
        // of metres. Camera and cursor must not chase each fluctuation.
        val noiseRadius = max(10.0, fix.accuracy.coerceIn(0.0, 30.0) * 1.2)
        if (distance(anchor, position) <= noiseRadius) {
            candidateGroup = null
            candidateFixes = 0
            previousFixTime = max(previousFixTime, fix.time)
            return anchor
        }
        // A fresh and consistent location may indicate that initial GPS was
        // wrong (or the car has started very slowly). Require three distinct
        // timestamps near the same new point before re-anchoring.
        if (fix.time > previousFixTime) {
            previousFixTime = fix.time
            val previous = candidateGroup
            if (previous == null ||
                distance(previous, position) > max(12.0, fix.accuracy.coerceIn(0.0, 25.0))) {
                candidateGroup = position
                candidateFixes = 1
            } else {
                candidateFixes++
            }
            if (candidateFixes >= 3) {
                stable = position
                candidateGroup = null
                candidateFixes = 0
                return position
            }
        }
        return anchor
    }

    private fun distance(a: Coordinate, b: Coordinate): Double {
        val mid = Math.toRadians((a.lat + b.lat) * 0.5)
        return hypot((b.lat - a.lat) * 111_320.0,
            (b.lon - a.lon) * 111_320.0 * cos(mid))
    }
}
