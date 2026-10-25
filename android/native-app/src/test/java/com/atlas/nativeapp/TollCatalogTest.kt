package com.atlas.nativeapp

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class TollCatalogTest {
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
        assertTrue(RouteChoices.tollLabel(route).contains("unavailable"))
        val known=route.put("tollPricing","estimate").put("tollAmount",230).put("tollCurrency","JPY")
            .put("tollFractionDigits",0)
        assertTrue(RouteChoices.tollLabel(known).contains("230"))
        assertFalse(RouteChoices.tollLabel(known).contains("230,00"))
    }
}
