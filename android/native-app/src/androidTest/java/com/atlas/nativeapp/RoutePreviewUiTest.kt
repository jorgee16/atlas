package com.atlas.nativeapp

import android.Manifest
import android.app.Dialog
import android.view.View
import android.view.ViewGroup
import android.widget.ScrollView
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Real Android planner widgets with explicit presentation fixtures, not routing evidence. */
@RunWith(AndroidJUnit4::class)
class RoutePreviewUiTest {
    @get:Rule val location:GrantPermissionRule=GrantPermissionRule.grant(
        Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION)

    private fun route(key:Int,paid:Boolean,seconds:Int,meters:Int,road:String,price:Double)=
        JSONObject().put("key",key).put("hasTolls",paid).put("durationSeconds",seconds)
            .put("distanceMeters",meters).put("mainRoads",JSONArray().put(road))
            .put("tollCurrency","EUR").put("tollAmount",price)
            .put("tollPricing",if(paid)"estimate" else "none")
            .put("tollTariffSource","IMT fixture source").put("tollTariffYear",2026)

    private fun texts(view:View):List<TextView> = when(view) {
        is TextView -> listOf(view)
        is ViewGroup -> (0 until view.childCount).flatMap { texts(view.getChildAt(it)) }
        else -> emptyList()
    }

    @Test fun lightPreviewShowsTwoPaidAndOneFreeWithoutTariffJargon() = preview(false)
    @Test fun darkPreviewShowsTwoPaidAndOneFreeWithoutTariffJargon() = preview(true)

    private fun preview(dark:Boolean) {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            var dialog:Dialog?=null
            var card:View?=null
            var originalUi:AtlasUi?=null
            val uiField=MainActivity::class.java.getDeclaredField("ui").apply { isAccessible=true }
            try {
                scenario.onActivity { activity ->
                    originalUi=uiField.get(activity) as AtlasUi
                    val ui=AtlasUi(activity,dark);uiField.set(activity,ui)
                    MainActivity::class.java.getDeclaredField("previewCollapsed").apply {
                        isAccessible=true;setBoolean(activity,false)
                    }
                    val paid=route(0,true,2520,64400,"A8",5.80)
                    val alternate=route(1,true,2820,68000,"A1",6.20)
                    val free=route(2,false,5280,73700,"EN8",0.0)
                    val state=AtlasState(destination=JSONObject().put("name","IKEA Loures"),
                        route=paid,routeOptions=listOf(paid,alternate,free),tab="Navigate")
                    val planner=MainActivity::class.java.getDeclaredMethod("planner",AtlasState::class.java)
                        .apply { isAccessible=true }.invoke(activity,state) as View
                    card=planner
                    dialog=Dialog(activity).apply {
                        setContentView(ScrollView(activity).apply { addView(planner) })
                        show()
                        window!!.setLayout(ui.dp(320),ViewGroup.LayoutParams.WRAP_CONTENT)
                    }
                }
                onView(withText("Recommended")).check(matches(isDisplayed()))
                onView(withText("Alternative")).check(matches(isDisplayed()))
                onView(withText("No tolls")).check(matches(isDisplayed()))
                onView(withText("Start navigation")).check(matches(isDisplayed()))
                scenario.onActivity {
                    val labels=texts(card!!)
                    val values=labels.map { it.text.toString() }
                    assertEquals(2,values.count { it=="Toll price not confirmed" })
                    assertFalse(values.any { it.contains("estimated") || it.contains("5,80") || it.contains("6,20") })
                    assertTrue(values.any { it.startsWith("No tolls · ") })
                    assertFalse(values.any { it.contains("Source:") || it.contains("confidence") ||
                        it.contains("BREAKDOWN") || it.contains("tariffs") })
                    // Prices must retain enough horizontal space on a narrow phone.
                    labels.filter { it.text.toString()=="Toll price not confirmed" }.forEach { price ->
                        assertTrue("Price clipped: ${price.text}",price.width >= price.paint.measureText(price.text.toString()))
                    }
                }
                val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
                automation.executeShellCommand("mkdir -p /sdcard/Download/atlas-ui-preview").use {
                    java.io.FileInputStream(it.fileDescriptor).use { stream -> stream.readBytes() }
                }
                automation.executeShellCommand("screencap -p /sdcard/Download/atlas-ui-preview/route-options-${if(dark)"dark" else "light"}.png").use {
                    java.io.FileInputStream(it.fileDescriptor).use { stream -> stream.readBytes() }
                }
                onView(withText("Toll details")).perform(click())
                onView(withText(org.hamcrest.Matchers.containsString("Class 1")))
                    .check(matches(isDisplayed()))
                onView(withText("Close")).perform(click())
                onView(withText("Alternative")).check(matches(isDisplayed()))
            } finally {
                scenario.onActivity { activity ->
                    dialog?.dismiss();originalUi?.let { uiField.set(activity,it) }
                }
            }
        }
    }
}
