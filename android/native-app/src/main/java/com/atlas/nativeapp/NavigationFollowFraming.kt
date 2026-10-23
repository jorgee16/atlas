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
        // Landscape HUD + guidance occupy the LEFT, not the full bottom.
        // The previous BOTTOM 24% padding put the cursor near 38% screen
        // height, hiding most of the road AHEAD. A TOP 38% inset positions
        // the heading-up cursor near 69% while preserving left HUD clearance.
        // Keep north-up vertically centred: it has no directional "ahead".
        // This changes camera framing ONLY, not GPS, map matching or routing.
        if (landscape) return doubleArrayOf(
            width*0.18,if(headingUp)height*0.38 else 0.0,0.0,0.0)
        // Portrait: keep the present zoom/tilt and expose more of the
        // upcoming road by moving the cursor from 65% to about 73%.
        // Do not change the navigation position or simulate being on-route.
        return doubleArrayOf(0.0,if(headingUp)height*0.46 else 0.0,0.0,0.0)
    }
}
