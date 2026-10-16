package com.atlas.nativeapp

import android.Manifest
import android.content.Context
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.location.LocationManager
import android.os.SystemClock
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.isDisplayed
import androidx.test.espresso.matcher.ViewMatchers.withContentDescription
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class LaunchTest {
    @get:Rule val location: GrantPermissionRule = GrantPermissionRule.grant(
        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION
    )
    private fun capture(name: String) {
        SystemClock.sleep(800)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val output = File(instrumentation.targetContext.getExternalFilesDir(null), "ui-preview").apply { mkdirs() }
        val bitmap=instrumentation.uiAutomation.takeScreenshot()
        File(output, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }
        bitmap.recycle()
    }
    @Test fun jniMotionFilterRoundTrip() {
        NativeCore().use { core ->
            val first = core.filter(Fix(Coordinate(40.0, -8.0), 5.0, 3.0, 0.0, 1.0))
            org.junit.Assert.assertEquals(0.0, first.speed, 0.001)
            val second = core.filter(Fix(Coordinate(40.0001, -8.0), 5.0, 3.0, 0.0, 4.0))
            org.junit.Assert.assertEquals(3.0, second.speed, 0.001)
        }
    }
    @Test fun nativeScreensAndRecreation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            SystemClock.sleep(3500)
            onView(withContentDescription("Search places")).check(matches(isDisplayed()))
            capture("01-explore")
            scenario.recreate()
            onView(withContentDescription("Search places")).check(matches(isDisplayed()))
            onView(withContentDescription("Search places")).perform(click())
            onView(withText("Find a place")).check(matches(isDisplayed()))
            capture("02-search")
            onView(withContentDescription("Back")).perform(click())
            onView(withContentDescription("Trip tab")).perform(click())
            onView(withText("Every trip starts somewhere")).check(matches(isDisplayed()))
            capture("03-trips")
            onView(withContentDescription("Explore tab")).perform(click())
            onView(withContentDescription("Offline regions")).perform(click())
            onView(withText("AVAILABLE REGIONS")).check(matches(isDisplayed()))
            capture("04-regions")
            onView(withContentDescription("Back")).perform(click())
            onView(withContentDescription("Navigate tab")).perform(click())
            onView(withText("Where are you heading?")).check(matches(isDisplayed()))
            capture("05-navigation")
            scenario.onActivity { activity ->
                (activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(activity)
                val model=ViewModelProvider(activity)[AtlasModel::class.java]
                val field=AtlasModel::class.java.getDeclaredField("state").apply{isAccessible=true}
                @Suppress("UNCHECKED_CAST") val flow=field.get(model) as MutableStateFlow<AtlasState>
                val points=JSONArray("[[-9.1393,38.7223],[-9.137,38.725],[-9.134,38.727]]")
                val maneuvers=JSONArray().put(JSONObject().put("type","turn-right").put("instruction","Turn right onto Avenida da Liberdade").put("at",320).put("point",1))
                val route=JSONObject().put("points",points).put("maneuvers",maneuvers).put("distanceMeters",2400).put("durationSeconds",540).put("tollEuros",0)
                val destination=JSONObject().put("id","ui-fixture").put("name","Avenida da Liberdade").put("lat",38.727).put("lon",-9.134)
                flow.value=flow.value.copy(destination=destination,route=route,navigating=true,tab="Navigation",fix=null,
                    guidance=JSONObject().put("maneuver",0).put("toManeuver",320).put("remaining",2400).put("seconds",540).put("segment",0).put("lat",38.7223).put("lon",-9.1393).put("offRoute",0).put("state","normal"))
            }
            onView(withContentDescription("End navigation")).check(matches(isDisplayed()))
            capture("06-guidance")
            scenario.onActivity { it.requestedOrientation=ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
            SystemClock.sleep(1500)
            capture("07-landscape")
        }
    }
}
