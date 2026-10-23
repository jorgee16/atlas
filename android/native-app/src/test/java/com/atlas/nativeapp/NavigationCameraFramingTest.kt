package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationCameraFramingTest {
    private fun drive(meters: Double, kmh: Double = 60.0) =
        NavigationCameraFraming.target(false, kmh / 3.6, meters)

    @Test fun distantExitShowsMoreRoadAndStrongerPerspective() {
        val long = drive(12_000.0)
        val approach = drive(1_000.0)
        val junction = drive(45.0)
        assertTrue(long.zoom < approach.zoom)
        assertTrue(approach.zoom < junction.zoom)
        assertTrue(long.tilt > approach.tilt)
        assertTrue(approach.tilt > junction.tilt)
        assertTrue("driving pitch should be noticeably stronger than old 42 degrees",
            junction.tilt >= 49.0 && long.tilt <= 60.0)
    }

    @Test fun forkAndRoundaboutApproachDoNotJumpBetweenZoomSteps() {
        val before = drive(401.0)
        val after = drive(399.0)
        assertTrue(kotlin.math.abs(before.zoom - after.zoom) < 0.02)
        assertTrue(kotlin.math.abs(before.tilt - after.tilt) < 0.05)
        val near = drive(20.0)
        assertTrue(near.zoom >= 18.5)
        assertTrue(near.tilt in 49.0..50.0)
    }

    @Test fun departureAtZeroUsesRealNextManeuver() {
        val cue = NavigationCameraFraming.upcomingDistance("depart", 0.0, 22_000.0)
        assertEquals(22_000.0, cue!!, 0.0)
        assertTrue(drive(cue).zoom < drive(0.0).zoom)
        assertEquals(200.0, NavigationCameraFraming.upcomingDistance(
            "turn-right", 200.0, 22_000.0)!!, 0.0)
        assertNull(NavigationCameraFraming.upcomingDistance("depart", 0.0, null))
    }

    @Test fun motorwaySpeedCanWidenLongRoadButKeepsExitReadable() {
        assertTrue(drive(3_500.0, 110.0).zoom < drive(3_500.0, 30.0).zoom)
        assertTrue(drive(35.0, 110.0).zoom > 18.4)
        assertTrue(drive(4_000.0, 150.0).zoom >= 16.0)
    }

    @Test fun missingStaleOrCorruptCueNeverCausesJunctionZoom() {
        val fallback = NavigationCameraFraming.target(false, 0.0, null)
        assertEquals(17.4, fallback.zoom, 0.0)
        assertEquals(57.0, fallback.tilt, 0.0)
        assertEquals(fallback, NavigationCameraFraming.target(false, 3.0, Double.NaN))
        assertEquals(fallback, NavigationCameraFraming.target(false, -1.0, -50.0))
        assertNull(NavigationCameraFraming.upcomingDistance("turn-left", Double.NaN, null))
    }

    @Test fun pedestrianCameraKeepsOwnFramingAndIsUnaffectedByDrivePolicy() {
        assertEquals(NavigationCameraFraming.Target(18.0, 0.0),
            NavigationCameraFraming.target(true, 1.5, 25_000.0))
    }
    @Test fun nearRoundaboutShowsMoreRoadWithoutAbruptHighwayZoom() {
        val base=NavigationCameraFraming.Target(18.0,53.0)
        val approach=NavigationCameraFraming.roundaboutTarget(base,20.0,7.0)
        assertTrue(approach.zoom>base.zoom)
        assertTrue(approach.zoom<=19.1)
        assertTrue(approach.tilt<base.tilt)
        assertEquals(base,NavigationCameraFraming.roundaboutTarget(base,500.0,7.0))
    }
}
