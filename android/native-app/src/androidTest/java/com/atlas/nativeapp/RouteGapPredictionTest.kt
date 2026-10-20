package com.atlas.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RouteGapPredictionTest {
    private fun route() = JSONObject()
        .put("distanceMeters", 200.0)
        .put("points", JSONArray("[[-8.0,40.0],[-8.0,40.0018]]"))
    private fun guidance() = JSONObject()
        .put("state", "normal").put("along", 20.0).put("remaining", 180.0)
        .put("seconds", 30.0).put("toManeuver", 90.0).put("offRoute", 0.0)
        .put("gpsFixTime",100.0)
    private fun fix() = Fix(Coordinate(40.0, -8.0), 5.0, 10.0, 0.0, 100.0)

    @Test fun predictsOnlyDuringShortSignalLoss() {
        assertNull(RouteGapPrediction.predict(route(), guidance(), fix(), 101.0))
        val predicted = RouteGapPrediction.predict(route(), guidance(), fix(), 105.0)
        assertNotNull(predicted)
        assertEquals("reduced", predicted!!.getString("state"))
        assertTrue(predicted.getDouble("along") > 20.0)
        assertTrue(predicted.getDouble("along") < 200.0)
        assertNull(RouteGapPrediction.predict(route(), guidance(), fix(), 110.0))
    }

    @Test fun willNotPredictOnUnconfirmedDeviation() {
        val uncertain = guidance().put("state", "checking")
        assertNull(RouteGapPrediction.predict(route(), uncertain, fix(), 105.0))
    }

    @Test fun doesNotAccumulateSpeedBetweenTicks() {
        val original = guidance()
        val first = RouteGapPrediction.predict(route(), original, fix(), 104.0)!!
        val second = RouteGapPrediction.predict(route(), first, fix(), 105.0)!!
        assertEquals(70.0, second.getDouble("along"), 0.01)
    }

    @Test fun refusesToPredictArrival() {
        val nearEnd = guidance().put("along", 180.0)
        assertNull(RouteGapPrediction.predict(route(), nearEnd, fix(), 105.0))
    }
    @Test fun newGpsCannotReuseAnOlderJniProjection() {
        assertNull(RouteGapPrediction.predict(route(),guidance(),fix().copy(time=101.0),105.0))
        val missingTimestamp=guidance().apply { remove("gpsFixTime") }
        assertNull(RouteGapPrediction.predict(route(),missingTimestamp,fix(),105.0))
    }
}

