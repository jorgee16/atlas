package com.atlas.nativeapp

import kotlin.math.ln
import kotlin.math.max

/** Zoom slack for GPS/cursor corrections while Overview stays detached.
 * Keep the actual MapLibre camera padding equal to the UI occlusion insets;
 * enlarging that padding in the fitted camera would shift its visual center.
 */
internal object OverviewCameraFit {
    fun zoomOut(width: Int, height: Int, insets: IntArray, density: Float): Double {
        if (width <= 0 || height <= 0 || insets.size != 4 ||
            !density.isFinite() || density <= 0f) return 0.0
        val spaceX = (width - insets[0] - insets[2]).coerceAtLeast(1).toDouble()
        val spaceY = (height - insets[1] - insets[3]).coerceAtLeast(1).toDouble()
        val margin = 18.0 * density
        val freeX = (spaceX - 2.0 * margin).coerceAtLeast(spaceX * 0.6)
        val freeY = (spaceY - 2.0 * margin).coerceAtLeast(spaceY * 0.6)
        return (ln(max(spaceX / freeX, spaceY / freeY)) / ln(2.0)).coerceIn(0.0, 0.75)
    }
}
