package com.atlas.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MapSourcePolicyTest {
    @Test fun autoPrefersOfflineWhenInstalled() {
        assertEquals(MapSourcePolicy.OFFLINE, MapSourcePolicy.resolve("auto", true))
        assertEquals(MapSourcePolicy.ONLINE, MapSourcePolicy.resolve("auto", false))
    }
    @Test fun onlineOverridesDownloadedMap() {
        assertEquals(MapSourcePolicy.ONLINE, MapSourcePolicy.resolve("online", true))
        assertEquals(MapSourcePolicy.ONLINE, MapSourcePolicy.resolve("online", false))
    }
    @Test fun offlineNeverFallsBackToNetwork() {
        assertEquals(MapSourcePolicy.OFFLINE, MapSourcePolicy.resolve("offline", true))
        assertEquals(MapSourcePolicy.UNAVAILABLE, MapSourcePolicy.resolve("offline", false))
    }
    @Test fun rejectsUnknownPreferences() {
        assertTrue(MapSourcePolicy.isValid("auto"))
        assertFalse(MapSourcePolicy.isValid("connected"))
        try {
            MapSourcePolicy.resolve("connected", true)
            throw AssertionError("Unknown preference must be rejected")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }
    }
}
