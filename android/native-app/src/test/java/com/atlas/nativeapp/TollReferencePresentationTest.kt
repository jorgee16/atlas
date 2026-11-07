package com.atlas.nativeapp

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TollReferencePresentationTest {
    @Test fun referenceEstimatesAreUsefulWithoutBeingPromotedToConfirmation() {
        val route=JSONObject().put("hasTolls",true).put("tollPricing","estimate")
            .put("tollAmount",1.25).put("tollCurrency","EUR").put("tollVehicleClass",1)
            .put("tollPricingConfidence","low").put("referenceTollMeters",1000)
            .put("tolledMeters",1000).put("pricedTollMeters",0)
        assertTrue(RouteChoices.tollLabel(route).contains("1,25"))
        assertTrue(RouteChoices.tollLabel(route).endsWith("estimate (not confirmed)"))
        assertTrue(RouteChoices.previewTollDetails(route).contains("Low-confidence"))
        assertFalse(RouteChoices.tollLabel(route).contains("exact"))
        assertTrue(RouteChoices.tollProvenance(route).contains("no verified tariff"))
        val unknown=JSONObject(route.toString()).put("tollAmount",JSONObject.NULL).put("tollPricing","unavailable")
        assertEquals("Toll price unavailable",RouteChoices.tollLabel(unknown))
        val exact=JSONObject(route.toString()).put("tollPricing","exact").put("referenceTollMeters",0)
            .put("pricedTollMeters",1000).put("tollPricingConfidence","exact")
        assertTrue(RouteChoices.tollLabel(exact).contains("confirmed"))
        assertFalse(RouteChoices.tollProvenance(exact).contains("Low-confidence"))
    }
}
