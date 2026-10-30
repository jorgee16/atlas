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
    @Test fun entryExitAssetLoadsThroughJniAndSurvivesOfflineRollbackWithoutCountryLeakage() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val bytes=context.assets.open("toll-fares/Portugal.csv").use { it.readBytes() }
        val catalog=TollCatalog.parse("Portugal",bytes,"bundled")
        assertEquals("entry-exit",catalog.scheme);assertEquals(3270,catalog.entryExitFares.size)
        val braga=catalog.entryExitFares.first { it.network=="brisa-published"&&it.entry=="0311"&&it.exit=="0316" }
        assertEquals(java.math.BigDecimal("3.85"),braga.amounts[1])
        assertFalse(catalog.entryExitFares.any { it.entry=="0211"&&it.exit=="0222" })
        NativeCore().use { core ->
            core.tariffs("Portugal",null);core.entryExitTariffs("Portugal",bytes)
            core.tariffs("Spain",null)
            var rejected=false
            try { core.entryExitTariffs("Portugal",bytes) } catch(_:Exception) { rejected=true }
            assertTrue("A previous country cannot supply entry/exit prices",rejected)
            core.entryExitTariffs("Spain",null)
        }
        val root=File(context.cacheDir,"ticket-test-"+UUID.randomUUID())
        fun repository()=TollCatalogRepository(root,{if(it=="Portugal")bytes else null},
            { country,data -> NativeCore().use { it.tariffs(country,data) } },"entry-exit")
        try {
            val updated=String(bytes,Charsets.UTF_8).replace("# version="+catalog.revision,"# version="+(catalog.revision+1)).toByteArray()
            val next=TollCatalog.parse("Portugal",updated,"cache")
            val manifest=JSONObject().put("schemaVersion",1).put("scheme","entry-exit").put("country","Portugal")
                .put("revision",next.revision).put("currency",next.currency).put("year",next.year)
                .put("fractionDigits",next.fractionDigits).put("vehicleClasses",JSONArray(next.classes))
                .put("sha256",next.sha256).put("sizeBytes",updated.size)
            repository().install("Portugal",manifest,updated)
            assertEquals(next.sha256,repository().load("Portugal")!!.sha256)
            assertEquals(catalog.sha256,repository().rollback("Portugal").sha256)
            assertEquals(catalog.sha256,repository().load("Portugal")!!.sha256)
            assertNull(repository().load("Spain"))
        } finally { root.deleteRecursively() }
    }
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
        assertEquals(32,catalog.fixedCharges.size)
        assertEquals(3,catalog.fixedCharges.count { it.road=="A16" })
        val idanha=catalog.fixedCharges.first { it.id=="ascendi:grande-lisboa:01" }
        assertEquals(java.math.BigDecimal("0.65"),idanha.amounts[1])
        assertEquals(java.math.BigDecimal("1.65"),idanha.amounts[4])
        assertFalse("Motorcycle-only prices must not leak into unrestricted classes",idanha.amounts.containsKey(5))
        NativeCore().use { it.tariffs("Portugal",catalog.csv) }
        assertEquals("road-average",TollTableAssets.repository(context).load("Portugal")!!.scheme)
        assertNull(repository.load("Spain"))
    }
}

