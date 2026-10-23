package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class OverviewLandscapeInsetsTest {
    @Test fun wideMapUsesActualLeftCardsNotPortraitBottomSheet() {
        // Reproduce a 1536x684 screenshot with left-side guidance and HUD.
        val pad=OverviewLandscapeInsets.compute(
            1536,684,625,24,0,22,2)
        assertTrue(pad[0]>=625)
        assertTrue("north-south 236km route must have vertical room",
            684-pad[1]-pad[3]>=540)
        assertTrue("map still has clear space right of panels",
            1536-pad[0]-pad[2]>=650)
        assertTrue("landscape never reserves 160dp below a LEFT HUD",
            pad[3]<100)
    }
    @Test fun orientationAndNarrowDevicesKeepValidMapBounds() {
        val wide=OverviewLandscapeInsets.compute(1920,1080,800,30,0,20,3)
        assertTrue(wide[1]+wide[3]<1080*0.35)
        val compact=OverviewLandscapeInsets.compute(700,310,600,24,25,15,3)
        assertTrue(compact[0]+compact[2]<700)
        assertTrue(compact[1]+compact[3]<310)
    }
}
