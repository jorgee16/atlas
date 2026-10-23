package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class OverviewGuidanceInsetsTest {
    @Test fun realEmulatorGpsBannerResizeCannotRefitOverview() {
        // CI #211: real emulator traces showed Overview top padding 633 -> 693
        // -> 633 px, moving the detached camera 12.29m + 3.13m.
        val before=OverviewGuidanceInsets.top(0,true,633,2)
        val taller=OverviewGuidanceInsets.top(0,true,693,2)
        val compact=OverviewGuidanceInsets.top(0,true,560,2)
        assertEquals(720,before)
        assertEquals(before,taller)
        assertEquals(before,compact)
        // A navigation banner still has room without a content-driven refit.
        assertTrue(before > 693)
    }
    @Test fun orientationInsetsStillChangeOverviewTarget() {
        val portrait=OverviewGuidanceInsets.top(30,true,660,2)
        val landscape=OverviewGuidanceInsets.top(90,true,660,2)
        assertEquals(60,landscape-portrait)
    }
    @Test fun nonNavigationInsetsRespectActualOverlayBounds() {
        assertEquals(130,OverviewGuidanceInsets.top(10,false,null,3))
        assertEquals(280,OverviewGuidanceInsets.top(10,false,220,3))
    }
}
