package com.atlas.nativeapp

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ReplayHeadingGateTest {
    private fun confirmed() = JSONObject()
        .put("phase", "reroute-replay").put("time", 20.0).put("truthFixTime", 19.5)
        .put("truthStableFor", 4.0).put("follow", true).put("headingUp", true)
        .put("speed", 8.0).put("accuracy", 5.0).put("bearingAccuracy", 8.0)
        .put("truthHeading", 0.0).put("mapBearing", 115.0)

    @Test fun confirmedRerouteReversalFailsImmediately() {
        val failure = checkNotNull(ReplayHeadingGate.violation(confirmed()))
        assertEquals(115.0, failure.getDouble("degrees"), 0.0)
        assertEquals("reroute-replay", failure.getJSONObject("frame").getString("phase"))
    }

    @Test fun thresholdAndNorthWrapMatchFinalAnalyzer() {
        assertNotNull(ReplayHeadingGate.violation(confirmed().put("mapBearing", 100.0)))
        assertNull(ReplayHeadingGate.violation(confirmed().put("mapBearing", 99.9)))
        assertNull(ReplayHeadingGate.violation(confirmed().put("truthHeading", 359.0).put("mapBearing", 1.0)))
    }

    @Test fun genuineTurnsStaleOrUnreliableGpsDoNotTriggerTheGate() {
        for ((key, value) in listOf<Pair<String, Any>>(
            "truthStableFor" to 3.99, "truthFixTime" to 18.5, "truthFixTime" to 20.01,
            "speed" to 1.19, "accuracy" to 20.01, "bearingAccuracy" to 15.01,
            "follow" to false, "headingUp" to false, "phase" to "drive-plan")) {
            assertNull("Gate must ignore $key=$value", ReplayHeadingGate.violation(confirmed().put(key, value)))
        }
    }

    @Test fun cursorNorthWrapPassesButRealMisalignmentFails() {
        val frame = confirmed().put("mapBearing", 0.0).put("cursorBearing", 359.88167690086743)
        assertNull(ReplayHeadingGate.violation(frame))
        assertEquals("Heading-up cursor must point forward",
            checkNotNull(ReplayHeadingGate.violation(frame.put("cursorBearing", 1.5))).getString("reason"))
        assertNull(ReplayHeadingGate.violation(frame.put("follow", false)))
    }

    @Test fun drivingAndWalkingUseTheSameConfirmedMovementGate() {
        for (phase in listOf("drive-accuracy-5.0", "walking")) {
            assertNotNull(ReplayHeadingGate.violation(confirmed().put("phase", phase)))
        }
    }
}
