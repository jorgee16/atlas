package com.atlas.nativeapp

import android.Manifest
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.action.ViewActions.scrollTo
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.*
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TollChargesUiTest {
    @get:Rule val location:GrantPermissionRule=GrantPermissionRule.grant(
        Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION)
    @Test fun publishedA5PlazaPricesAreVisibleAndDoNotClaimAJourneyQuote() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            val field=AtlasModel::class.java.getDeclaredField("routingTariffCountry").apply { isAccessible=true }
            var previous:String?=null;var vehicle=1
            scenario.onActivity {
                val model=(it.application as AtlasApplication).model
                model.endNavigation();previous=field.get(model) as String?;vehicle=model.vehicleClass
                field.set(model,"Portugal");model.vehicleClass=1
            }
            try {
                onView(withContentDescription("Open menu")).perform(click())
                onView(withText("Settings")).perform(click())
                onView(withText("Published plaza tariffs")).perform(scrollTo(),click())
                onView(withText(org.hamcrest.Matchers.containsString("not a trip total"))).check(matches(isDisplayed()))
                onView(withText("A5 · Oeiras I")).perform(scrollTo()).check(matches(isDisplayed()))
                onView(withText("EUR 1,60")).check(matches(isDisplayed()))
                val automation=InstrumentationRegistry.getInstrumentation().uiAutomation
                automation.executeShellCommand("mkdir -p /sdcard/Download/atlas-ui-preview").use { fd ->
                    java.io.FileInputStream(fd.fileDescriptor).use { it.readBytes() }
                }
                automation.executeShellCommand("screencap -p /sdcard/Download/atlas-ui-preview/toll-charges-a5.png").use { fd ->
                    java.io.FileInputStream(fd.fileDescriptor).use { it.readBytes() }
                }
            } finally {
                scenario.onActivity {
                    val model=(it.application as AtlasApplication).model
                    field.set(model,previous);model.vehicleClass=vehicle
                }
            }
        }
    }
}
