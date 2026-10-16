package com.atlas.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NavigationEndStateTest {
    @Test fun endingNavigationDiscardsAllRouteVisualInputs() {
        val route = JSONObject().put("distanceMeters", 12500.0)
        val state = AtlasState(
            navigating = true,
            busy = true,
            tab = "Navigation",
            route = route,
            routeOptions = listOf(route),
            guidance = JSONObject().put("segment", 7),
            destination = JSONObject().put("id", "destination"),
            arrived = false
        )
        val ended = state.afterEndingNavigation()
        assertFalse(ended.navigating)
        assertFalse(ended.busy)
        assertNull(ended.route)
        assertTrue(ended.routeOptions.isEmpty())
        assertNull(ended.guidance)
        assertNull(ended.destination)
        assertEquals("Explore", ended.tab)
    }

    @Test fun endingNavigationPreservesPositionAndExplorerPreferences() {
        val fix = Fix(Coordinate(40.0, -8.0), 7.0, 0.0, null, 120.0)
        val state = AtlasState(navigating = true, fix = fix)
        val ended = state.afterEndingNavigation()
        assertEquals(fix, ended.fix)
        assertEquals(state.mode, ended.mode)
        assertFalse(ended.arrived)
    }
}
