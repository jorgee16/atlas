package com.atlas.nativeapp

import kotlin.math.max
import kotlin.math.min

/**
 * Map matching produces a virtual road coordinate, not a new GPS observation.
 * Before the first visual road match, do not replace a stationary or distant
 * raw fix with an arbitrary routable point (especially with indoor GPS).
 * Native guidance is still free to calculate and retain a routable origin.
 */
internal object NavigationInitialMatchPolicy {
    fun canAdopt(fix: Fix, offRouteMeters: Double, walking: Boolean): Boolean {
        if (!fix.accuracy.isFinite() || fix.accuracy < 0.0 ||
            !offRouteMeters.isFinite() || offRouteMeters < 0.0) return false
        val tolerance = max(12.0, min(50.0, fix.accuracy * 1.5))
        if (offRouteMeters > tolerance) return false
        val speed = StationaryMapPosition.visualSpeed(fix)
        val moving = fix.motionConfirmed != false &&
            speed.isFinite() && speed >= if (walking) 0.45 else 1.2
        // Good GPS close to the road can adopt its projection once. Poor
        // stationary GPS must remain visually at its measured coordinates.
        return moving || fix.accuracy <= 35.0
    }
}
