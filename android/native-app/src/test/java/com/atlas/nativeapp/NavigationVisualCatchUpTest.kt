package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationVisualCatchUpTest {
    @Test fun currentCarFixCanSkipAccumulatedVisualDelay() {
        assertTrue(NavigationVisualCatchUp.shouldSnap(
            120.0, 0.35, 6.0, 5.0, 16.0, false))
        assertFalse(NavigationVisualCatchUp.shouldSnap(
            14.0, 0.35, 6.0, 5.0, 16.0, false))
    }
    @Test fun neverTeleportOnStaleOrUnreliableFix() {
        assertFalse(NavigationVisualCatchUp.shouldSnap(120.0, 11.0, 6.0, 5.0, 16.0, false))
        assertFalse(NavigationVisualCatchUp.shouldSnap(120.0, 0.2, 90.0, 5.0, 16.0, false))
        assertFalse(NavigationVisualCatchUp.shouldSnap(120.0, 0.2, 5.0, 40.0, 16.0, false))
        assertFalse(NavigationVisualCatchUp.shouldSnap(120.0, 0.2, 5.0, 5.0, 0.0, false))
    }
    @Test fun walkingUsesSeparateThresholdAndDoesNotCreepWhenStopped() {
        assertTrue(NavigationVisualCatchUp.shouldSnap(24.0, .2, 3.0, 4.0, 2.0, true))
        assertFalse(NavigationVisualCatchUp.shouldSnap(24.0, .2, 3.0, 4.0, .1, true))
        assertFalse(NavigationVisualCatchUp.shouldSnap(Double.NaN, .2, 3.0, 4.0, 2.0, true))
    }
}
