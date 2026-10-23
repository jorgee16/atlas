package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class OverviewGuidanceInsetsTest {
    @Test fun gpsBannerExpansionCannotRefitOverview() {
        // CI #208: a 65px top-inset change, 640->705, moved a FREE/OVERVIEW
        // camera by ~14m although the user's gesture did not recenter it.
        val first=OverviewGuidanceInsets.top(0,true,620,3)
        val taller=OverviewGuidanceInsets.top(0,true,685,3)
        val compact=OverviewGuidanceInsets.top(0,true,560,3)
        assertEquals(first,taller)
        assertEquals(first,compact)
        assertTrue(first>=705)
    }
    @Test fun realScreenInsetAndOversizedBannerRemainProtected() {
        assertEquals(895,OverviewGuidanceInsets.top(40,true,620,3))
        assertEquals(1120,OverviewGuidanceInsets.top(40,true,1060,3))
        assertEquals(130,OverviewGuidanceInsets.top(10,false,null,3))
    }
}
