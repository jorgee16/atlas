package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationCursorPresentationTest {
    private val road=Coordinate(40.0,-8.0)
    private val projected=Coordinate(40.0+76.8/111320.0,-8.0)
    private fun fix(confirmed:Boolean?) = Fix(projected,5.0,0.0,null,100.0,
        providerSpeed=0.0,motionConfirmed=confirmed)

    @Test fun ordinaryMapMatchRecoveryCannotTeleportStationaryCursor() {
        // The 1Hz render update and subsequent Choreographer frames must
        // agree: no physical movement, no change in the visible coordinate.
        for (i in 0 until 45) {
            assertEquals(road,
                NavigationCursorPresentation.choose(road,projected,fix(false),false))
        }
    }
    @Test fun physicalMovementUnlocksNormalTravel() {
        assertEquals(projected,
            NavigationCursorPresentation.choose(road,projected,fix(true),false))
    }
    @Test fun foregroundOrStartupEpochRebasesImmediately() {
        assertEquals(projected,
            NavigationCursorPresentation.choose(road,projected,fix(false),true))
        assertEquals(projected,
            NavigationCursorPresentation.choose(null,projected,fix(false),false))
    }
}
