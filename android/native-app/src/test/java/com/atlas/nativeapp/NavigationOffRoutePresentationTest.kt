package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationOffRoutePresentationTest {
    private fun fix(t: Double, moving: Boolean = false) =
        Fix(Coordinate(40.0,-8.0),5.0,if(moving)5.0 else 0.0,null,t,
            motionConfirmed=moving)

    @Test fun physicalDeparturePreservesLiveCursorFrameContinuity() {
        val visible=Coordinate(40.0,-8.0)
        val moving=fix(451.0,true).copy(
            point=Coordinate(40.0,-8.0001),accuracy=5.0)
        assertTrue(NavigationOffRoutePresentation.animateHandoff(moving,visible,false))
        assertFalse(NavigationOffRoutePresentation.animateHandoff(moving,null,false))
        assertFalse(NavigationOffRoutePresentation.animateHandoff(fix(452.0),visible,false))
        assertFalse(NavigationOffRoutePresentation.animateHandoff(
            moving.copy(accuracy=100.0),visible,false))
        val interpolator=NavigationPositionInterpolator()
        interpolator.accept(moving.point,moving.time,moving.accuracy,451.1,visible)
        val first=interpolator.sample(451.1)!!.first
        assertEquals(visible.lat,first.lat,1e-9)
        assertEquals(visible.lon,first.lon,1e-9)
        val next=interpolator.sample(451.2)!!.first
        assertTrue(kotlin.math.abs(next.lon-visible.lon)<0.00006)
    }

    @Test fun parkedRealDepartureStaysOffRoadThroughReroute() {
        val policy=NavigationOffRoutePresentation()
        assertFalse(policy.observe(true,fix(1.0),true,false,0.0,"normal"))
        assertTrue(policy.observe(true,fix(2.0),true,true,39.0,"checking"))
        assertTrue(policy.active)
        assertFalse(policy.observe(true,fix(2.0),true,false,0.0,"normal"))
        assertFalse(policy.observe(true,fix(3.0),false,false,0.0,""))
        assertFalse(policy.observe(true,fix(4.0),true,false,39.0,"normal"))
        assertTrue(policy.active)
        // Merely projecting to a nearby road while parked cannot release it.
        assertFalse(policy.observe(true,fix(5.0),true,false,7.0,"normal"))
        assertTrue(policy.active)
    }

    @Test fun needsThreeNewPhysicalOnRouteFixesToReturnToRoadCursor() {
        val policy=NavigationOffRoutePresentation()
        policy.observe(true,fix(1.0),true,true,41.0,"checking")
        assertFalse(policy.observe(true,fix(2.0,true),true,false,7.0,"normal"))
        assertFalse(policy.observe(true,fix(2.0,true),true,false,7.0,"normal"))
        assertFalse(policy.observe(true,fix(3.0,true),true,false,7.0,"normal"))
        assertTrue(policy.active)
        assertFalse(policy.observe(true,fix(4.0,true),true,false,7.0,"normal"))
        assertFalse(policy.active)
    }

    @Test fun stationaryOutliersNeverEnterOffRoadPresentation() {
        val policy=NavigationOffRoutePresentation()
        for(i in 1..20)
            assertFalse(policy.observe(true,fix(i.toDouble()),true,false,55.0,"checking"))
        assertFalse(policy.active)
        policy.observe(true,fix(21.0),true,true,38.0,"checking")
        assertTrue(policy.active)
        policy.observe(false,fix(22.0),false,false,38.0,"")
        assertFalse(policy.active)
    }
}
