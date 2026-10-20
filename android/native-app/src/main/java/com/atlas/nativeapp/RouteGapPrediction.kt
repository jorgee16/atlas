package com.atlas.nativeapp

import org.json.JSONObject
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min

/** Visual-only prediction bounded by age, speed, distance and route endpoint. */
internal object RouteGapPrediction {
    fun predict(route: JSONObject, guidance: JSONObject, fix: Fix, now: Double): JSONObject? {
        // GPS is published before its asynchronous JNI projection. A newer
        // fix must never lend its timestamp to the previous fix's route point.
        if (!NavigationResumePolicy.currentGuidance(fix.time,
                guidance.optDouble("gpsFixTime", Double.NaN))) return null
        val age = now - fix.time
        if (!age.isFinite() || age < 2.0 || age > 9.0 ||
            StationaryMapPosition.visualSpeed(fix) < 2.0 || fix.accuracy > 35.0 ||
            guidance.optString("state") == "arrived" ||
            guidance.optString("state") == "reroute" ||
            guidance.optString("state") == "checking" ||
            guidance.optDouble("offRoute", 0.0) > 60.0) return null
        if (guidance.optDouble("predictedAt", fix.time) >= now) return null
        val points = route.optJSONArray("points") ?: return null
        val total = route.optDouble("distanceMeters")
        val base = guidance.optDouble("predictionBaseAlong", guidance.optDouble("along"))
        if (points.length() < 2 || !total.isFinite() || total <= 0 || !base.isFinite()) return null
        val target = min(total - 30.0, base + min(110.0, age * min(fix.speed, 25.0)))
        val previous = guidance.optDouble("along")
        if (target <= previous) return null
        val lengths = DoubleArray(points.length() - 1)
        var length = 0.0
        for (i in lengths.indices) {
            val a = points.getJSONArray(i)
            val b = points.getJSONArray(i + 1)
            val mid = Math.toRadians((a.getDouble(1) + b.getDouble(1)) / 2.0)
            val dy = (b.getDouble(1) - a.getDouble(1)) * 111320.0
            val dx = (b.getDouble(0) - a.getDouble(0)) * 111320.0 * cos(mid)
            lengths[i] = hypot(dx, dy)
            length += lengths[i]
        }
        if (length <= 0.0) return null
        val targetLength = target / total * length
        var traversed = 0.0
        for (i in lengths.indices) {
            val segment = lengths[i]
            if (traversed + segment >= targetLength || i == lengths.lastIndex) {
                val a = points.getJSONArray(i)
                val b = points.getJSONArray(i + 1)
                val f = if (segment > 0) ((targetLength - traversed) / segment)
                    .coerceIn(0.0, 1.0) else 0.0
                return JSONObject(guidance.toString()).apply {
                    put("lat", a.getDouble(1) + (b.getDouble(1) - a.getDouble(1)) * f)
                    put("lon", a.getDouble(0) + (b.getDouble(0) - a.getDouble(0)) * f)
                    put("segment", i)
                    put("along", target)
                    put("remaining", total - target)
                    put("toManeuver", (guidance.optDouble("toManeuver") - (target - previous)).coerceAtLeast(0.0))
                    put("seconds", (guidance.optDouble("seconds") - (target - previous) / fix.speed).coerceAtLeast(0.0))
                    put("state", "reduced")
                    put("predictionBaseAlong", base)
                    put("predictedAt", now)
                }
            }
            traversed += segment
        }
        return null
    }
}

