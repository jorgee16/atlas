package com.atlas.nativeapp

import org.json.JSONObject
import java.util.Locale

/** Compact road labels and actual diversity checks for native C++ route options. */
internal object RouteChoices {
    fun roads(refs: List<String>): String =
        refs.take(4).joinToString(" → ").ifBlank { "Local roads" }

    private fun money(amount:Double,route:JSONObject):String {
        val code=route.optString("tollCurrency","")
        val digits=route.optInt("tollFractionDigits",2).coerceIn(0,3)
        val number=java.text.NumberFormat.getNumberInstance(Locale.forLanguageTag("pt-PT")).apply {
            minimumFractionDigits=digits;maximumFractionDigits=digits
        }.format(amount)
        val symbol=try { java.util.Currency.getInstance(code).getSymbol(Locale.forLanguageTag("pt-PT")) }
            catch(_:Exception) { code }
        return if(symbol.isBlank())number else "$symbol $number"
    }
    /** Unknown amounts never become zero, including legacy JSON. */
    fun tollLabel(route:JSONObject):String {
        if(!route.optBoolean("hasTolls"))return "No toll roads · "+money(0.0,route)
        val pricing=route.optString("tollPricing")
        val field=if(route.has("tollAmount"))"tollAmount" else "tollEuros"
        val amount=route.optDouble(field,Double.NaN)
        if(pricing !in listOf("estimate","exact") || route.isNull(field) || !amount.isFinite() || amount<0)
            return "Toll roads · Price unavailable"
        return (if(pricing=="exact")"" else "≈ ")+money(amount,route)+
            (if(pricing=="exact")" · exact" else " · estimate")
    }
    fun tollProvenance(route:JSONObject):String {
        val parts=mutableListOf("Class "+route.optInt("tollVehicleClass",1))
        route.optString("tollCountry").takeIf { it.isNotBlank() }?.let { parts.add(it) }
        route.optString("tollTariffYear").takeIf { it.isNotBlank() }?.let { parts.add("$it tariffs") }
        route.optString("tollTariffVersion").takeIf { it.isNotBlank() }?.let { parts.add("v$it") }
        val source=route.optString("tollTariffSource")
        val missing=(route.optDouble("tolledMeters",0.0)-route.optDouble("pricedTollMeters",0.0)).coerceAtLeast(0.0)
        return parts.joinToString(" · ")+(if(source.isNotBlank())"\nSource: $source" else "")+
            (if(missing>.1)"\nSome toll roads have no applicable price coverage." else "")+
            "\nSection-average estimates exclude special discounts and exemptions."
    }
    fun tollRoadSummary(route:JSONObject):List<String> {
        val entries=route.optJSONArray("tollRoads") ?: return emptyList()
        return (0 until entries.length()).mapNotNull { index ->
            val road=entries.optJSONObject(index) ?: return@mapNotNull null
            val name=road.optString("road").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val amount=road.optDouble("amount",Double.NaN)
            if(road.optString("pricing") !in listOf("estimate","exact") || road.isNull("amount") || !amount.isFinite() || amount<0)
                "$name · price unavailable"
            else "$name · "+(if(road.optString("pricing")=="exact")"" else "≈ ")+money(amount,route)
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

