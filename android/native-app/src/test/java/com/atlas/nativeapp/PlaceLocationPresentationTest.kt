package com.atlas.nativeapp

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PlaceLocationPresentationTest {
    @Test fun repeatedBrandNamesGainMunicipalityDistrictAndCountry() {
        val place=JSONObject().put("name","IKEA").put("city","Loures")
            .put("municipality","Loures").put("district","Lisboa")
            .put("country","Portugal")
        assertEquals("Loures · Lisboa · Portugal",
            PlaceLocationPresentation.subtitle(place))
    }
    @Test fun approximateNearestLocalityIsClearlyIdentified() {
        assertEquals("Near Torres Vedras · Portugal",PlaceLocationPresentation.subtitle(
            JSONObject().put("nearbyLocality","Torres Vedras")
                .put("country","Portugal")))
    }
    @Test fun partialOfflineLocationNeverInventsAdministrativeArea() {
        assertEquals("Lisboa · Portugal",PlaceLocationPresentation.subtitle(
            JSONObject().put("district","Lisboa").put("country","Portugal")))
        assertEquals("",PlaceLocationPresentation.subtitle(JSONObject()))
    }
}
