package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationStartPolicyTest {
    private val from=Coordinate(38.7215,-9.147)

    @Test fun startNeverUsesOldOrInaccurateGps() {
        assertTrue(NavigationStartPolicy.freshFix(110.0,109.0,5.0))
        assertFalse(NavigationStartPolicy.freshFix(110.0,95.0,5.0))
        assertFalse(NavigationStartPolicy.freshFix(110.0,109.0,80.0))
        assertFalse(NavigationStartPolicy.freshFix(110.0,111.0,5.0))
    }

    @Test fun delayingStartUntilCarMovedReplansFromLatestFix() {
        val moved=Coordinate(from.lat+80.0/111_320.0,from.lon)
        assertTrue(NavigationStartPolicy.requiresNewOrigin(from,moved,5.0,false))
        assertTrue(NavigationStartPolicy.requiresNewOrigin(null,moved,5.0,false))
        val noise=Coordinate(from.lat+4.0/111_320.0,from.lon)
        assertFalse(NavigationStartPolicy.requiresNewOrigin(from,noise,5.0,false))
    }

    @Test fun walkingHasItsOwnReplanTolerance() {
        val moved=Coordinate(from.lat+20.0/111_320.0,from.lon)
        assertTrue(NavigationStartPolicy.requiresNewOrigin(from,moved,5.0,true))
        assertFalse(NavigationStartPolicy.requiresNewOrigin(from,moved,5.0,false))
    }
}
