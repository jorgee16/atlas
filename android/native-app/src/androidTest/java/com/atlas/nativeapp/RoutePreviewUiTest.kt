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
import androidx.test.espresso.matcher.RootMatchers.withDecorView
import androidx.test.espresso.matcher.RootMatchers.isDialog
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

    @Test fun unverifiedAvoidanceNeverShowsACertifiedZero() = preview(false,false)

    private fun preview(dark:Boolean,verifiedFree:Boolean=true) {
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
                        // Presentation-only explicit evidence. A graph flag or
                        // this artificial fixture is never routing proof.
                        .put("tollFreeVerified",verifiedFree)
                    if(!verifiedFree)free.put("tollAmount",JSONObject.NULL).put("tollPricing","unavailable")
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
                // This presentation fixture is a separate Dialog window.
                // Waiting for the covered Activity root to regain focus can
                // deadlock Espresso even though the actual planner is visible.
                val plannerRoot=withDecorView(org.hamcrest.Matchers.`is`(dialog!!.window!!.decorView))
                val detailsRoot=org.hamcrest.Matchers.allOf(isDialog(),org.hamcrest.Matchers.not(plannerRoot))
                onView(withText(org.hamcrest.Matchers.startsWith("Recommended ·"))).inRoot(plannerRoot).check(matches(isDisplayed()))
                onView(withText(org.hamcrest.Matchers.startsWith("Alternative ·"))).inRoot(plannerRoot).check(matches(isDisplayed()))
                onView(withText(org.hamcrest.Matchers.startsWith(if(verifiedFree)"No tolls ·" else "Avoid tolls ·"))).inRoot(plannerRoot).check(matches(isDisplayed()))
                onView(withText("Start navigation")).inRoot(plannerRoot).check(matches(isDisplayed()))
                scenario.onActivity {
                    val labels=texts(card!!)
                    val values=labels.map { it.text.toString() }
                    labels.filter { listOf("Recommended ·","Alternative ·","No tolls ·","Avoid tolls ·").any { prefix -> it.text.toString().startsWith(prefix) } }.forEach { title ->
                        val layout=checkNotNull(title.layout)
                        assertEquals("Route title must remain on one line",1,layout.lineCount)
                        assertEquals("Route title clipped",title.text.length,layout.getLineEnd(0))
                        assertEquals("Route title ellipsized",0,layout.getEllipsisCount(0))
                    }
                    val prices=labels.filter { it.text.toString().startsWith("≈ ") }
                    assertEquals("Both useful estimates must be shown",2,prices.size)
                    assertTrue(values.any { it=="≈ € 5,80" })
                    assertTrue(values.any { it=="≈ € 6,20" })
                    assertEquals("Estimates must retain a visible qualifier",2,values.count { it=="estimated" })
                    assertFalse(values.any { it=="confirmed" })
                    if(verifiedFree)assertTrue(values.any { it=="€ 0,00" })
                    else {
                        assertTrue(values.any { it=="Price unavailable" })
                        assertFalse(values.any { it.contains("0,00") })
                    }
                    assertFalse(values.any { it.contains("Source:") || it.contains("confidence") ||
                        it.contains("BREAKDOWN") || it.contains("tariffs") })
                    // Wrapped prices must be complete and visible on a 320dp
                    // dialog, rather than forcing the route title off-screen.
                    prices.forEach { price ->
                        val layout=checkNotNull(price.layout)
                        assertEquals("Price text truncated",price.text.length,layout.getLineEnd(layout.lineCount-1))
                        for(line in 0 until layout.lineCount)assertEquals("Price ellipsized",0,layout.getEllipsisCount(line))
                        assertTrue("Price height clipped",price.height>=layout.height)
                    }
                }
                val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
                automation.executeShellCommand("mkdir -p /sdcard/Download/atlas-ui-preview").use {
                    java.io.FileInputStream(it.fileDescriptor).use { stream -> stream.readBytes() }
                }
                automation.executeShellCommand("screencap -p /sdcard/Download/atlas-ui-preview/route-options-${if(dark)"dark" else "light"}${if(verifiedFree)"" else "-unverified"}.png").use {
                    java.io.FileInputStream(it.fileDescriptor).use { stream -> stream.readBytes() }
                }
                onView(withText("Toll details")).inRoot(plannerRoot).perform(click())
                onView(withText(org.hamcrest.Matchers.containsString("Class 1"))).inRoot(detailsRoot)
                    .check(matches(isDisplayed()))
                onView(withText("Close")).inRoot(detailsRoot).perform(click())
                onView(withText(org.hamcrest.Matchers.startsWith("Alternative ·"))).inRoot(plannerRoot).check(matches(isDisplayed()))
            } finally {
                scenario.onActivity { activity ->
                    dialog?.dismiss();originalUi?.let { uiField.set(activity,it) }
                }
            }
        }
    }
}
