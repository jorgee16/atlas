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
    fun verifiedFree(route:JSONObject):Boolean = route.optBoolean("tollFreeVerified") ||
        (route.optString("tollPricing")=="exact" && !route.isNull("tollAmount") && route.optDouble("tollAmount",Double.NaN)==0.0)
    fun freeRouteName(route:JSONObject):String = if(verifiedFree(route))"No tolls" else "Avoid tolls"
    /** Estimates and graph detection are never promoted into confirmed prices. */
    fun tollLabel(route:JSONObject):String = previewTollLabel(route)
    data class PreviewPrice(val value: String, val status: String)
    /** Separate the price from its qualifier so neither crowds out the journey time. */
    fun previewPrice(route: JSONObject): PreviewPrice {
        if (verifiedFree(route)) return PreviewPrice(money(0.0, route), "No tolls")
        val unavailable = PreviewPrice("—", "Price unavailable")
        if (!route.optBoolean("hasTolls")) return unavailable
        val field = if (route.has("tollAmount")) "tollAmount" else "tollEuros"
        val amount = route.optDouble(field, Double.NaN)
        if (route.isNull(field) || !amount.isFinite() || amount < 0) return unavailable
        return when (route.optString("tollPricing")) {
            "exact" -> PreviewPrice(money(amount, route), "confirmed")
            "estimate" -> if (amount > 0) PreviewPrice("≈ " + money(amount, route), "estimated") else unavailable
            else -> unavailable
        }
    }
    /** Short customer-facing label; tariff provenance remains in the details sheet. */
    fun previewTollLabel(route: JSONObject): String {
        val price = previewPrice(route)
        if (price.value == "—") return "Toll price unavailable"
        return if (verifiedFree(route)) "No tolls · ${price.value}" else "${price.value} · ${price.status}"
    }

    fun previewTollDetails(route: JSONObject): String {
        val metadata = listOf("Class ${route.optInt("tollVehicleClass",1)}",
            route.optString("tollCountry"), route.optString("tollTariffYear"),
            route.optString("tollTariffVersion").takeIf { it.isNotBlank() }?.let { "Revision $it" }.orEmpty())
            .filter { it.isNotBlank() }.joinToString(" · ")
        val confirmed=route.optString("tollPricing")=="exact"
        val roads=if(confirmed) tollRoadSummary(route) else emptyList()
        val notice=if(confirmed) "Published prices; special discounts are not included."
            else if(route.optString("tollPricing")=="estimate")
                "${if(route.optString("tollPricingConfidence")=="low")"Low-confidence reference" else "Section-average"} estimate, not a confirmed trip price. Fixed fees and exemptions can change the total."
            else pricingReason(route)
        return (listOf(previewTollLabel(route),metadata) + roads + notice +
            listOf(route.optString("tollTariffSource")).filter { it.isNotBlank() }).joinToString("\n\n")
    }
    private fun pricingReason(route:JSONObject):String = when(route.optString("tollPricingReason")) {
        "unreviewed_edge","missing_mapping" -> "Some crossings or entry/exit points have not been verified for this route."
        "missing_fare","missing_fare_provider" -> "No applicable published fare is available."
        "class" -> "This vehicle class has no applicable price."
        "graph_hash" -> "The toll mapping does not match the installed road data."
        "direction" -> "The crossing direction has not been verified."
        "catalog_identity" -> "The tariff tables are incompatible."
        else -> "No toll total has been verified for this route."
    }

    /** Two real paid corridors, then a real free route; never invent alternatives. */
    fun previewOptions(choices: List<JSONObject>): List<JSONObject> =
        choices.filter { it.optBoolean("hasTolls") }.take(2) +
            choices.filter { !it.optBoolean("hasTolls") }.take(1)

    fun acceptAlternative(candidate: JSONObject, choices: List<JSONObject>,
                          primarySeconds: Double, primaryMeters: Double): Boolean {
        val edges = edgeIndexes(candidate)
        val seconds = candidate.optDouble("durationSeconds", Double.NaN)
        val meters = candidate.optDouble("distanceMeters", Double.NaN)
        if (edges.isEmpty() || !seconds.isFinite() || seconds <= 0 ||
            !meters.isFinite() || meters <= 0) return false
        if (!candidate.optBoolean("hasTolls")) {
            // A free route can legitimately be much slower, or share most of
            // the journey except a short tolled bridge. Neither is a duplicate.
            return choices.none { edgeIndexes(it) == edges }
        }
        return choices.none { edgeIndexes(it) == edges } &&
            distinctEdges(edges, choices.filter { it.optBoolean("hasTolls") }.map(::edgeIndexes)) &&
            reasonableDetour(primarySeconds, primaryMeters, seconds, meters)
    }

    fun tollProvenance(route:JSONObject):String {
        val parts=mutableListOf("Class "+route.optInt("tollVehicleClass",1))
        route.optString("tollCountry").takeIf { it.isNotBlank() }?.let { parts.add(it) }
        route.optString("tollTariffYear").takeIf { it.isNotBlank() }?.let { parts.add("$it tariffs") }
        route.optString("tollTariffVersion").takeIf { it.isNotBlank() }?.let { parts.add("v$it") }
        val source=route.optString("tollTariffSource")
        val reference=route.optDouble("referenceTollMeters",0.0)
        val missing=(route.optDouble("tolledMeters",0.0)-route.optDouble("pricedTollMeters",0.0)).coerceAtLeast(0.0)
        return parts.joinToString(" · ")+(if(source.isNotBlank())"\nSource: $source" else "")+
            (if(reference>0)"\nLow-confidence reference estimate: some roads have no verified tariff. Fixed fees and exemptions may change the actual charge."
             else if(missing>.1)"\nSome toll roads have no applicable price coverage." else "")+
            (if(route.optString("tollPricing")=="exact")"\nPublished base tariffs exclude special discounts and exemptions."
             else if(reference>0)"\nReference rates come from the available official country tables; this is not an official trip quote."
             else "\nSection-average estimates exclude special discounts and exemptions.")
    }
    fun tollRoadSummary(route:JSONObject):List<String> {
        val entries=route.optJSONArray("tollRoads") ?: return emptyList()
        return (0 until entries.length()).mapNotNull { index ->
            val road=entries.optJSONObject(index) ?: return@mapNotNull null
            val ref=road.optString("road").takeIf { it.isNotBlank() } ?: return@mapNotNull null
            val name=road.optString("name").takeIf { it.isNotBlank() }?.let { "$ref · $it" } ?: ref
            val amount=road.optDouble("amount",Double.NaN)
            if(road.optString("pricing") != "exact" || road.isNull("amount") || !amount.isFinite() || amount<0)
                "$name · price not confirmed"
            else "$name · "+(if(road.optString("pricing")=="exact")"" else "≈ ")+money(amount,route)+
                (if(road.optString("pricingConfidence")=="low")" · low confidence" else "")
        }
    }

    fun roadSummary(route: JSONObject): String {
        val array = route.optJSONArray("displayMainRoads") ?: route.optJSONArray("mainRoads") ?: return roads(emptyList())
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
