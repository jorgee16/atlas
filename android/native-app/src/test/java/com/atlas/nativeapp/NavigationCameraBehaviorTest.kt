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
}
