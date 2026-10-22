package com.atlas.nativeapp

/** Do not present a fictitious final driving leg through a POI polygon. */
internal object RoadsideArrivalNotice {
    fun text(gapMeters: Double): String? {
        if (!gapMeters.isFinite() || gapMeters <= 75.0) return null
        val distance=if(gapMeters<1000) "${(gapMeters/10).toInt()*10} m"
            else "${"%.1f".format(java.util.Locale.US,gapMeters/1000)} km"
        return "Route ends on a mapped road about $distance from the pin. Check the signed vehicle entrance."
    }
}
