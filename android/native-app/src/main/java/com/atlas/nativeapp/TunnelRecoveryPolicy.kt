package com.atlas.nativeapp

import org.json.JSONObject
import kotlin.math.cos
import kotlin.math.hypot

/**
 * A GNSS blackout is not definitive evidence of a mapped tunnel.
 * Real-world recovery is accepted ONLY after two accurate consecutive fixes,
 * corroborated by a native route projection; predictions never qualify.
 */
internal object TunnelRecoveryPolicy {
    fun isBlackoutReturn(previous: Fix?, current: Fix): Boolean {
        if(previous==null || !current.time.isFinite() || !previous.time.isFinite())return false
        return current.time-previous.time >= 4.0 &&
            current.accuracy in 0.0..20.0 && previous.accuracy in 0.0..20.0 &&
            previous.motionConfirmed==true &&
            StationaryMapPosition.visualSpeed(previous)>=3.0
    }
    fun confirmedConsecutiveFixes(previous: Fix?, current: Fix,
                                  guidance: JSONObject?): Boolean {
        if(previous==null || guidance==null)return false
        val seconds=current.time-previous.time
        if(seconds !in 0.5..3.0 ||
            current.accuracy !in 0.0..15.0 ||
            previous.accuracy !in 0.0..15.0 ||
            current.motionConfirmed==false ||
            previous.motionConfirmed==false ||
            StationaryMapPosition.visualSpeed(current)<2.0 ||
            guidance.has("predictedAt") ||
            !NavigationResumePolicy.currentGuidance(
                current.time,guidance.optDouble("gpsFixTime",Double.NaN)) ||
            guidance.optString("state") in listOf("checking","reroute","changed","arrived") ||
            guidance.optDouble("offRoute",Double.POSITIVE_INFINITY)>20.0)return false
        val lat=Math.toRadians((current.point.lat+previous.point.lat)*0.5)
        val meters=hypot(
            (current.point.lat-previous.point.lat)*111320.0,
            (current.point.lon-previous.point.lon)*111320.0*cos(lat))
        return meters>=2.0 && meters <= (maxOf(12.0,current.speed*3.5)*seconds+12.0)
    }
}
