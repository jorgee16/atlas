package com.atlas.nativeapp

import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class CountryRoadLabelsTest {
    private val config="""{"country":"Portugal","aliases":{"IC15":"A5","A36":"IC17","A37":"IC19"}}"""
    @Test fun aliasesDoNotAdvertiseExtraRoads() {
        val labels=CountryRoadLabels.parse("Portugal",config)
        assertEquals(listOf("A5","IC17"),labels.resolve(JSONArray(listOf("A5","IC15","A36","IC17"))))
        assertEquals(listOf("IC19","IC17"),labels.resolve(JSONArray(listOf("A37","IC19","A36","IC17"))))
        assertEquals(listOf("A16","IC19","A9"),labels.resolve(JSONArray(listOf("A16","A37","IC19","A9"))))
    }
    @Test fun noCountryConfigurationDoesNotReusePortugalAliases() {
        assertEquals(listOf("A36","IC17"),CountryRoadLabels.parse("Elsewhere",null)
            .resolve(JSONArray(listOf("A36","IC17"))))
    }
    @Test fun presentationLeavesAuthoritativeInputUntouched() {
        val input=JSONArray(listOf("A 5","IC 15","A 36","IC 17"));val before=input.toString()
        assertEquals(listOf("A5","IC17"),CountryRoadLabels.parse("Portugal",config).resolve(input))
        assertEquals(before,input.toString())
    }
    @Test(expected=IllegalArgumentException::class) fun countryMismatchIsRejected() {
        CountryRoadLabels.parse("Elsewhere",config)
    }
}
