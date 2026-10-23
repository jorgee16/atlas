package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationFollowFramingTest {
    @Test fun rotationChangesOnlyViewportPaddingNotPosition() {
        val portrait=NavigationFollowFraming.padding(432,960,true,true,false)
        val landscape=NavigationFollowFraming.padding(960,432,true,true,true)
        assertArrayEquals(doubleArrayOf(0.0,288.0,0.0,0.0),portrait,0.001)
        assertArrayEquals(doubleArrayOf(172.8,0.0,0.0,103.68),landscape,0.001)
        // After bottom padding, center is higher than the landscape HUD.
        val centeredY=(432.0+landscape[1]-landscape[3])/2.0
        val centeredX=(960.0+landscape[0]-landscape[2])/2.0
        assertTrue(centeredY<432.0*.40)
        assertTrue(centeredX>960.0*.58)
    }
    @Test fun northUpAndNoGuidanceKeepIntentionalFraming() {
        assertArrayEquals(doubleArrayOf(0.0,0.0,0.0,0.0),
            NavigationFollowFraming.padding(432,960,true,false,false),0.0)
        assertArrayEquals(doubleArrayOf(0.0,0.0,0.0,0.0),
            NavigationFollowFraming.padding(960,432,false,true,true),0.0)
        assertArrayEquals(doubleArrayOf(172.8,0.0,0.0,103.68),
            NavigationFollowFraming.padding(960,432,true,false,true),0.001)
    }
}
