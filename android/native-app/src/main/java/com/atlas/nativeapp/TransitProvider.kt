package com.atlas.nativeapp

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Platform HTTP adapter for TfL; offline road-routing graphs are never used as transit routes. */
class TransitProvider {
    private suspend fun get(path: String): JSONObject = withContext(Dispatchers.IO) {
        val connection = URL("https://api.tfl.gov.uk$path").openConnection() as HttpURLConnection
        connection.connectTimeout = 15000; connection.readTimeout = 20000
        try {
            check(connection.responseCode in 200..299) { "Transit provider returned HTTP ${connection.responseCode}" }
            connection.inputStream.bufferedReader().use { JSONObject(it.readText()) }
        } finally { connection.disconnect() }
    }
    suspend fun journeys(from: Coordinate, to: Coordinate): List<JSONObject> {
        require(from.lat in 51.2..51.8 && from.lon in -0.6..0.4 && to.lat in 51.2..51.8 && to.lon in -0.6..0.4) { "Transit is currently available in London" }
        return (get("/Journey/JourneyResults/${from.lat},${from.lon}/to/${to.lat},${to.lon}?mode=bus,tube,dlr,overground,tram,elizabeth-line,national-rail")
            .optJSONArray("journeys") ?: JSONArray()).objects().sortedBy { it.optInt("duration", Int.MAX_VALUE) }
    }
    fun summary(journey: JSONObject): String {
        val legs = journey.optJSONArray("legs")?.objects() ?: emptyList()
        return "${journey.optInt("duration")} min · " + legs.map { leg ->
            val route = leg.optJSONArray("routeOptions")?.optJSONObject(0)?.optString("name").orEmpty()
            route.ifBlank { leg.optJSONObject("mode")?.optString("name") ?: "Walk" }
        }.joinToString(" → ")
    }
    fun instructions(journey: JSONObject): List<String> = journey.getJSONArray("legs").objects().map { leg ->
        val start = leg.optJSONObject("departurePoint")?.optString("commonName").orEmpty()
        val end = leg.optJSONObject("arrivalPoint")?.optString("commonName").orEmpty()
        val instruction = leg.optJSONObject("instruction")?.optString("summary").orEmpty()
        "$instruction\n$start → $end\n${leg.optString("departureTime").substringAfter('T')} – ${leg.optString("arrivalTime").substringAfter('T')}"
    }
}
