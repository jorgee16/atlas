package com.atlas.nativeapp

/**
 * Viewport available for a FULL-route Overview in landscape.
 * Guidance and the arrival HUD occupy the LEFT SIDE of the display;
 * they do not cover the BOTTOM of the exposed map. Reserving a portrait
 * bottom sheet envelope here shrinks a north/south trip to a narrow strip.
 *
 * Coordinates/route remain unchanged; these are MapLibre pixel paddings.
 */
internal object OverviewLandscapeInsets {
    fun compute(width:Int,height:Int,panelsRight:Int,
                systemTop:Int,systemRight:Int,systemBottom:Int,dp:Int):IntArray {
        val unit=dp.coerceAtLeast(1)
        // MapLibre needs a positive drawable space. On unusually small
        // screens scale panel clearance rather than invalidating camera fit.
        val left=(panelsRight.coerceAtLeast(0)+20*unit)
            .coerceAtMost((width*0.70).toInt())
        val top=(systemTop+16*unit).coerceAtMost((height*0.17).toInt())
        val right=(systemRight+68*unit).coerceAtMost((width*0.22).toInt())
        val bottom=(systemBottom+18*unit).coerceAtMost((height*0.17).toInt())
        return intArrayOf(left,top,right,bottom)
    }
}
