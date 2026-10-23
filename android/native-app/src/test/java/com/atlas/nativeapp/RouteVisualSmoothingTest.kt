package com.atlas.nativeapp

import org.maplibre.android.geometry.LatLng
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.hypot

class RouteVisualSmoothingTest {
    private fun p(x:Double,y:Double) = LatLng(38.7+y/111_320.0,-9.1+x/(111_320.0*0.78))
    private fun arc(radius:Double, start:Double=0.0, end:Double=90.0, step:Double=15.0):List<LatLng> =
        (0..((end-start)/step).toInt()).map {
            val a=Math.toRadians(start+it*step)
            p(radius*kotlin.math.cos(a),radius*kotlin.math.sin(a))
        }

    @Test fun continuousBendsStayInsideTheMeasuredRoadCorridor() {
        val examples=listOf(arc(80.0),arc(12.0,0.0,210.0,70.0),
            arc(45.0)+arc(45.0).reversed().map { p(100.0+(it.longitude+9.1)*111320*.78,40.0+(it.latitude-38.7)*111320) })
        for(raw in examples) {
            val before=raw.map { it.latitude to it.longitude }
            val drawn=RouteVisualSmoothing.prepare(raw).points
            assertEquals(before,raw.map { it.latitude to it.longitude })
            val samples=drawn.zipWithNext().flatMap { (a,b) -> (0..10).map { n ->
                val t=n/10.0;LatLng(a.latitude+(b.latitude-a.latitude)*t,a.longitude+(b.longitude-a.longitude)*t)
            } }
            for(point in samples) assertTrue("Curve escaped the original road corridor",
                raw.zipWithNext().minOf { (a,b)->RouteVisualSmoothing.segmentDistance(point,a,b) }<=.911)
            assertEquals(raw.first(),drawn.first());assertEquals(raw.last(),drawn.last())
        }
    }

    @Test fun maneuverAndRoundaboutExitAnchorsRemainExact() {
        val raw=arc(25.0,0.0,120.0,30.0)
        val visual=RouteVisualSmoothing.prepare(raw,setOf(1,3)).points
        assertTrue(visual.contains(raw[1]));assertTrue(visual.contains(raw[3]))
    }

    @Test fun walkingUsesANarrowerCorridor() {
        val raw=arc(45.0)
        val drawn=RouteVisualSmoothing.prepare(raw,walking=true).points
        for(point in drawn) assertTrue(raw.zipWithNext().minOf { (a,b)->
            RouteVisualSmoothing.segmentDistance(point,a,b) }<=.361)
    }

    @Test fun progressIsMonotonicAcrossCurvesAndDoesNotRebuildGeometry() {
        val raw=arc(60.0)
        val prepared=RouteVisualSmoothing.prepare(raw)
        val identity=prepared.points
        var previous=0.0
        for(i in 0 until raw.lastIndex)for(tick in 0..20) {
            val t=tick/20.0
            val position=LatLng(raw[i].latitude+(raw[i+1].latitude-raw[i].latitude)*t,
                raw[i].longitude+(raw[i+1].longitude-raw[i].longitude)*t)
            val fraction=prepared.fraction(i,position)
            assertTrue(fraction+1e-10>=previous);assertTrue(fraction in 0.0..1.0)
            previous=fraction;assertSame(identity,prepared.points)
        }
        assertEquals(1.0,previous,1e-10)
    }

    @Test fun longRoutesAreNotGloballyExcludedFromRounding() {
        val raw=(0..10001).map { val a=Math.toRadians(it*2.0);p(100*kotlin.math.cos(a),100*kotlin.math.sin(a)) }
        assertTrue(RouteVisualSmoothing.prepare(raw).points.size>raw.size)
    }
    @Test fun roundOnlyModerateBendsAndPreserveOriginalPoints() {
        val original=listOf(p(0.0,0.0),p(15.0,0.0),p(26.0,10.0),p(45.0,14.0))
        val before=original.toList()
        val drawn=RouteVisualSmoothing.smooth(original)
        assertTrue(drawn.size>original.size)
        assertEquals(original.first(),drawn.first())
        assertEquals(original.last(),drawn.last())
        assertEquals(before,original)
        val anchor=original[1]
        assertTrue(drawn.any { hypot((it.latitude-anchor.latitude)*111320.0,
            (it.longitude-anchor.longitude)*111320.0*.78) < 3.0 })
    }
    @Test fun doNotCutJunctionsOrDoubleBacksOrStraightRoads() {
        val sharp=listOf(p(0.0,0.0),p(10.0,0.0),p(10.0,10.0))
        assertEquals(sharp,RouteVisualSmoothing.smooth(sharp))
        val uturn=listOf(p(0.0,0.0),p(10.0,0.0),p(0.0,0.0))
        assertEquals(uturn,RouteVisualSmoothing.smooth(uturn))
        val straight=listOf(p(0.0,0.0),p(10.0,0.0),p(20.0,0.0))
        assertEquals(straight,RouteVisualSmoothing.smooth(straight))
    }
    @Test fun duplicateAndShortSegmentsAreUnmodified() {
        val route=listOf(p(0.0,0.0),p(0.0,0.0),p(1.0,0.0),p(2.0,1.0))
        assertEquals(route,RouteVisualSmoothing.smooth(route))
    }
}
