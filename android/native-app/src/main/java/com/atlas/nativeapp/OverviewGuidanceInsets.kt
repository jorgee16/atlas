package com.atlas.nativeapp

/**
 * Stable top map padding in Overview. Guidance text and lane arrows grow or
 * shrink as GPS changes the upcoming maneuver; this must not refit the map.
 * Changes to the device viewport or manual Overview request still refit.
 */
internal object OverviewGuidanceInsets {
    fun top(insetPx:Int,navigating:Boolean,guidanceBottomPx:Int?,pixelsPerDp:Int):Int {
        val dp=pixelsPerDp.coerceAtLeast(1)
        val reserved=insetPx + dp*(if(navigating) 285 else 40)
        val occupied=if(guidanceBottomPx!=null)guidanceBottomPx + 20*dp else 0
        return maxOf(reserved,occupied)
    }
}
