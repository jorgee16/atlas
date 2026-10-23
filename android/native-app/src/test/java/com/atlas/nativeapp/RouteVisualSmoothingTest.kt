package com.atlas.nativeapp

import org.maplibre.android.geometry.LatLng
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.hypot

class RouteVisualSmoothingTest {
    private fun p(x:Double,y:Double) = LatLng(38.7+y/111_320.0,-9.1+x/(111_320.0*0.78))
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
