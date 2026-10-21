package com.atlas.nativeapp

import java.util.Locale

/** Presentation-only GNSS telemetry. No predicted or interpolated points
 * are ever counted as GPS fixes. Time and frequency use elapsed realtime.
 */
internal object NavigationDiagnostics {
    data class Snapshot(val headline: String, val short: String, val details: String)
    private fun number(value: Double?, digits: Int = 1): String =
        if (value == null || !value.isFinite() || value < 0.0) "—"
        else String.format(Locale.US,"%.${digits}f",value)
    private fun degrees(value: Double?): String =
        if (value == null || !value.isFinite()) "—"
        else String.format(Locale.US,"%.0f°", ((value % 360.0) + 360.0) % 360.0)

    fun snapshot(state: AtlasState, nowSeconds: Double): Snapshot {
        val fix=state.fix ?: return Snapshot("GPS · waiting","No GPS fix yet",
            "Location permission and enabled GPS are required.")
        val age=if(nowSeconds.isFinite())(nowSeconds-fix.time).coerceAtLeast(0.0)
            else Double.POSITIVE_INFINITY
        val hz=state.gpsHz.takeIf { it.isFinite() && it > 0.0 }
        val hzLabel=if(age<=12.0)number(hz) else "—"
        val accuracy=number(fix.accuracy,0)
        val rawSpeed=number(fix.providerSpeed?.takeIf { it>=0.0 }?.times(3.6))
        val filteredSpeed=number(fix.speed.takeIf { it>=0.0 }?.times(3.6))
        val gpsHeading=degrees(fix.providerBearing)
        val filterHeading=degrees(fix.bearing)
        val routeHeading=degrees(state.guidance?.optDouble("bearing",Double.NaN))
        val bearingAccuracy=number(fix.bearingAccuracy,0)
        val g=state.guidance
        val isPredicted=g?.optDouble("predictedAt",Double.NaN)?.isFinite()==true
        val guidanceState=when {
            !state.navigating -> "not navigating"
            state.busy -> "recalculating"
            g==null -> "waiting for map-match"
            isPredicted -> "prediction (visual only)"
            else -> g.optString("state","unknown")
        }
        val offRoad=number(g?.optDouble("observedOffRoute",Double.NaN),0)
        val motion=when(fix.motionConfirmed) {
            true -> "confirmed moving"
            false -> "stationary / unconfirmed"
            null -> "unknown"
        }
        val ageLabel=if(age.isFinite())number(age)+" s" else "—"
        val short="Fix: $hzLabel Hz · ±$accuracy m (reported)\n"+
            "GPS heading: $gpsHeading · Filter: $filterHeading\n"+
            "Age: $ageLabel · Motion: $motion"
        val details="Source: ${fix.provider ?: "unknown"}\n"+
            "GPS fix rate: $hzLabel Hz (real observations)\n"+
            "Horizontal accuracy: ±$accuracy m (reported)\n"+
            "Fix age: $ageLabel\n"+
            "GPS heading: $gpsHeading · heading accuracy: ±$bearingAccuracy°\n"+
            "Filtered heading: $filterHeading · route bearing: $routeHeading\n"+
            "Speed: provider $rawSpeed km/h · filtered $filteredSpeed km/h\n"+
            "Movement filter: $motion\n"+
            "Off-route (raw GPS to route): $offRoad m\n"+
            "Guidance: $guidanceState\n"+
            "Raw GPS: ${String.format(Locale.US,"%.6f, %.6f",fix.point.lat,fix.point.lon)}"
        val status=if(age>8.0)"STALE GPS" else if(fix.accuracy>50.0)"WEAK GPS" else "GPS LIVE"
        return Snapshot(status,short,details)
    }
}
