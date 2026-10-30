package com.atlas.nativeapp

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class TollCatalogTest {
    @Test fun referencePolicyRequiresRealSourcesAndClassExemptionsAreValidated() {
        val valid=String(csv())+"# referenceEstimate=road-then-country-average\n# referenceSourceRoads=T1\n"+
            "# freeRoadClasses=T2:5\n# freeRoadClassSource=https://example.test/law\n"
        assertEquals(listOf(1,5),TollCatalog.parse("Testland",valid.toByteArray(),"fixture").classes)
        for(invalid in listOf(valid.replace("referenceSourceRoads=T1","referenceSourceRoads=missing"),
            valid.replace("referenceSourceRoads=T1","referenceSourceRoads=T1,T1"),
            valid.replace("freeRoadClasses=T2:5","freeRoadClasses=T2:4"),
            valid.replace("freeRoadClassSource=https://","freeRoadClassSource=http://"))) {
            reject { TollCatalog.parse("Testland",invalid.toByteArray(),"fixture") }
        }
    }
    @Test fun entryExitCatalogUsesDirectedIndependentPricesAndAnIsolatedOfflineStore() {
        fun ticket(version:Int)= ("# country=Testland\n# currency=JPY\n# year=2026\n# version=$version\n"+
            "# fractionDigits=0\n# scheme=entry-exit\n# source=https://example.test/tickets\n"+
            "network;entry;exit;class1;class5\nnetwork;a;b;125;271\nnetwork;b;a;198;315\n").toByteArray()
        val one=ticket(1);val parsed=TollCatalog.parse("Testland",one,"fixture")
        assertEquals("entry-exit",parsed.scheme);assertEquals(listOf(1,5),parsed.classes)
        assertEquals(java.math.BigDecimal("271"),parsed.entryExitFares.first().amounts[5])
        reject { TollCatalog.parse("Otherland",one,"fixture") }
        reject { TollCatalog.parse("Testland",(String(one)+"network;a;b;1;2\n").toByteArray(),"fixture") }
        reject { TollCatalog.parse("Testland",(String(one)+"# status=candidate\n").toByteArray(),"fixture") }
        val root=temporary.newFolder()
        fun repository()=TollCatalogRepository(root,{if(it=="Testland")one else null},expectedScheme="entry-exit")
        val two=ticket(2)
        val metadata=manifest(two).put("scheme","entry-exit").put("path","/toll-fares/Testland/2/table.csv")
        repository().install("Testland",metadata,two)
        assertEquals(2L,repository().load("Testland")!!.revision)
        assertNull(repository().load("Spain"))
        assertEquals(1L,repository().rollback("Testland").revision)
        assertEquals(1L,repository().load("Testland")!!.revision)
        reject { TollCatalogRepository(temporary.newFolder(),{one}).install("Testland",metadata,two) }
    }
    @get:Rule val temporary=TemporaryFolder()
    private fun csv(version:Long=1,country:String="Testland",price:Int=230)=
        ("# country=$country\n# currency=JPY\n# year=2026\n# version=$version\n"+
        "# fractionDigits=0\n# source=https://example.test/fixture\n"+
        "road;section;km;class1;class5\nT1;one;10;100;$price\nT0;free;1;0;0\n").toByteArray()
    private fun manifest(bytes:ByteArray,country:String="Testland"):JSONObject {
        val c=TollCatalog.parse(country,bytes,"fixture")
        return JSONObject().put("schemaVersion",1).put("country",country).put("revision",c.revision)
            .put("currency",c.currency).put("year",c.year).put("fractionDigits",c.fractionDigits)
            .put("vehicleClasses",JSONArray(c.classes)).put("sizeBytes",bytes.size).put("sha256",c.sha256)
            .put("path","/toll-tariffs/$country/${c.revision}/table.csv")
    }
    private fun reject(action:()->Unit) {
        try { action();fail("Invalid catalog accepted") } catch(_:IllegalArgumentException) { }
    }
    private fun repo(root:File=temporary.newFolder())=TollCatalogRepository(root,{ if(it=="Testland")csv() else null })
    @Test fun countryAndClassesComeFromTheTable() {
        val r=repo();assertEquals(listOf(1,5),r.load("Testland")!!.classes)
        assertEquals("JPY",r.load("Testland")!!.currency)
        assertNull(r.load("Portugal"));assertNull(r.load("../Testland"))
        reject { TollCatalog.parse("Portugal",csv(),"fixture") }
        reject { TollCatalog.parse("Testland",(String(csv())+"T1;one;1;2;3\n").toByteArray(),"fixture") }
        reject { TollCatalog.parse("Testland",String(csv()).replace("230","NaN").toByteArray(),"fixture") }
    }
    @Test fun sameBundledRevisionIsAnIdempotentUpdate() {
        val r=repo();val bytes=csv()
        assertEquals(1L,r.install("Testland",manifest(bytes),bytes).revision)
        assertEquals("bundled",r.load("Testland")!!.origin)
        val changed=csv(price=999)
        reject { r.install("Testland",manifest(changed),changed) }
    }
    @Test fun updatesAreOfflineAndRollbackSurvivesRestart() {
        val root=temporary.newFolder();val r=repo(root)
        val two=csv(2);r.install("Testland",manifest(two),two)
        val three=csv(3);r.install("Testland",manifest(three),three)
        assertEquals(3L,repo(root).load("Testland")!!.revision)
        assertEquals(2L,r.rollback("Testland").revision)
        assertEquals(2L,repo(root).load("Testland")!!.revision)
        reject { r.install("Testland",manifest(three),three) }
        val four=csv(4);r.install("Testland",manifest(four),four)
        assertEquals(4L,r.load("Testland")!!.revision)
    }
    @Test fun invalidUpdateNeverReplacesLastGoodTable() {
        val r=repo();val two=csv(2);r.install("Testland",manifest(two),two)
        val three=csv(3)
        reject { r.install("Testland",manifest(three).put("sha256","0".repeat(64)),three) }
        reject { r.install("Testland",manifest(three).put("country","Portugal"),three) }
        reject { r.install("Testland",manifest(csv()),csv()) }
        val collision=csv(2,price=999)
        reject { r.install("Testland",manifest(collision),collision) }
        assertEquals(TollCatalog.digest(two),r.load("Testland")!!.sha256)
    }
    @Test fun interruptedWriteAndCorruptActiveFallBackSafely() {
        val root=temporary.newFolder();val r=repo(root)
        val two=csv(2);r.install("Testland",manifest(two),two)
        val three=csv(3);r.install("Testland",manifest(three),three)
        File(root,"Testland/.staging-interrupted").mkdirs()
        File(root,"Testland/3/table.csv").writeText("corrupt")
        assertEquals(2L,repo(root).load("Testland")!!.revision)
        File(root,"Testland/2/table.csv").writeText("corrupt")
        assertEquals(1L,repo(root).load("Testland")!!.revision)
    }
    @Test fun nativeValidationRunsBeforeActivation() {
        val root=temporary.newFolder();val r=TollCatalogRepository(root,{csv()},{_,_->throw IllegalArgumentException("Native parse failed")})
        val two=csv(2);reject { r.install("Testland",manifest(two),two) }
        assertEquals(1L,r.load("Testland")!!.revision)
        assertFalse(File(root,"Testland/2").exists())
    }
    @Test fun updaterRejectsForeignAndUnversionedPaths() {
        for(path in listOf("https://other.test/table.csv","//other.test/table.csv","/toll-tariffs/Testland/../table.csv","/table.csv")) {
            val r=repo();val bytes=csv(2);var calls=0
            val u=TollCatalogUpdater(r,"https://example.test") { _,_->
                calls++;manifest(bytes).put("path",path).toString().toByteArray()
            }
            reject { u.update("Testland") };assertEquals(1,calls);assertEquals(1L,r.load("Testland")!!.revision)
        }
    }
    @Test fun updaterVerifiesDownloadedBytesAndRetainsBundledOnFailure() {
        val bytes=csv(2);val r=repo()
        val u=TollCatalogUpdater(r,"https://example.test") { url,_->
            if(url.endsWith("manifest.json"))manifest(bytes).toString().toByteArray() else bytes
        }
        assertEquals(2L,u.update("Testland").revision)
        val bad=TollCatalogUpdater(r,"https://example.test") { url,_->
            if(url.endsWith("manifest.json"))manifest(csv(3)).toString().toByteArray() else csv(3,price=231)
        }
        reject { bad.update("Testland") };assertEquals(2L,r.load("Testland")!!.revision)
    }
    @Test fun unknownPriceCannotLookFreeInRoutePreview() {
        val route=JSONObject().put("hasTolls",true).put("tollPricing","unavailable")
            .put("tollAmount",JSONObject.NULL).put("tollEuros",0)
        assertEquals("Toll price not confirmed",RouteChoices.tollLabel(route))
        val known=route.put("tollPricing","estimate").put("tollAmount",230).put("tollCurrency","JPY")
            .put("tollFractionDigits",0)
        assertEquals("Toll price not confirmed",RouteChoices.tollLabel(known))
        known.put("tollPricing","exact")
        assertTrue(RouteChoices.tollLabel(known).contains("230"))
        assertFalse(RouteChoices.tollLabel(known).contains("230,00"))
    }
    private fun chargeCsv(version:Long=1)=("# country=Testland\n# currency=JPY\n# year=2026\n# version=$version\n"+
        "# scheme=fixed-crossing\n# fractionDigits=0\n# source=https://example.test/charges\n"+
        "charge;road;name;class1;class5\ngate:1;T1;West gate;100;230\ngate:2;T1;East gate;0;0\n").toByteArray()
    @Test fun fixedCrossingCatalogIsIsolatedFromRoadAverageCache() {
        val root=temporary.newFolder()
        val fixed=TollCatalogRepository(File(root,"charges"),{if(it=="Testland")chargeCsv() else null},expectedScheme="fixed-crossing")
        val road=TollCatalogRepository(File(root,"roads"),{if(it=="Testland")csv() else null})
        val c=fixed.load("Testland")!!
        assertEquals("fixed-crossing",c.scheme);assertEquals(2,c.fixedCharges.size)
        assertEquals(java.math.BigDecimal("230"),c.fixedCharges[0].amounts[5])
        val two=chargeCsv(2)
        val m=manifest(two).put("scheme","fixed-crossing").put("path","/toll-charges/Testland/2/table.csv")
        fixed.install("Testland",m,two)
        reject { road.install("Testland",m,two) }
        assertEquals("road-average",road.load("Testland")!!.scheme)
        assertEquals(1L,fixed.rollback("Testland").revision)
        assertNull(fixed.load("Portugal"))
    }
    @Test fun fixedUpdaterUsesIndependentVersionedNamespace() {
        val r=TollCatalogRepository(temporary.newFolder(),{chargeCsv()},expectedScheme="fixed-crossing")
        val two=chargeCsv(2);val urls=mutableListOf<String>()
        val updater=TollCatalogUpdater(r,"https://example.test",namespace="toll-charges") { url,_->
            urls.add(url)
            if(url.endsWith("manifest.json"))manifest(two).put("scheme","fixed-crossing")
                .put("path","/toll-charges/Testland/2/table.csv").toString().toByteArray() else two
        }
        assertEquals(2L,updater.update("Testland").revision)
        assertEquals(listOf("https://example.test/toll-charges/Testland/manifest.json",
            "https://example.test/toll-charges/Testland/2/table.csv"),urls)
    }
    @org.junit.Test fun explicitFreeRoadsRequireIndependentProvenanceAndCannotEnterFixedStore() {
        val csv="# country=Testland\n# currency=EUR\n# year=2026\n# version=1\n# source=https://example.test/prices\n"+
            "# freeRoads=T2,T3\n# freeRoadSource=https://example.test/statute\n"+
            "road;section;km;class1;class4\nT1;paid;1;0.20;0.40\n"
        assertEquals("road-average",TollCatalog.parse("Testland",csv.toByteArray(),"fixture").scheme)
        for(invalid in listOf(csv.replace("freeRoadSource=https://","freeRoadSource=http://"),
            csv.replace("freeRoads=T2,T3","freeRoads=T2,T2"),csv.replace("freeRoads=T2,T3","freeRoads="))) {
            var rejected=false
            try { TollCatalog.parse("Testland",invalid.toByteArray(),"fixture") } catch(_:IllegalArgumentException) { rejected=true }
            org.junit.Assert.assertTrue("Invalid explicit-free evidence must be rejected",rejected)
        }
    }

}
