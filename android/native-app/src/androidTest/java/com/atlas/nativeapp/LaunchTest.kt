package com.atlas.nativeapp

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.isDisplayed
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.rule.GrantPermissionRule
import android.Manifest
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LaunchTest {
    @get:Rule val location: GrantPermissionRule = GrantPermissionRule.grant(
        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION
    )
    @Test fun jniMotionFilterRoundTrip() {
        NativeCore().use { core ->
            val first = core.filter(Fix(Coordinate(40.0, -8.0), 5.0, 3.0, 0.0, 1.0))
            org.junit.Assert.assertEquals(0.0, first.speed, 0.001)
            val second = core.filter(Fix(Coordinate(40.0001, -8.0), 5.0, 3.0, 0.0, 4.0))
            org.junit.Assert.assertEquals(3.0, second.speed, 0.001)
        }
    }
    @Test fun nativeAppStartsAndSurvivesRecreation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            onView(withText("Search")).check(matches(isDisplayed()))
            onView(withText("Explore")).check(matches(isDisplayed()))
            scenario.recreate()
            onView(withText("Search")).check(matches(isDisplayed()))
        }
    }
}
