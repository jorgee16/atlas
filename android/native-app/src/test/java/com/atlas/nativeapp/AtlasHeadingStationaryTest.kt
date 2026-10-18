package com.atlas.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Test

class AtlasHeadingStationaryTest {
    @Test fun compassRotationCannotOverrideTravelBearingWhileNavigationIsStopped() {
        assertEquals(12.0,AtlasHeading.choose(true,0.0,92.0,180.0,250.0,12.0),0.01)
    }
    @Test fun routeBearingBeatsCompassWhenStartingAtRest() {
        assertEquals(92.0,AtlasHeading.choose(true,0.0,92.0,null,250.0,null),0.01)
    }
    @Test fun gpsCourseBeatsCompassInExploreWhileDriving() {
        // Heading: north-east. Phone physically faces south-west.
        assertEquals(42.0, AtlasHeading.choose(false, 15.0,
            null, 42.0, 226.0, 30.0), 0.01)
        assertEquals(42.0, AtlasHeading.choose(false, 15.0,
            null, 42.0, 90.0, 30.0), 0.01)
    }
    @Test fun lastConfirmedCourseIsKeptWhenGpsBearingTemporarilyDrops() {
        assertEquals(38.0, AtlasHeading.choose(false, 10.0,
            null, null, 210.0, 38.0), 0.01)
        org.junit.Assert.assertTrue(AtlasHeading.hasTravelHeading(10.0, null, 38.0))
        org.junit.Assert.assertFalse(AtlasHeading.hasTravelHeading(0.5, 72.0, 38.0))
    }
    @Test fun walkingSlowlyStillUsesDeviceCompass() {
        assertEquals(240.0, AtlasHeading.choose(false, 0.7,
            null, 70.0, 240.0, 65.0), 0.01)
    }
    @Test fun northUpCursorStillRepresentsTravelBearing() {
        val heading = AtlasHeading.choose(false, 12.0, null, 110.0, 250.0, null)
        assertEquals(110.0, AtlasHeading.normalize(heading - 0.0), 0.01)
        assertEquals(0.0, AtlasHeading.normalize(heading - 110.0), 0.01)
    }
    @Test fun outsideNavigationCompassCanStillRotateMap() {
        assertEquals(250.0,AtlasHeading.choose(false,0.0,null,null,250.0,null),0.01)
    }
}
