package com.atlas.nativeapp

import org.json.JSONObject
import java.util.Locale

/** Compact road labels and actual diversity checks for native C++ route options. */
internal object RouteChoices {
    fun roads(refs: List<String>): String =
        refs.take(4).joinToString(" → ").ifBlank { "Local roads" }

    /** Never label an uncovered tolled road as €0. Never call a per-km
     * approximation an exact operator/Via Verde quote. */
    fun tollLabel(route: JSONObject): String {
        if (!route.optBoolean("hasTolls")) return "No toll roads"
        if (route.optString("tollPricing") != "estimate" ||
            route.isNull("tollEuros") || !route.has("tollEuros"))
            return "Toll roads · Price unavailable"
        val amount=route.optDouble("tollEuros",Double.NaN)
        if (!amount.isFinite() || amount<0) return "Toll roads · Price unavailable"
        val currency=route.optString("tollCurrency","EUR")
        val unit=when(currency) { "EUR"->"€";"GBP"->"£";else->"$currency " }
        val price=String.format(Locale.forLanguageTag("pt-PT"),"%.2f",amount)
        val year=route.optString("tollTariffYear","").takeIf { it.isNotBlank() }
        return "≈ $unit$price · estimate" +
            (if(year!=null) " ($year tariffs)" else "")
    }

    /** Explain which charged roads were recognized by the current country
     * table. Mixed coverage is shown per road; do not sum unknown prices. */
    fun tollRoadSummary(route: JSONObject): List<String> {
        val entries=route.optJSONArray("tollRoads") ?: return emptyList()
        val currency=route.optString("tollCurrency","EUR")
        val symbol=when(currency) {
            "EUR"->"€";"GBP"->"£";else->"$currency "
        }
        return (0 until minOf(entries.length(),4)).mapNotNull { index ->
            val road=entries.optJSONObject(index) ?: return@mapNotNull null
            val name=road.optString("road").takeIf { it.isNotBlank() }
                ?: return@mapNotNull null
            val amount=road.optDouble("amount",Double.NaN)
            if(road.optString("pricing")!="estimate" || !amount.isFinite())
                "$name · price unavailable"
            else "$name · ≈ $symbol" +
                String.format(Locale.forLanguageTag("pt-PT"),"%.2f",amount)
        }
    }

    fun roadSummary(route: JSONObject): String {
        val array = route.optJSONArray("mainRoads") ?: return roads(emptyList())
        return roads((0 until array.length()).map { array.optString(it) }
            .filter { it.isNotBlank() })
    }

    fun edgeIndexes(route: JSONObject): Set<Int> {
        val array = route.optJSONArray("edgeIndexes") ?: return emptySet()
        return (0 until array.length()).map { array.optInt(it,-1) }
            .filter { it >= 0 }.toSet()
    }

    /** Do not advertise a nearly identical line as a different alternative. */
    fun distinctEdges(candidate: Set<Int>, existing: Collection<Set<Int>>): Boolean {
        if (candidate.isEmpty()) return false
        return existing.none { other ->
            if (other.isEmpty()) false else {
                val common = candidate.count { it in other }
                common.toDouble() / minOf(candidate.size,other.size) >= 0.82
            }
        }
    }

    /** Reject unreasonable detours caused by excessive shared-edge penalties. */
    fun reasonableDetour(primarySeconds: Double, primaryMeters: Double,
                         alternateSeconds: Double, alternateMeters: Double): Boolean {
        if (!alternateSeconds.isFinite() || !alternateMeters.isFinite() ||
            alternateSeconds <= 0 || alternateMeters <= 0) return false
        return alternateSeconds <= maxOf(primarySeconds * 1.65, primarySeconds + 1200.0) &&
            alternateMeters <= maxOf(primaryMeters * 1.75, primaryMeters + 20000.0)
    }
}
