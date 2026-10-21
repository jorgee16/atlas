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

    @Test fun indoorWeakFixStaysRawUntilRealProviderMotion() {
        // Native filtered velocity can reflect GPS drift even while Android
        // reports zero movement. It must not move the displayed marker to a road.
        val stationary = fix(110.0, speed = 3.5, providerSpeed = 0.0)
        repeat(30) {
            assertFalse(NavigationInitialMatchPolicy.canAdopt(stationary, 30.0, false))
        }
        // Once the provider confirms actual movement and the road projection
        // is plausible, normal driving map matching may begin.
        assertTrue(NavigationInitialMatchPolicy.canAdopt(
            fix(110.0, speed = 3.5, providerSpeed = 2.4), 30.0, false))
        assertFalse(NavigationInitialMatchPolicy.canAdopt(
            fix(110.0, speed = 3.5, providerSpeed = 2.4), 80.0, false))
    }

    @Test fun anUnconfirmedMotionFlagCannotInitializeAnIndoorRoadSnap() {
        val unreliable = fix(80.0,4.0,providerSpeed=4.0).copy(motionConfirmed=false)
        assertFalse(NavigationInitialMatchPolicy.canAdopt(unreliable,20.0,false))
    }

    @Test fun invalidProjectionIsNeverAccepted() {
        assertFalse(NavigationInitialMatchPolicy.canAdopt(fix(5.0), Double.NaN, false))
        assertFalse(NavigationInitialMatchPolicy.canAdopt(fix(5.0), -1.0, false))
    }
}
