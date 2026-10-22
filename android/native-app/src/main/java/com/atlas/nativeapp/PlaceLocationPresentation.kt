package com.atlas.nativeapp

import org.json.JSONObject
import java.util.Locale

/** Grounded offline location context, never inferred from the search origin. */
internal object PlaceLocationPresentation {
    fun subtitle(place: JSONObject): String {
        val administrative=listOf("city","municipality","district")
            .map { place.optString(it).trim() }
            .filter { it.isNotBlank() }
            .distinctBy { it.lowercase(Locale.ROOT) }
        val nearby=place.optString("nearbyLocality").trim()
        val country=place.optString("country").trim()
        val context=if(administrative.isNotEmpty())administrative
            else if(nearby.isNotBlank())listOf("Near $nearby")
            else emptyList()
        return (context+listOf(country).filter { it.isNotBlank() })
            .distinctBy { it.lowercase(Locale.ROOT) }.joinToString(" · ")
    }
}
