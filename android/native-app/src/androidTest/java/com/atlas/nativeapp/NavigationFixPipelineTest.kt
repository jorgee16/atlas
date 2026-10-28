package com.atlas.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.EmptyCoroutineContext
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NavigationFixPipelineTest {
    @Test fun fixAlreadyWaitingBehindRoutingIsReplacedBeforeJniFiltering() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val application=ApplicationProvider.getApplicationContext<android.app.Application>()
        lateinit var model:AtlasModel
        instrumentation.runOnMainSync { model=AtlasModel(application) }
        val dispatcher=AtlasModel::class.java.getDeclaredField("worker").apply {
            isAccessible=true
        }.get(model) as CoroutineDispatcher
        val blocked=CountDownLatch(1)
        val resume=CountDownLatch(1)
        val received=CountDownLatch(1)
        val firstPublished=AtomicReference<Fix>()
        val scope=CoroutineScope(Dispatchers.Main)
        try {
            scope.launch {
                model.updates.collect { state ->
                    state.fix?.let { fix ->
                        if(firstPublished.compareAndSet(null,fix)) received.countDown()
                    }
                }
            }
            dispatcher.dispatch(EmptyCoroutineContext,Runnable {
                blocked.countDown()
                check(resume.await(5,TimeUnit.SECONDS)) { "Test worker was not released" }
            })
            assertTrue(blocked.await(5,TimeUnit.SECONDS))
            val first=Fix(Coordinate(38.7223,-9.1393),5.0,3.0,90.0,100.0)
            val newest=first.copy(point=Coordinate(38.7223,-9.1392),time=102.0)
            instrumentation.runOnMainSync { model.fix(first) }
            // The main-thread pump has taken the first item and is now
            // suspended waiting for the occupied native worker.
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync {
                model.fix(first.copy(time=101.0))
                model.fix(newest)
                model.fix(first.copy(time=100.5)) // out-of-order delivery
            }
            instrumentation.waitForIdleSync()
            resume.countDown()
            assertTrue("Latest GPS fix was not published",received.await(5,TimeUnit.SECONDS))
            assertEquals("Must not replay the fix taken before routing completed",
                newest.time,firstPublished.get().time,0.0)
            assertEquals(newest.point,firstPublished.get().point)
            assertEquals(5.0,firstPublished.get().accuracy,0.0)
        } finally {
            resume.countDown();scope.cancel()
            instrumentation.runOnMainSync {
                AtlasModel::class.java.getDeclaredMethod("onCleared").apply {
                    isAccessible=true
                }.invoke(model)
            }
        }
    }

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
