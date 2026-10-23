package com.atlas.nativeapp

import org.maplibre.android.geometry.LatLng
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min

/**
 * Visual-only corner rounding. Routing, GPS matching, route length, maneuvers
 * and camera framing MUST keep using the unmodified original geometry.
 */
internal object RouteVisualSmoothing {
    fun smooth(route: List<LatLng>): List<LatLng> {
        if(route.size < 3 || route.size > 10_000) return route
        val answer=ArrayList<LatLng>(min(route.size*3,30_000))
        answer.add(route.first())
        for(i in 1 until route.lastIndex) {
            val a=route[i-1];val b=route[i];val c=route[i+1]
            val latScale=111_320.0
            val lonScale=latScale*cos(Math.toRadians(b.latitude))
            if(lonScale < 1.0) { answer.add(b);continue }
            val dx1=(b.longitude-a.longitude)*lonScale
            val dy1=(b.latitude-a.latitude)*latScale
            val dx2=(c.longitude-b.longitude)*lonScale
            val dy2=(c.latitude-b.latitude)*latScale
            val len1=hypot(dx1,dy1);val len2=hypot(dx2,dy2)
            if(len1 < 2.0 || len2 < 2.0 || !len1.isFinite() || !len2.isFinite()) {
                answer.add(b);continue
            }
            val turn=Math.toDegrees(abs(atan2(dx1*dy2-dy1*dx2,dx1*dx2+dy1*dy2)))
            // Do not cut sharp junctions, U-turns, or nearly straight streets.
            if(turn < 9.0 || turn > 68.0) { answer.add(b);continue }
            val radius=min(2.4,min(len1,len2)*0.20)
            val ux=b.longitude-dx1/len1*radius/lonScale
            val uy=b.latitude-dy1/len1*radius/latScale
            val vx=b.longitude+dx2/len2*radius/lonScale
            val vy=b.latitude+dy2/len2*radius/latScale
            answer.add(LatLng(uy,ux))
            answer.add(LatLng(0.25*uy+0.5*b.latitude+0.25*vy,
                0.25*ux+0.5*b.longitude+0.25*vx))
            answer.add(LatLng(vy,vx))
        }
        answer.add(route.last())
        return answer
    }
}
