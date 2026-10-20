package com.atlas.nativeapp

/**
 * Stabilizes visual positions while a navigation fix has no motion evidence.
 * A collection of consecutive GNSS fixes is not proof of physical travel:
 * indoors all of them can drift consistently towards the wrong road segment.
 * Routing/arrival/rerouting still use real fixes in the native engine.
 */
internal class StationaryMapPosition {
    private var stable: Coordinate? = null
    private var previousWalking: Boolean? = null

    fun reset() {
        stable = null
        previousWalking = null
    }

    /** A one-time projection reference for a new navigation visual epoch. */
    fun rebase(position: Coordinate, fix: Fix, walking: Boolean) {
        reset()
        previousWalking = walking
        stable = position
    }

    fun select(position: Coordinate, fix: Fix, navigating: Boolean, walking: Boolean): Coordinate {
        if (previousWalking != walking) {
            reset()
            previousWalking = walking
        }
        val movingThreshold = if (walking) 0.45 else 1.2
        val speed = visualSpeed(fix)
        if (!navigating || (speed.isFinite() && speed >= movingThreshold)) {
            reset()
            previousWalking = walking
            if (navigating) stable = position
            return position
        }
        // Stationary/unknown speed: keep the same anchor even if several fixes
        // agree on a new position. A new confident motion fix releases it.
        return stable ?: position.also { stable = it }
    }

    companion object {
        fun visualSpeed(fix: Fix): Double =
            fix.providerSpeed?.takeIf { it.isFinite() && it >= 0.0 } ?: fix.speed
    }
}
