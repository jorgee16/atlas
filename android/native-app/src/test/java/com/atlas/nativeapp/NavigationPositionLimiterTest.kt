package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationPositionLimiterTest {
    private val origin=Coordinate(38.7215,-9.147)
    private val road=Coordinate(origin.lat+38.0/111320.0,origin.lon)
    @Test fun firstMatchingCannotTeleportThirtyEightMeters() {
        val limiter=NavigationPositionLimiter()
        limiter.commit(origin,100.0,0.0)
        val first=limiter.commit(road,100.04,0.0)
        assertTrue((first.lat-origin.lat)*111320.0<=.161)
        assertTrue(limiter.active)
        repeat(320){limiter.commit(road,100.04+(it+1)/30.0,0.0)}
        assertEquals(road,limiter.commit(road,111.0,0.0))
        assertFalse(limiter.active)
    }
    @Test fun stateAndRenderUpdatesShareOneElapsedTimeBudget() {
        val limiter=NavigationPositionLimiter()
        limiter.commit(origin,100.0,8.0)
        limiter.commit(road,100.03,8.0)
        limiter.commit(road,100.04,8.0)
        val frame=limiter.commit(road,100.07,8.0)
        assertTrue((frame.lat-origin.lat)*111320.0<=16.6*.07+.001)
        assertEquals(frame,limiter.commit(road,100.07,8.0))
    }
    @Test fun ordinaryMovementIsNotInterpolatedAgain() {
        val limiter=NavigationPositionLimiter()
        limiter.commit(origin,100.0,8.0)
        val next=Coordinate(origin.lat+.2/111320.0,origin.lon)
        assertEquals(next,limiter.commit(next,100.04,8.0))
        assertFalse(limiter.active)
    }
}
