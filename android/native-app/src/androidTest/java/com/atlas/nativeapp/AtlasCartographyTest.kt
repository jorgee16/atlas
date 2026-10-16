package com.atlas.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AtlasCartographyTest {
    @Test fun differentStylesForNavigationAndExploration() {
        assertTrue(AtlasCartography.onlineUri(false, false).endsWith("/liberty"))
        assertTrue(AtlasCartography.onlineUri(false, true).endsWith("/positron"))
        assertTrue(AtlasCartography.onlineUri(true, true).endsWith("/dark"))
    }

    @Test fun offlineStylesIncludeBuildingsRoadsAndNames() {
        for (dark in listOf(true, false)) {
            val explore = JSONObject(AtlasCartography.offlineStyle(
                "pmtiles://file:///tmp/atlas.pmtiles", dark, false))
            val nav = JSONObject(AtlasCartography.offlineStyle(
                "pmtiles://file:///tmp/atlas.pmtiles", dark, true))
            val exploreIds = explore.getJSONArray("layers").let {
                (0 until it.length()).map { i -> it.getJSONObject(i).getString("id") }
            }
            val navIds = nav.getJSONArray("layers").let {
                (0 until it.length()).map { i -> it.getJSONObject(i).getString("id") }
            }
            assertTrue(exploreIds.contains("atlas-buildings"))
            assertTrue(exploreIds.contains("atlas-road-labels"))
            assertTrue(exploreIds.contains("atlas-poi-labels"))
            assertTrue(exploreIds.contains("atlas-parks"))
            assertTrue(navIds.contains("atlas-buildings"))
            assertTrue(navIds.contains("atlas-road-labels"))
            assertFalse(navIds.contains("atlas-poi-labels"))
            assertFalse(navIds.contains("atlas-parks"))
            assertEquals("pmtiles://file:///tmp/atlas.pmtiles",
                explore.getJSONObject("sources").getJSONObject("atlas").getString("url"))
        }
    }

    @Test fun darkStyleUsesReadableNonBlackPalette() {
        val style = JSONObject(AtlasCartography.offlineStyle("pmtiles://file:///tmp/atlas.pmtiles", true, true))
        val background = style.getJSONArray("layers").getJSONObject(0)
            .getJSONObject("paint").getString("background-color")
        assertEquals("#1D2B38", background)
    }
}
