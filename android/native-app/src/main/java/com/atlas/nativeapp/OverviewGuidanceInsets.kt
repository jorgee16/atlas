package com.atlas.nativeapp

/**
 * Stable top map padding in Overview. GPS guidance text and lane arrows can
 * change height every second, but the detached map must not move with them.
 *
 * Navigating: reserve an ample, density-scaled banner envelope independent
 * of the live text. A device rotation still computes a new insets value.
 * Non-navigation: there is no live GPS banner; respect the actual overlay.
 */
internal object OverviewGuidanceInsets {
    fun top(insetPx:Int,navigating:Boolean,guidanceBottomPx:Int?,pixelsPerDp:Int):Int {
        val dp=pixelsPerDp.coerceAtLeast(1)
        if(navigating) return insetPx + 360*dp
        val occupied=if(guidanceBottomPx!=null)guidanceBottomPx+20*dp else 0
        return maxOf(insetPx + 40*dp,occupied)
    }
}
