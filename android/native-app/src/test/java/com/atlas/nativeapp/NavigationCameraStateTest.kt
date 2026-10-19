package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test
import com.atlas.nativeapp.NavigationCameraState.Mode.*

class NavigationCameraStateTest {
    @Test fun lastTapWinsAcrossRapidOverviewRecenterAndStyleCallbacks() {
        val camera=NavigationCameraState()
        camera.request(OVERVIEW)
        val old=camera.revision
        camera.viewportChanged()
        camera.request(FOLLOWING)
        camera.applied(old)
        assertEquals(FOLLOWING,camera.mode)
        assertTrue(camera.pending)
        camera.applied(camera.revision)
        assertFalse(camera.pending)
        camera.request(OVERVIEW)
        assertEquals(OVERVIEW,camera.mode)
        assertTrue(camera.pending)
    }
    @Test fun styleAndLayoutChangesRetainEachMode() {
        for(mode in listOf(FOLLOWING,OVERVIEW,FREE)) {
            val camera=NavigationCameraState()
            camera.request(mode)
            camera.applied(camera.revision)
            camera.viewportChanged()
            assertEquals(mode,camera.mode)
            assertEquals(mode!=FREE,camera.pending)
        }
    }
    @Test fun manualGestureCancelsPendingOverviewUntilExplicitRecenter() {
        val camera=NavigationCameraState()
        camera.request(OVERVIEW)
        val overview=camera.revision
        camera.request(FREE)
        camera.applied(overview)
        camera.viewportChanged()
        assertEquals(FREE,camera.mode)
        assertFalse(camera.pending)
        camera.request(FOLLOWING)
        assertTrue(camera.pending)
    }
    @Test fun repeatedRecenterIsAnExplicitNewFramingRequest() {
        val camera=NavigationCameraState()
        camera.applied(camera.revision)
        camera.request(FOLLOWING)
        assertTrue(camera.pending)
    }
}
