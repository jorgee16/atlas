package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class PlaceLocationPresentationTest {
    @Test fun repeatedBrandNamesGainMunicipalityDistrictAndCountry() {
        assertEquals("Loures · Lisboa · Portugal",
            PlaceLocationPresentation.subtitle(
                city = "Loures", municipality = "Loures",
                district = "Lisboa", country = "Portugal"))
    }

    @Test fun approximateNearestLocalityIsClearlyIdentified() {
        assertEquals("Near Torres Vedras · Portugal",
            PlaceLocationPresentation.subtitle(
                nearbyLocality = "Torres Vedras", country = "Portugal"))
    }

    @Test fun partialOfflineLocationNeverInventsAdministrativeArea() {
        assertEquals("Lisboa · Portugal",
            PlaceLocationPresentation.subtitle(
                district = "Lisboa", country = "Portugal"))
        assertEquals("", PlaceLocationPresentation.subtitle())
    }

    @Test fun actualAdminLocationTakesPrecedenceOverNearestLocality() {
        assertEquals("Loures · Lisboa · Portugal",
            PlaceLocationPresentation.subtitle(
                municipality = "Loures", district = "Lisboa",
                nearbyLocality = "Moscavide", country = "Portugal"))
    }
}
