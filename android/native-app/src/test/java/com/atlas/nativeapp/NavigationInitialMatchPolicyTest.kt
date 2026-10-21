package com.atlas.nativeapp

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationInitialMatchPolicyTest {
    private val point = Coordinate(39.4, -9.2)
    private fun fix(accuracy: Double, speed: Double = 0.0, providerSpeed: Double = speed) =
        Fix(point, accuracy, speed, null, 100.0, providerSpeed = providerSpeed)

    @Test fun indoorStationaryFixDoesNotBecomeAFakeRoadPosition() {
        assertFalse(NavigationInitialMatchPolicy.canAdopt(fix(120.0), 25.0, false))
        assertFalse(NavigationInitialMatchPolicy.canAdopt(fix(120.0), 25.0, true))
        assertFalse(NavigationInitialMatchPolicy.canAdopt(fix(5.0), 45.0, false))
    }

    @Test fun nearbyHighConfidenceRoadProjectionCanInitializeOnce() {
        assertTrue(NavigationInitialMatchPolicy.canAdopt(fix(5.0), 6.0, false))
        assertTrue(NavigationInitialMatchPolicy.canAdopt(fix(15.0), 18.0, true))
    }

    @Test fun movementRequiresPlausibleRoadMatch() {
        assertTrue(NavigationInitialMatchPolicy.canAdopt(fix(60.0, 4.0), 30.0, false))
        assertFalse(NavigationInitialMatchPolicy.canAdopt(fix(60.0, 4.0), 100.0, false))
        assertFalse(NavigationInitialMatchPolicy.canAdopt(
            fix(90.0, 3.0, providerSpeed = 0.0), 20.0, false))
    }

    @Test fun invalidProjectionIsNeverAccepted() {
        assertFalse(NavigationInitialMatchPolicy.canAdopt(fix(5.0), Double.NaN, false))
        assertFalse(NavigationInitialMatchPolicy.canAdopt(fix(5.0), -1.0, false))
    }
}
