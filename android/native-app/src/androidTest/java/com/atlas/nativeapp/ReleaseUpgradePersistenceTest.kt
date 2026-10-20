package com.atlas.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Works against any compatible previous Atlas version: uses only persisted
 * SharedPreferences keys, never mutable process-only ViewModel state.
 */
@RunWith(AndroidJUnit4::class)
class ReleaseUpgradePersistenceTest {
    @Test fun persistsAtlasPreferences() {
        val args = InstrumentationRegistry.getArguments()
        val phase = args.getString("upgradePhase")
        val preferences = InstrumentationRegistry.getInstrumentation()
            .targetContext.getSharedPreferences("atlas-native", 0)
        when (phase) {
            "write" -> {
                val ok = preferences.edit()
                    .putString("atlas-release-upgrade-probe", "persistent-v1")
                    .putString("theme", "dark")
                    .putString("mapSourceMode", "offline")
                    .putBoolean("voice", false)
                    .putString("bookmarks", "[{\"id\":\"upgrade-check\",\"name\":\"Saved location\"}]")
                    .commit()
                assertTrue("Must persist real Atlas settings before upgrade", ok)
            }
            "verify" -> {
                assertEquals("persistent-v1", preferences.getString("atlas-release-upgrade-probe", null))
                assertEquals("dark", preferences.getString("theme", null))
                assertEquals("offline", preferences.getString("mapSourceMode", null))
                assertFalse(preferences.getBoolean("voice", true))
                assertTrue(preferences.getString("bookmarks", "")!!.contains("upgrade-check"))
            }
            else -> fail("upgradePhase must be write or verify")
        }
    }
}
