package com.atlas.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.channels.Channel
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NavigationFixPipelineTest {
    @Test fun conflatedChannelKeepsNewestFix() {
        val queue = Channel<Fix>(Channel.CONFLATED)
        val first = Fix(Coordinate(40.0, -8.0), 5.0, 3.0, null, 10.0)
        val second = first.copy(point = Coordinate(40.001, -8.0), time = 11.0)
        val newest = first.copy(point = Coordinate(40.002, -8.0), time = 12.0)
        assertTrue(queue.trySend(first).isSuccess)
        assertTrue(queue.trySend(second).isSuccess)
        assertTrue(queue.trySend(newest).isSuccess)
        assertEquals(newest, queue.tryReceive().getOrNull())
        assertNull(queue.tryReceive().getOrNull())
        queue.close()
    }

    @Test fun stoppedNavigationCannotHaveRouteProgress() {
        val original = AtlasState(navigating = true,
            guidance = org.json.JSONObject().put("state", "normal"),
            route = org.json.JSONObject().put("id", "route"),
            destination = org.json.JSONObject().put("id", "point"))
        val stopped = original.afterEndingNavigation()
        assertFalse(stopped.navigating)
        assertNull(stopped.guidance)
        assertNull(stopped.route)
        assertNull(stopped.destination)
    }

    @Test fun missingGpsSpeedIsRepresentedExplicitly() {
        val fix = Fix(Coordinate(40.0, -8.0), 9.0, -1.0, null, 10.0)
        assertEquals(-1.0, fix.speed, 0.0)
    }
}
