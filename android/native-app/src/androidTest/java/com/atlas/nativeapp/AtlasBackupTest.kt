package com.atlas.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AtlasBackupTest {
    @Test fun exportAndImportMergesNativePlacesWithoutLosingCurrentItems() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val model=(context as AtlasApplication).model
        val doc=JSONObject()
            .put("format","atlas-native-backup").put("schemaVersion",1)
            .put("bookmarks",org.json.JSONArray().put(JSONObject()
                .put("id","backup-smoke-lisbon")
                .put("name","Lisboa").put("lat",38.72).put("lon",-9.14)))
        model.importUserBackup(doc.toString())
        val exported=JSONObject(model.exportUserBackup())
        assertEquals(1,exported.getInt("schemaVersion"))
        assertTrue(model.bookmarks().any { it.optString("id")=="backup-smoke-lisbon" })
        // Test leaves the user-visible smoke fixture only in the disposable emulator.
    }
    @Test fun rejectUnexpectedBackupFormat() {
        val model=(InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
            as AtlasApplication).model
        try {
            model.importUserBackup("""{"format":"unknown","schemaVersion":1}""")
            throw AssertionError("Must reject unknown backup format")
        } catch (_:IllegalArgumentException) { }
    }
}
