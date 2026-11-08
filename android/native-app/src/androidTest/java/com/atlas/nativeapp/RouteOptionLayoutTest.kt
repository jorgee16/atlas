package com.atlas.nativeapp

import android.Manifest
import android.app.Dialog
import android.content.res.Configuration
import android.graphics.Rect
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Real Android layout checks; presentation fixtures are not proof of route pricing. */
@RunWith(AndroidJUnit4::class)
class RouteOptionLayoutTest {
    @get:Rule val location: GrantPermissionRule = GrantPermissionRule.grant(
        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

    private fun texts(view: View): List<TextView> = when(view) {
        is TextView -> listOf(view)
        is ViewGroup -> (0 until view.childCount).flatMap { texts(view.getChildAt(it)) }
        else -> emptyList()
    }

    @Test fun narrowLargeFontCardsKeepTimeAndFinancialStatusVisibleAndSelectable() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            for (dark in listOf(false,true)) for (font in listOf(1.0f,1.5f)) for (pricing in listOf("exact","estimate","unavailable")) {
                val known=pricing!="unavailable"
                var dialog: Dialog? = null
                lateinit var option: RouteOptionView
                val route = JSONObject().put("durationSeconds",4980).put("distanceMeters",95000)
                    .put("hasTolls",true).put("mainRoads",JSONArray().put("A16").put("A9"))
                    .put("tollCurrency","EUR").put("tollPricing",pricing)
                    .put("tollAmount",if(known)12.35 else JSONObject.NULL)
                val original = route.toString()
                var clicks = 0
                try {
                    scenario.onActivity { activity ->
                        val config = Configuration(activity.resources.configuration).apply { fontScale=font }
                        val ui = AtlasUi(activity.createConfigurationContext(config),dark)
                        option = RouteOptionView(ui,route,"Alternative",true) { clicks++ }
                        dialog = Dialog(activity).apply {
                            setContentView(option)
                            show()
                            window!!.setLayout(ui.dp(288),ViewGroup.LayoutParams.WRAP_CONTENT)
                        }
                    }
                    instrumentation.waitForIdleSync()
                    scenario.onActivity {
                        val labels=texts(option)
                        assertTrue(labels.any { it.text.toString()==when(pricing) { "exact" -> "confirmed"; "estimate" -> "estimated"; else -> "Price unavailable" } })
                        if(!known)assertFalse(labels.any { it.text.toString().contains("0,00") })
                        labels.forEach { label ->
                            val layout=checkNotNull(label.layout)
                            assertEquals("Text clipped: ${label.text}",label.text.length,layout.getLineEnd(layout.lineCount-1))
                            for(line in 0 until layout.lineCount)assertEquals(0,layout.getEllipsisCount(line))
                            assertTrue("Text height clipped: ${label.text}, view=${label.width}x${label.height}, layout=${layout.width}x${layout.height}, font=$font, pricing=$pricing",label.height>=layout.height)
                            val visible=Rect()
                            assertTrue("Label outside dialog: ${label.text}",label.getGlobalVisibleRect(visible))
                            assertEquals("Label partially hidden",label.height,visible.height())
                        }
                        val bounds=labels.map { label -> Rect().also { label.getGlobalVisibleRect(it) } }
                        for(a in bounds.indices)for(b in a+1 until bounds.size)
                            assertFalse("Route labels overlap",Rect.intersects(bounds[a],bounds[b]))
                        assertTrue(option.isSelected)
                        assertTrue(option.performClick())
                        assertEquals(1,clicks)
                        assertEquals("Selecting a card must preserve its authoritative route",original,route.toString())
                    }
                    val automation=instrumentation.uiAutomation
                    automation.executeShellCommand("mkdir -p /sdcard/Download/atlas-ui-preview").use {
                        java.io.FileInputStream(it.fileDescriptor).use { input -> input.readBytes() }
                    }
                    automation.executeShellCommand("screencap -p /sdcard/Download/atlas-ui-preview/route-option-${font}-${if(dark)"dark" else "light"}-$pricing.png").use {
                        java.io.FileInputStream(it.fileDescriptor).use { input -> input.readBytes() }
                    }
                } finally {
                    scenario.onActivity { dialog?.dismiss() }
                }
            }
        }
    }
}
