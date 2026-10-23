package com.atlas.nativeapp

/**
 * GNSS accuracy is not the same thing as route matching confidence.
 * Keep them separate when the driver misses a turn with a precise receiver.
 */
internal object GuidanceConfidencePresentation {
    fun text(state: String?, accuracyMeters: Double?,
             confirmedOffRoute: Boolean): String? = when (state) {
        "reduced" -> if (accuracyMeters != null && accuracyMeters.isFinite() &&
            accuracyMeters > 50.0)
            "GPS accuracy reduced · Holding last reliable position"
        else "Checking route position · Keeping last reliable position"
        "checking" -> if (confirmedOffRoute)
            "Off route · Finding another way…"
        else "Checking possible route deviation…"
        "reroute" -> "Off route · Recalculating route…"
        else -> null
    }
}
