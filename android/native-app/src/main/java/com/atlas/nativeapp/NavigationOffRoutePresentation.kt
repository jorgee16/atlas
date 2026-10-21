package com.atlas.nativeapp

import kotlin.math.max

/**
 * Keep confirmed off-route GPS positions independent of map-matched road
 * origins. Rerouting may snap a private car park to the nearest mapped road,
 * which is NOT the device location. Only new real, moving, on-road fixes
 * return the cursor to route-constrained presentation.
 */
internal class NavigationOffRoutePresentation {
    companion object {
        /** Never teleport from a 1 Hz driving fix at an ordinary off-route
         * handoff. Background resume/Start own their separate explicit rebases.
         */
        fun animateHandoff(fix: Fix, visible: Coordinate?, walking: Boolean): Boolean {
            if (visible == null || !fix.accuracy.isFinite() ||
                fix.accuracy > 35.0 || fix.accuracy < 0.0) return false
            val speed = StationaryMapPosition.visualSpeed(fix)
            return speed.isFinite() && speed >= if (walking) 0.45 else 1.2
        }
    }

    var active: Boolean = false
        private set
    private var backOnRouteFixes = 0
    private var lastPairedFixTime = Double.NEGATIVE_INFINITY

    fun reset() {
        active = false
        backOnRouteFixes = 0
        lastPairedFixTime = Double.NEGATIVE_INFINITY
    }

    // True on the first independently confirmed off-route observation only.
    fun observe(navigating: Boolean, fix: Fix, pairedRealGuidance: Boolean,
                confirmedDeparture: Boolean, offRouteMeters: Double,
                state: String): Boolean {
        if (!navigating) { reset(); return false }
        if (!pairedRealGuidance || fix.time <= lastPairedFixTime) return false
        lastPairedFixTime = fix.time
        if (confirmedDeparture) {
            backOnRouteFixes = 0
            if (!active) { active = true; return true }
            return false
        }
        if (active) {
            val backOnRoad = state == "normal" && fix.motionConfirmed == true &&
                fix.accuracy.isFinite() && fix.accuracy <= 20.0 &&
                offRouteMeters.isFinite() &&
                offRouteMeters <= max(12.0, fix.accuracy * 1.5)
            backOnRouteFixes = if (backOnRoad) backOnRouteFixes + 1 else 0
            if (backOnRouteFixes >= 3) reset()
        }
        return false
    }
}
