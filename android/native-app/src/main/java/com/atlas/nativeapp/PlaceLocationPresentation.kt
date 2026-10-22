package com.atlas.nativeapp

import org.json.JSONObject
import java.util.Locale

/** Grounded offline location context, never inferred from the search origin. */
internal object PlaceLocationPresentation {
    fun subtitle(place: JSONObject): String =
        listOf("city","municipality","district","country")
            .map { place.optString(it).trim() }
            .filter { it.isNotBlank() }
            .distinctBy { it.lowercase(Locale.ROOT) }
            .joinToString(" · ")
}
