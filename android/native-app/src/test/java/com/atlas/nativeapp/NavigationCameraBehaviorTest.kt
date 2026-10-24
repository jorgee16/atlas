package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationCameraBehaviorTest {
    @Test fun wazeStyleCursorPointsForwardWhileMapRotates() {
        for (mapBearing in listOf(0.0, 58.0, 175.0, 265.0, 359.0)) {
            assertEquals(0.0, NavigationCameraBehavior.cursorAngle(
                true,true,true,122.0,mapBearing),0.0001)
        }
    }
    @Test fun northUpAndManualPanStillShowTrueMovementDirection() {
        assertEquals(120.0,NavigationCameraBehavior.cursorAngle(
            true,true,false,120.0,0.0),0.0001)
        assertEquals(350.0,NavigationCameraBehavior.cursorAngle(
            true,false,true,20.0,30.0),0.0001)
        assertEquals(30.0,NavigationCameraBehavior.cursorAngle(
            false,true,true,70.0,40.0),0.0001)
    }
    @Test fun compassToggleSettlesInSixHundredMillisecondsWithoutSnapping() {
        val rate=NavigationCameraBehavior.rotationRate(0.0)
        assertEquals(14.0,rate,0.001)
        val initialDifference=180.0
        val residual=initialDifference*kotlin.math.exp(-rate*0.6)
        assertTrue("north-up compass should settle below 1 degree in 600 ms",
            residual < 1.0)
        assertEquals(2.8,NavigationCameraBehavior.rotationRate(1.0),0.001)
        assertEquals(2.8,NavigationCameraBehavior.rotationRate(Double.POSITIVE_INFINITY),0.001)
    }
    @Test fun bendsSettleSoonWithoutSnappingOrRotatingWhenParked() {
        val rate = NavigationCameraBehavior.rotationRate(
            Double.NEGATIVE_INFINITY,65.0,12.0)
        assertEquals(8.0,rate,0.001)
        val frame=65.0*(1.0-kotlin.math.exp(-rate/30.0))
        assertTrue("single frame must not snap",frame<20.0)
        assertTrue("bend must settle quickly",65.0*kotlin.math.exp(-rate*0.45)<3.0)
        assertEquals(5.5,NavigationCameraBehavior.rotationRate(
            Double.NEGATIVE_INFINITY,18.0,8.0),0.001)
        assertEquals(2.8,NavigationCameraBehavior.rotationRate(
            Double.NEGATIVE_INFINITY,80.0,0.0),0.001)
        assertEquals(2.8,NavigationCameraBehavior.rotationRate(
            Double.NEGATIVE_INFINITY,4.0,14.0),0.001)
    }
    @Test fun animationKeepsRunningUntilRotationAndZoomSettle() {
        assertTrue(NavigationCameraBehavior.shouldContinueFrame(
            true,false,0.0,16.0,0.0,0.0))
        assertTrue(NavigationCameraBehavior.shouldContinueFrame(
            true,false,0.0,0.0,0.4,0.0))
        assertFalse(NavigationCameraBehavior.shouldContinueFrame(
            true,false,0.0,0.1,0.005,0.05))
    }
    @Test fun checkingKeepsShortVisualContinuityWithoutIndefinitePrediction() {
        assertTrue(NavigationCameraBehavior.useHeldRouteFix(true,false,0.8))
        assertFalse(NavigationCameraBehavior.useHeldRouteFix(true,false,3.0))
        assertFalse(NavigationCameraBehavior.useHeldRouteFix(true,true,0.5))
    }
    @Test fun roundaboutVisualRotationDoesNotAlterNormalGPSRates() {
        assertEquals(12.0,NavigationCameraBehavior.rotationRate(
            10.0,70.0,7.0,true),0.001)
        assertEquals(8.0,NavigationCameraBehavior.rotationRate(
            10.0,70.0,7.0,false),0.001)
        assertEquals(2.8,NavigationCameraBehavior.rotationRate(
            10.0,70.0,0.5,true),0.001)
    }
    private fun tangent(gps: Double = 0.0, visual: Double? = 35.0,
                        speed: Double = 12.0, accuracy: Double = 5.0,
                        age: Double = 0.5, confirmed: Boolean? = true,
                        fresh: Boolean = true, state: String = "normal",
                        offRoute: Double = 2.0, rerouting: Boolean = false,
                        raw: Double? = gps, rawAccuracy: Double? = 5.0) =
        NavigationCameraBehavior.trustedRouteBearing(
            visual,gps,raw,rawAccuracy,speed,accuracy,age,confirmed,
            fresh,state,offRoute,rerouting)

    @Test fun confirmedCurveUsesVisualRoadTangentNotOldGpsDirection() {
        assertEquals(35.0,tangent()!!,0.001)
        assertEquals(355.0,tangent(gps=10.0,visual=355.0)!!,0.001)
    }

    @Test fun doNotSteerCameraByMapMatchWhenStoppedOrGpsIsUntrusted() {
        assertNull(tangent(speed=0.0,confirmed=false))
        assertNull(tangent(speed=0.5))
        assertNull(tangent(confirmed=false))
        assertNull(tangent(confirmed=null))
        assertNull(tangent(accuracy=65.0))
        assertNull(tangent(age=4.0))
        assertNull(tangent(fresh=false))
        assertNull(tangent(state="checking"))
        assertNull(tangent(state="reroute"))
        assertNull(tangent(state="reduced"))
        assertNull(tangent(offRoute=40.0))
        assertNull(tangent(rerouting=true))
        assertNull(tangent(visual=null))
    }

    @Test fun contradictedReverseRoadDoesNotRotateCameraAwayFromMovingCar() {
        assertNull(tangent(gps=5.0,visual=185.0))
        assertNull(tangent(gps=0.0,visual=108.0,raw=0.0,rawAccuracy=5.0))
        assertEquals(75.0,tangent(gps=0.0,visual=75.0,raw=0.0)!!,0.001)
        assertEquals(108.0,tangent(gps=15.0,visual=108.0,
            raw=0.0,rawAccuracy=30.0)!!,0.001)
    }

}
