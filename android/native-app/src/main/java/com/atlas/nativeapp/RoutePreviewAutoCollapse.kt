package com.atlas.nativeapp

/** A preview auto-collapses after the initial read window AND sufficient idle time. */
internal object RoutePreviewAutoCollapse {
    fun shouldCollapse(nowMillis: Long, previewShownMillis: Long,
                       lastTouchMillis: Long): Boolean =
        nowMillis >= previewShownMillis &&
            nowMillis - previewShownMillis >= 10_000L &&
            nowMillis >= lastTouchMillis &&
            nowMillis - lastTouchMillis >= 7_000L
}
