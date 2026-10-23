package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationFollowFramingTest {
    @Test fun rotationChangesOnlyViewportPaddingNotPosition() {
        val portrait=NavigationFollowFraming.padding(432,960,true,true,false)
        val landscape=NavigationFollowFraming.padding(960,432,true,true,true)
        assertArrayEquals(doubleArrayOf(0.0,441.6,0.0,0.0),portrait,0.001)
        val portraitCursorY=(960.0+portrait[1]-portrait[3])/2.0
        assertEquals("more road ahead, unchanged zoom",960.0*.73,portraitCursorY,0.001)
        assertArrayEquals(doubleArrayOf(172.8,164.16,0.0,0.0),landscape,0.001)
        // With top padding, the cursor is lower: more of the route AHEAD.
        val centeredY=(432.0+landscape[1]-landscape[3])/2.0
        val centeredX=(960.0+landscape[0]-landscape[2])/2.0
        assertEquals(432.0*.69,centeredY,0.001)
        assertTrue(centeredX>960.0*.58)
    }
    @Test fun northUpAndNoGuidanceKeepIntentionalFraming() {
        assertArrayEquals(doubleArrayOf(0.0,0.0,0.0,0.0),
            NavigationFollowFraming.padding(432,960,true,false,false),0.0)
        assertArrayEquals(doubleArrayOf(0.0,0.0,0.0,0.0),
            NavigationFollowFraming.padding(960,432,false,true,true),0.0)
        assertArrayEquals(doubleArrayOf(172.8,0.0,0.0,0.0),
            NavigationFollowFraming.padding(960,432,true,false,true),0.001)
    }
}
