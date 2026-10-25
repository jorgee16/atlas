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
    @Test fun confirmedMotionContinuesAlongRouteBeyondNineSecondsInBlackout() {
        val longRoute=JSONObject()
            .put("distanceMeters",3000.0)
            .put("points",JSONArray("[[-8.0,40.0],[-8.0,40.027]]"))
        val moving=fix().copy(speed=15.0,accuracy=6.0,motionConfirmed=true)
        val prediction=RouteGapPrediction.predict(longRoute,guidance(),moving,130.0)
        assertNotNull("long GNSS blackout should retain route-based visual progress",prediction)
        assertTrue(prediction!!.optBoolean("gpsBlackoutPrediction"))
        assertEquals(470.0,prediction.getDouble("along"),0.01)
        assertNull("must never drift indefinitely after maximum blackout window",
            RouteGapPrediction.predict(longRoute,guidance(),moving,170.0))
        assertNull("stationary evidence cannot create tunnel movement",
            RouteGapPrediction.predict(longRoute,guidance(),
                moving.copy(motionConfirmed=false),130.0))
    }
    @Test fun weakAndStrongBlackoutsKeepTheirDistinctExistingBounds() {
        val longRoute=JSONObject().put("distanceMeters",3000.0)
            .put("points",JSONArray("[[-8.0,40.0],[-8.0,40.027]]"))
        val weak=fix().copy(speed=8.0,accuracy=20.0,motionConfirmed=true)
        val short=RouteGapPrediction.predict(longRoute,guidance(),weak,109.0)!!
        assertFalse(short.optBoolean("gpsBlackoutPrediction"))
        assertEquals(92.0,short.getDouble("along"),0.01)
        assertNull(RouteGapPrediction.predict(longRoute,guidance(),weak,114.0))
        val strong=weak.copy(accuracy=5.0)
        val extended=RouteGapPrediction.predict(longRoute,guidance(),strong,114.0)!!
        assertTrue(extended.optBoolean("gpsBlackoutPrediction"))
        assertEquals(132.0,extended.getDouble("along"),0.01)
        assertNull(RouteGapPrediction.predict(longRoute,guidance(),strong,161.0))
        val capped=RouteGapPrediction.predict(longRoute,guidance(),strong.copy(speed=30.0),160.0)!!
        assertEquals(1520.0,capped.getDouble("along"),0.01)
    }
}

