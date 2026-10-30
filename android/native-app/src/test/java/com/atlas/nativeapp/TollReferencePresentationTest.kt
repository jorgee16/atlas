package com.atlas.nativeapp

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TollReferencePresentationTest {
    @Test fun unconfirmedReferenceAmountsAreHiddenWithoutLosingTariffDiagnostics() {
        val route=JSONObject().put("hasTolls",true).put("tollPricing","estimate")
            .put("tollAmount",1.25).put("tollCurrency","EUR").put("tollVehicleClass",1)
            .put("tollPricingConfidence","low").put("referenceTollMeters",1000)
            .put("tolledMeters",1000).put("pricedTollMeters",0)
        assertEquals("Toll price not confirmed",RouteChoices.tollLabel(route))
        assertFalse(RouteChoices.previewTollDetails(route).contains("1,25"))
        assertFalse(RouteChoices.tollLabel(route).contains("exact"))
        assertTrue(RouteChoices.tollProvenance(route).contains("no verified tariff"))
        val unknown=JSONObject(route.toString()).put("tollAmount",JSONObject.NULL).put("tollPricing","unavailable")
        assertEquals("Toll price not confirmed",RouteChoices.tollLabel(unknown))
        val exact=JSONObject(route.toString()).put("tollPricing","exact").put("referenceTollMeters",0)
            .put("pricedTollMeters",1000).put("tollPricingConfidence","exact")
        assertTrue(RouteChoices.tollLabel(exact).contains("confirmed"))
        assertFalse(RouteChoices.tollProvenance(exact).contains("Low-confidence"))
    }
}
