package com.atlas.nativeapp

/**
 * Framing only. Coordinates, native GPS, route projection and movement
 * recognition never depend on screen orientation.
 * MapLibre CameraPosition.padding is ordered LEFT, TOP, RIGHT, BOTTOM.
 */
internal object NavigationFollowFraming {
    fun padding(width: Int, height: Int,
                navigating: Boolean, headingUp: Boolean,
                landscape: Boolean): DoubleArray {
        if (!navigating || width<=0 || height<=0) return doubleArrayOf(0.0,0.0,0.0,0.0)
        // The landscape HUD is below-left, the guidance banner above-left.
        // Shift the *screen framing* to the free centre/right and above the
        // arrival HUD; never shift the GPS/map-matched coordinate itself.
        if (landscape) return doubleArrayOf(width*0.18,0.0,0.0,height*0.24)
        return doubleArrayOf(0.0,if(headingUp)height*0.30 else 0.0,0.0,0.0)
    }
}
