package com.atlas.nativeapp

import org.json.JSONObject
import java.util.Locale

/** Grounded offline location context, never inferred from the search origin. */
internal object PlaceLocationPresentation {
    // Keep the formatter JVM-only. Android's org.json.JSONObject throws
    // "Method not mocked" inside local Gradle unit tests.
    fun subtitle(
        city: String = "",
        municipality: String = "",
        district: String = "",
        nearbyLocality: String = "",
        country: String = ""
    ): String {
        val administrative = listOf(city, municipality, district)
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .distinctBy { it.lowercase(Locale.ROOT) }
        val nearby = nearbyLocality.trim()
        val area = if (administrative.isNotEmpty()) administrative
            else if (nearby.isNotBlank()) listOf("Near $nearby")
            else emptyList()
        return (area + listOf(country.trim()).filter { it.isNotBlank() })
            .distinctBy { it.lowercase(Locale.ROOT) }
            .joinToString(" · ")
    }

    // JSONObject is confined to production Android integration.
    fun subtitle(place: JSONObject): String = subtitle(
        city = place.optString("city"),
        municipality = place.optString("municipality"),
        district = place.optString("district"),
        nearbyLocality = place.optString("nearbyLocality"),
        country = place.optString("country")
    )
}
