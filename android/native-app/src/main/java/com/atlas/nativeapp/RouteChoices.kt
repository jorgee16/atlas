package com.atlas.nativeapp

import org.json.JSONObject

/** Compact road labels and actual diversity checks for native C++ route options. */
internal object RouteChoices {
    fun roads(refs: List<String>): String =
        refs.take(4).joinToString(" → ").ifBlank { "Local roads" }

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
