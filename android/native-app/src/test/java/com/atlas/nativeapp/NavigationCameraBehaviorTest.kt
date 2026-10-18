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
