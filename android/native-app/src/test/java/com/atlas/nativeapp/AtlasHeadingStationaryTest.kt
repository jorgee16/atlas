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
    @Test fun outsideNavigationCompassCanStillRotateMap() {
        assertEquals(250.0,AtlasHeading.choose(false,0.0,null,null,250.0,null),0.01)
    }
}
