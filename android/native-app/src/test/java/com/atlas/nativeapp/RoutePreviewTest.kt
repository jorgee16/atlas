package com.atlas.nativeapp

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RoutePreviewTest {
    private fun route(paid: Boolean, seconds: Double, meters: Double, vararg edges: Int) =
        JSONObject().put("hasTolls",paid).put("durationSeconds",seconds)
            .put("distanceMeters",meters).put("edgeIndexes",JSONArray(edges.toList()))

    @Test fun slowerFreeRouteIsNotRejectedAsAnExcessivePaidDetour() {
        val paid=route(true,2520.0,64400.0,1,2,3)
        val free=route(false,5280.0,73700.0,1,4,5)
        assertTrue(RouteChoices.acceptAlternative(free,listOf(paid),2520.0,64400.0))
        assertFalse(RouteChoices.acceptAlternative(
            route(true,10000.0,90000.0,6,7,8),listOf(paid),2520.0,64400.0))
    }

    @Test fun avoidingAShortTollBridgeStillCountsAsARealFreeAlternative() {
        val paid=route(true,600.0,10000.0,1,2,3,4,5,6,7,8,9,10)
        val free=route(false,900.0,11000.0,1,2,3,4,5,6,7,8,9,11)
        assertTrue(RouteChoices.acceptAlternative(free,listOf(paid),600.0,10000.0))
        assertFalse(RouteChoices.acceptAlternative(paid,listOf(paid),600.0,10000.0))
        assertFalse(RouteChoices.acceptAlternative(
            route(false,Double.NaN,11000.0,11),listOf(paid),600.0,10000.0))
    }

    @Test fun paidPaidFreeOrderingPreservesNativeRouteKeysAndObjects() {
        val free=route(false,5280.0,73700.0,1).put("key",0)
        val first=route(true,2520.0,64400.0,2).put("key",1)
        val second=route(true,2700.0,66000.0,3).put("key",2)
        val shown=RouteChoices.previewOptions(listOf(free,first,second))
        assertEquals(listOf(first,second,free),shown)
        assertSame(free,shown.last())
        assertEquals(0,shown.last().getInt("key"))
        assertEquals(listOf(free),RouteChoices.previewOptions(listOf(free)))
    }

    @Test fun previewPricesArePlainAndNeverTurnUnknownIntoZero() {
        val paid=route(true,2520.0,64400.0,1).put("tollPricing","estimate")
            .put("tollAmount",5.8).put("tollCurrency","EUR")
            .put("tollPricingConfidence","low")
        assertTrue(RouteChoices.previewTollLabel(paid).contains("estimated"))
        assertFalse(RouteChoices.previewTollLabel(paid).contains("confidence"))
        paid.put("tollPricing","exact")
        assertTrue(RouteChoices.previewTollLabel(paid).contains("confirmed"))
        paid.put("tollAmount",JSONObject.NULL)
        assertEquals("Toll price unavailable",RouteChoices.previewTollLabel(paid))
        assertTrue(RouteChoices.previewTollLabel(route(false,600.0,10000.0,1))
            .startsWith("No tolls"))
    }
}
