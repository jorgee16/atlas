package com.atlas.nativeapp

import org.json.JSONObject

/** Same eligibility and 100-degree limit as analyze-native-gps-replay.py. */
internal object ReplayHeadingGate {
    fun violation(frame: JSONObject): JSONObject? {
        if (frame.optBoolean("follow") && frame.optBoolean("headingUp")) {
            val cursorError = AtlasHeading.angleDifference(0.0, frame.optDouble("cursorBearing", 0.0))
            if (cursorError >= 1.5) return JSONObject()
                .put("reason", "Heading-up cursor must point forward")
                .put("degrees", cursorError).put("frame", frame)
        }
        val phase = frame.optString("phase")
        val age = frame.optDouble("time") - frame.optDouble("truthFixTime", Double.NEGATIVE_INFINITY)
        if (!(phase.startsWith("drive-accuracy-") || phase == "reroute-replay" || phase == "walking") ||
            !frame.optBoolean("follow") || !frame.optBoolean("headingUp") ||
            frame.optDouble("speed", 0.0) < 1.2 || frame.optDouble("accuracy", 100.0) > 20.0 ||
            frame.optDouble("bearingAccuracy", 100.0) > 15.0 ||
            frame.optDouble("truthStableFor", 0.0) < 4.0 || !(age >= 0.0 && age < 1.5)) return null
        val error = AtlasHeading.angleDifference(frame.getDouble("mapBearing"), frame.getDouble("truthHeading"))
        return if (error >= 100.0) JSONObject()
            .put("reason", "Camera reversed against confirmed movement")
            .put("degrees", error).put("frame", frame) else null
    }
}
