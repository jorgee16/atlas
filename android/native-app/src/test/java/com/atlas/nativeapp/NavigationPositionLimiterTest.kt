package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationPositionLimiterTest {
    private val origin=Coordinate(38.7215,-9.147)
    private val road=Coordinate(origin.lat+38.0/111320.0,origin.lon)
    @Test fun stationaryMapMatchingDoesNotAnimateAcrossThirtyEightMeters() {
        val limiter=NavigationPositionLimiter()
        limiter.commit(origin,100.0,0.0)
        // A 38 m map-matching offset must not be replayed as a drive at 4 m/s.
        repeat(330) {
            assertEquals(origin,limiter.commit(road,100.04+(it+1)/30.0,0.0))
            assertFalse(limiter.active)
        }
        // Confirmed movement permits normal bounded recovery.
        val moving=limiter.commit(road,112.0,8.0)
        assertTrue(moving.lat > origin.lat)
        assertTrue(moving.lat < road.lat)
        assertTrue(limiter.active)
    }
    @Test fun firstVerifiedRouteProjectionRebasesWithoutFakeTravel() {
        val limiter=NavigationPositionLimiter()
        // Preview GPS was outside the routing graph's snapped first point.
        limiter.commit(origin,100.0,0.0)
        // A fresh, paired JNI projection starts a new visual reference.
        limiter.reset()
        assertEquals(road,limiter.commit(road,100.1,0.0))
        val noisyRoad=Coordinate(road.lat+25.0/111320.0,road.lon)
        repeat(90) {
            assertEquals(road,limiter.commit(noisyRoad,100.2+(it+1)/30.0,0.0))
            assertFalse(limiter.active)
        }
    }
    @Test fun suddenMapMatchingSwitchKeepsCursorStepBounded() {
        // The full Portugal replay recorded >100m instantaneous jumps from
        // the normal projection update. These are NOT background resumes.
        val limiter=NavigationPositionLimiter()
        limiter.commit(origin,100.0,8.0)
        val jump=Coordinate(origin.lat+121.5/111320.0,origin.lon)
        val following=limiter.commit(jump,100.065,8.0)
        val metres=(following.lat-origin.lat)*111320.0
        assertTrue("ordinary guidance cannot jump 121m in a frame",metres<6.0)
        assertTrue("normal guidance must remain interpolated",limiter.active)
        val next=limiter.commit(jump,100.10,8.0)
        assertTrue((next.lat-following.lat)*111320.0<6.0)
        // Only explicit resume/start epochs call reset. A normal matched-fix
        // change must not reset this limiter.
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
    @Test fun stationaryGnssReacquisitionDoesNotTeleportButExplicitResumeSynchronizes() {
        val limiter=NavigationPositionLimiter()
        val reacquired=Coordinate(origin.lat+76.8/111320.0,origin.lon)
        assertEquals(origin,limiter.commit(origin,100.0,0.0))
        // Foreground GNSS accuracy may recover from 100 to 5 metres and
        // project 76.8 m forward even though the car has not moved.
        repeat(90) {
            assertEquals(origin,limiter.commit(reacquired,100.03+(it+1)/30.0,0.0))
            assertFalse(limiter.active)
        }
        // Returning from the background is a separate explicit visual epoch:
        // a fresh trustworthy fix MUST be applied immediately, not slowly
        // animated over kilometres of old recorded route.
        limiter.reset()
        assertEquals(reacquired,limiter.commit(reacquired,106.0,0.0))
    }

    @Test fun ordinaryMovementIsNotInterpolatedAgain() {
        val limiter=NavigationPositionLimiter()
        limiter.commit(origin,100.0,8.0)
        val next=Coordinate(origin.lat+.2/111320.0,origin.lon)
        assertEquals(next,limiter.commit(next,100.04,8.0))
        assertFalse(limiter.active)
    }
}
