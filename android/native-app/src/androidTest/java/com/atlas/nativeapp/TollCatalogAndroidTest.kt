package com.atlas.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Real APK assets, Android private storage and JNI parsing, without touching GPS. */
@RunWith(AndroidJUnit4::class)
class TollCatalogAndroidTest {
    @Test fun apkFallbackAndDownloadedCatalogSurviveOfflineRestartAndRollback() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val bundled=context.assets.open("tolls/Portugal.csv").use { it.readBytes() }
        val original=TollCatalog.parse("Portugal",bundled,"bundled")
        val root=File(context.cacheDir,"toll-test-"+UUID.randomUUID())
        fun repository()=TollCatalogRepository(root,{ if(it=="Portugal")bundled else null },
            { country,bytes -> NativeCore().use { it.tariffs(country,bytes) } })
        try {
            val r=repository()
            assertNull(r.load("Spain"))
            assertEquals(original.sha256,r.load("Portugal")!!.sha256)
            val updated=String(bundled,Charsets.UTF_8).replace("# version="+original.revision,
                "# version="+(original.revision+1)).toByteArray()
            val candidate=TollCatalog.parse("Portugal",updated,"cache")
            val manifest=JSONObject().put("schemaVersion",1).put("country",candidate.country)
                .put("revision",candidate.revision).put("currency",candidate.currency).put("year",candidate.year)
                .put("fractionDigits",candidate.fractionDigits).put("vehicleClasses",JSONArray(candidate.classes))
                .put("sha256",candidate.sha256).put("sizeBytes",updated.size)
            r.install("Portugal",manifest,updated)
            assertEquals(candidate.sha256,repository().load("Portugal")!!.sha256)
            assertEquals(original.revision,repository().rollback("Portugal").revision)
            assertEquals(original.sha256,repository().load("Portugal")!!.sha256)
            assertNull(repository().load("Spain"))
        } finally { root.deleteRecursively() }
    }
    @Test fun mismatchedCountryAndMalformedTablesAreRejectedByRealJni() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val bytes=context.assets.open("tolls/Portugal.csv").use { it.readBytes() }
        NativeCore().use { core ->
            core.tariffs("Portugal",bytes)
            var rejected=false
            try { core.tariffs("Spain",bytes) } catch(_:Exception) { rejected=true }
            assertTrue("JNI must reject a cross-country table",rejected)
            core.tariffs("Spain",null)
            rejected=false
            try { core.tariffs("Portugal","invalid".toByteArray()) } catch(_:Exception) { rejected=true }
            assertTrue("JNI must reject malformed tariffs",rejected)
            core.tariffs("Portugal",bytes)
        }
    }
    @Test fun fixedChargeAssetUsesTheRealNativeParserWithoutChangingRoadTariffs() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val repository=TollTableAssets.repository(context,TollCatalogKind.FIXED_CROSSING)
        val catalog=repository.load("Portugal")!!
        assertEquals("fixed-crossing",catalog.scheme)
        assertEquals(6,catalog.fixedCharges.count { it.road=="A5" })
        assertEquals(java.math.BigDecimal("1.60"),catalog.fixedCharges.first { it.id=="brisa:0501" }.amounts[1])
        NativeCore().use { it.tariffs("Portugal",catalog.csv) }
        assertEquals("road-average",TollTableAssets.repository(context).load("Portugal")!!.scheme)
        assertNull(repository.load("Spain"))
    }
}
