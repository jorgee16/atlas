package com.atlas.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TransitParityTest {
    private val fixture by lazy { JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("native-transit.json").bufferedReader().use{it.readText()}) }
    private fun equalJson(expected:Any?,actual:Any?,path:String="root") {
        when(expected){
            is JSONObject->{assertTrue(path,actual is JSONObject);actual as JSONObject;for(key in expected.keys())equalJson(expected.get(key),actual.opt(key),"$path.$key")}
            is JSONArray->{assertTrue(path,actual is JSONArray);actual as JSONArray;assertEquals(path,expected.length(),actual.length());for(i in 0 until expected.length())equalJson(expected.get(i),actual.opt(i),"$path[$i]")}
            is Number->{assertTrue(path,actual is Number);assertEquals(path,expected.toDouble(),(actual as Number).toDouble(),.000001)}
            else->assertEquals(path,expected,actual)
        }
    }
    @Test fun rankingMatchesOriginalAcrossAllCandidates() {
        for((index,group) in fixture.getJSONArray("ranking").objects().withIndex()){
            val input=group.getJSONArray("input");val before=input.toString()
            equalJson(group.getJSONArray("expected"),JSONArray(TransitPolicy.rank(input.objects())),"ranking[$index]")
            assertEquals("Ranking must not mutate provider objects",before,input.toString())
        }
    }
    @Test fun normalizationRetainsOriginalOperationalFields() {
        val expected=fixture.getJSONObject("normalized")
        val actual=TransitProvider().normalize(fixture.getJSONObject("raw"),0)
        for(key in listOf("id","provider","durationMinutes","startTime","arrivalTime"))equalJson(expected.get(key),actual.get(key),key)
        val legs=expected.getJSONArray("legs");val steps=actual.getJSONArray("sequence")
        for(i in 0 until legs.length()){
            for(key in listOf("id","mode","line","fromName","toName","durationMinutes","departureStopId","arrivalStopId","intermediateStops","stopCount","departurePlatform","departureIndicator","departureStopLetter","boundDirection")){
                val value=legs.getJSONObject(i).opt(key)
                // Missing optional operational values are represented by empty strings in native views.
                if(value!=null&&value!=JSONObject.NULL)equalJson(value,steps.getJSONObject(i).opt(key),"leg[$i].$key")
            }
        }
        assertEquals(2,steps.getJSONObject(0).getJSONArray("points").length())
        assertEquals("walk",steps.getJSONObject(0).getString("kind"))
        assertEquals("transit",steps.getJSONObject(1).getString("kind"))
    }
    @Test fun executionMatchesOriginalIncludingInvalidActionsAndHistory() {
        val journey=fixture.getJSONArray("alternative").getJSONObject(0)
        var tick=10L;val execution=TransitExecution(journey){tick++}
        for(transition in fixture.getJSONArray("transitions").objects()){
            assertEquals(transition.getBoolean("accepted"),execution.transition(transition.getString("action")))
            val state=transition.getJSONObject("state")
            assertEquals(state.getInt("legIndex"),execution.legIndex)
            assertEquals(state.getString("phase"),execution.phase)
            equalJson(state.getJSONArray("history"),execution.history)
        }
    }
    @Test fun operationalPredictionPrioritizesDestinationOverTiming() {
        val step=JSONObject().put("direction","Elephant & Castle").put("toName","Oxford Circus").put("departureTime","2026-10-16T12:05:00Z")
        val wrong=JSONObject().put("destinationName","Waterloo").put("expectedArrival","2026-10-16T12:05:00Z").put("platformName","Southbound - Platform 2")
        val correct=JSONObject().put("destinationName","Elephant & Castle Underground Station").put("expectedArrival","2026-10-16T12:06:00Z").put("platformName","Southbound - Platform 4")
        val actual=TransitProvider().matchPrediction(step,listOf(wrong,correct))
        assertEquals("4",actual.getString("departurePlatform"))
        assertEquals("Southbound",actual.getString("boundDirection"))
        assertEquals("2026-10-16T12:06:00Z",actual.getString("expectedDepartureTime"))
        assertEquals("Elephant & Castle",actual.getString("direction"))
    }
}
