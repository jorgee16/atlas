package com.atlas.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AtlasHeadingTest {
    @Test fun headingWrapAvoidsFullRevolution() {
        assertEquals(2.0, AtlasHeading.angleDifference(359.0, 1.0), 0.001)
        assertEquals(2.0, AtlasHeading.signedDelta(359.0, 1.0), 0.001)
        assertEquals(358.0, AtlasHeading.normalize(-2.0), 0.001)
    }

    @Test fun motionBasedGuidanceKeepsLastStableCourseWhenStopped() {
        assertEquals(92.0, AtlasHeading.choose(true, 8.0, 92.0, 95.0, 12.0, 89.0), 0.001)
        assertEquals(89.0, AtlasHeading.choose(true, 0.0, 92.0, 95.0, 12.0, 89.0), 0.001)
    }

    @Test fun explorationFollowsPhoneCompassAndIgnoresGpsNoise() {
        assertEquals(35.0, AtlasHeading.choose(false, 0.0, null, 190.0, 35.0, 94.0), 0.001)
        assertEquals(0.0, AtlasHeading.choose(false, 0.0, null, null, null, null), 0.001)
    }

    @Test fun ignoresInvalidCourse() {
        assertEquals(45.0, AtlasHeading.choose(true, 6.0, Double.NaN, -1.0, 45.0, null), 0.001)
    }
}
