package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class OverviewCameraFitTest {
    @Test fun routeGetsBreathingRoomInsideNavigationPanels() {
        val insets = intArrayOf(84, 640, 210, 579)
        val delta = OverviewCameraFit.zoomOut(1080, 1920, insets, 3f)
        assertTrue("must zoom out enough for a correcting GPS cursor",delta > 0.2)
        assertTrue("must not excessively shrink the overview",delta < 0.6)
    }

    @Test fun landscapeAndSmallViewportsRemainFinite() {
        assertTrue(OverviewCameraFit.zoomOut(1920, 1080,
            intArrayOf(560, 60, 240, 60), 2.0f) > 0.0)
        val compact = OverviewCameraFit.zoomOut(320, 240,
            intArrayOf(140, 100, 160, 130), 3.0f)
        assertTrue(compact.isFinite())
        assertTrue(compact in 0.0..0.75)
    }

    @Test fun invalidViewportsDoNotApplyAdditionalZoom() {
        assertEquals(0.0,OverviewCameraFit.zoomOut(0,1920,intArrayOf(0,0,0,0),3f),0.0)
        assertEquals(0.0,OverviewCameraFit.zoomOut(1080,1920,intArrayOf(0,0),3f),0.0)
    }
}
