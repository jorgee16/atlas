package com.atlas.nativeapp

import android.content.Context
import android.location.LocationManager
import android.os.SystemClock
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Capture the REAL native Android guidance banner, not an illustrated mockup.
 * These are controlled UI examples: route/maneuver data is injected and the
 * map backdrop is NOT evidence of a real road route or correct lane assignment.
 */
@RunWith(AndroidJUnit4::class)
class GuidanceVisualExamplesTest {
    private fun screenshot(name: String) {
        SystemClock.sleep(1000L)
        val auto=InstrumentationRegistry.getInstrumentation().uiAutomation
        auto.executeShellCommand("mkdir -p /sdcard/Download/atlas-ui-preview").use {
            java.io.FileInputStream(it.fileDescriptor).use { input -> input.readBytes() }
        }
        auto.executeShellCommand("screencap -p /sdcard/Download/atlas-ui-preview/$name.png").use {
            java.io.FileInputStream(it.fileDescriptor).use { input -> input.readBytes() }
        }
    }

    private fun captureGuidanceExample(name:String, type:String, instruction:String,
                                        turnLanes:String, distance:Double) {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                (activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager)
                    .removeUpdates(activity)
                val model=(activity.application as AtlasApplication).model
                model.stop()
                val stateField=AtlasModel::class.java.getDeclaredField("state")
                    .apply { isAccessible=true }
                @Suppress("UNCHECKED_CAST")
                val state=stateField.get(model) as MutableStateFlow<AtlasState>
                val points=JSONArray("[[-9.1420,38.7190],[-9.1380,38.7223],[-9.1360,38.7260]]")
                val maneuver=JSONObject().put("type",type)
                    .put("instruction",instruction)
                    .put("turnLanes",turnLanes)
                    .put("at",350).put("point",1)
                val route=JSONObject().put("points",points)
                    .put("maneuvers",JSONArray().put(maneuver))
                    .put("distanceMeters",1600.0)
                    .put("durationSeconds",270.0)
                    .put("tollEuros",0.0)
                val destination=JSONObject()
                    .put("id","ui-example")
                    .put("name","Lisbon UI example")
                    .put("lat",38.726).put("lon",-9.136)
                state.value=state.value.copy(destination=destination,route=route,
                    navigating=true,tab="Navigation",fix=null,
                    guidance=JSONObject().put("maneuver",0)
                        .put("toManeuver",distance)
                        .put("remaining",1600.0)
                        .put("seconds",270.0)
                        .put("segment",0)
                        .put("lat",38.7223).put("lon",-9.1393)
                        .put("offRoute",0).put("state","normal"))
            }
            screenshot(name)
            scenario.onActivity {
                (it.application as AtlasApplication).model.endNavigation()
            }
        }
    }

    @Test fun roundaboutThirdExitNativeBannerScreenshot() {
        captureGuidanceExample("09-roundabout-third-exit", "roundabout",
            "At the roundabout, take the 3rd exit onto N8", "", 180.0)
    }

    @Test fun fourLaneNativeBannerScreenshot() {
        captureGuidanceExample("10-four-lane-road", "turn-right",
            "Turn right onto Avenida da Liberdade", "left|through|through|right", 240.0)
    }
}
