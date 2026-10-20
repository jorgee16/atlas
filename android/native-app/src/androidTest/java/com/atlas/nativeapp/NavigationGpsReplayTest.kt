package com.atlas.nativeapp

import android.Manifest
import android.content.Context
import android.location.Criteria
import android.location.Location
import android.location.LocationManager
import android.os.SystemClock
import android.util.Log
import android.view.InputDevice
import android.view.MotionEvent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
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
import java.io.File
import java.util.Collections
import kotlin.math.*

/** Real Portugal graph -> C++ routing -> Android Location -> Service -> JNI -> MapLibre/UI.
 * No StateFlow replacement and no injected guidance/route. Only GPS is mocked.
 */
@RunWith(AndroidJUnit4::class)
class NavigationGpsReplayTest {
    @get:Rule val permissions = GrantPermissionRule.grant(
        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val locations get()=context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    private val evidenceDirectory get()=InstrumentationRegistry.getArguments().getString("evidenceDirectory","atlas-gps-replay")!!
    private val output get()=File(context.getExternalFilesDir(null),"gps-replay").apply { mkdirs() }
    private val frames=Collections.synchronizedList(mutableListOf<String>())
    private val fixes=mutableListOf<String>()
    private val events=mutableListOf<String>()
    private var stateObserver:Job?=null
    private var model: AtlasModel?=null
    private var phase="setup"
    private var lastLogged=0.0
    private data class Truth(val heading:Double,val stableSince:Double,val fixTime:Double)
    @Volatile private var latestTruth:Truth?=null

    private fun map(activity: MainActivity): AtlasMap {
        val field=MainActivity::class.java.getDeclaredField("atlasMap").apply{isAccessible=true}
        return field.get(activity) as AtlasMap
    }
    private fun attach(s: ActivityScenario<MainActivity>) {
        s.onActivity { a ->
            model=(a.application as AtlasApplication).model
            stateObserver?.cancel()
            stateObserver=a.lifecycleScope.launch {
                model!!.updates.collect { state ->
                    if(state.navigating && state.busy) {
                        val before=state.fix?.time
                        map(a).recenter()
                        val evidence=map(a).debugSnapshot().put("event","recenter-during-reroute")
                        assertTrue(evidence.getBoolean("follow"))
                        assertEquals(before,model!!.updates.value.fix?.time)
                        events.add(evidence.toString())
                    }
                }
            }
            map(a).onDebugFrame={ frame ->
                frame.put("phase",phase)
                val now=frame.getDouble("time")
                latestTruth?.let {
                    frame.put("truthHeading",it.heading).put("truthFixTime",it.fixTime)
                        .put("truthStableFor",now-it.stableSince)
                }
                frames.add(frame.toString())
                if(now-lastLogged>=1.0) { Log.i("ATLAS_GPS_REPLAY",frame.toString());lastLogged=now }
            }
        }
    }
    private fun snapshot(s: ActivityScenario<MainActivity>): JSONObject {
        var result=JSONObject()
        s.onActivity { result=map(it).debugSnapshot() }
        return result
    }
    private fun await(message:String, seconds:Int=30, condition:()->Boolean) {
        val until=SystemClock.elapsedRealtime()+seconds*1000
        while(SystemClock.elapsedRealtime()<until) {
            if(condition())return
            SystemClock.sleep(100)
        }
        fail("$message; state=${model?.updates?.value?.status}")
    }
    private fun fix(point:Coordinate,speed:Double,heading:Double,accuracy:Double=5.0,bearingAccuracy:Double=5.0,truthHeading:Double=heading):Double {
        val l=Location(LocationManager.GPS_PROVIDER).apply {
            latitude=point.lat; longitude=point.lon; this.accuracy=accuracy.toFloat()
            this.speed=speed.toFloat(); bearing=heading.toFloat()
            bearingAccuracyDegrees=bearingAccuracy.toFloat()
            time=System.currentTimeMillis(); elapsedRealtimeNanos=SystemClock.elapsedRealtimeNanos()
            altitude=0.0
        }
        val previous=latestTruth
        val fixTime=l.elapsedRealtimeNanos/1e9
        latestTruth=Truth(truthHeading,
            if(previous==null || AtlasHeading.angleDifference(previous.heading,truthHeading)>45.0)
                fixTime else previous.stableSince,fixTime)
        locations.setTestProviderLocation(LocationManager.GPS_PROVIDER,l)
        fixes.add(JSONObject().put("time",l.elapsedRealtimeNanos/1e9).put("lat",point.lat)
            .put("lon",point.lon).put("speed",speed).put("accuracy",accuracy)
            .put("heading",heading).put("truthHeading",truthHeading).put("bearingAccuracy",bearingAccuracy).put("phase",phase).toString())
        return fixTime
    }
    private fun confirmedStartFix(point:Coordinate,guidance:Boolean=false) {
        // Android can drop the first mock fix during Activity/Service handoff.
        // Confirm delivery and JNI pairing rather than sleeping and sampling
        // a baseline that still belongs to the previous position/travel mode.
        repeat(6) {
            val sent=fix(point,0.0,0.0)
            val until=SystemClock.elapsedRealtime()+2200
            while(SystemClock.elapsedRealtime()<until) {
                val state=model!!.updates.value
                val actual=state.fix
                if(actual!=null && actual.time>=sent && distance(actual.point,point)<.2 &&
                    (!guidance || state.guidance?.optDouble("gpsFixTime",-1.0)==actual.time))return
                SystemClock.sleep(100)
            }
        }
        fail("Android GPS/JNI did not acknowledge the route-start fix")
    }
    private fun distance(a:Coordinate,b:Coordinate)=hypot((a.lat-b.lat)*111320.0,
        (a.lon-b.lon)*111320.0*cos(Math.toRadians((a.lat+b.lat)/2)))
    private fun bearing(a:Coordinate,b:Coordinate)=AtlasHeading.normalize(Math.toDegrees(atan2(
        (b.lon-a.lon)*cos(Math.toRadians((a.lat+b.lat)/2)),b.lat-a.lat)))
    private fun points(route:JSONObject):List<Coordinate> {
        val p=route.getJSONArray("points")
        return (0 until p.length()).map { i -> val a=p.getJSONArray(i);Coordinate(a.getDouble(1),a.getDouble(0)) }
    }
    private fun at(p:List<Coordinate>,meters:Double):Coordinate {
        var left=meters
        for(i in 1 until p.size) {
            val len=distance(p[i-1],p[i])
            if(left<=len) { val f=if(len>0)left/len else 0.0
                return Coordinate(p[i-1].lat+(p[i].lat-p[i-1].lat)*f,p[i-1].lon+(p[i].lon-p[i-1].lon)*f) }
            left-=len
        }
        return p.last()
    }
    private fun capture(s: ActivityScenario<MainActivity>,name:String) {
        // Assertions execute before capture. Give Android/MapLibre a frame to
        // present a just-installed style before collecting visual evidence.
        if(name.startsWith("camera-"))SystemClock.sleep(750)
        // Camera commands are synchronous, but their View/Surface composition is
        // presented on subsequent frames. Observe real drawing frames before
        // sampling the cursor pixel; no additional GPS fix is required.
        val presented=java.util.concurrent.CountDownLatch(1)
        s.onActivity { a ->
            val view=a.window.decorView
            view.postOnAnimation {
                view.postOnAnimation {
                    view.postOnAnimation { presented.countDown() }
                }
            }
        }
        assertTrue("Android must present camera frames before capture: $name",
            presented.await(5,java.util.concurrent.TimeUnit.SECONDS))
        instrumentation.waitForIdleSync()
        var cursor:android.graphics.PointF?=null
        s.onActivity { cursor=map(it).debugCursorScreenCenter() }
        val screenshot=instrumentation.uiAutomation.takeScreenshot()
        // Retain the exact failing frame and state when a visual assertion fails.
        File(output,"$name.png").outputStream().use {
            assertTrue(screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it))
        }
        File(output,"$name.json").writeText(snapshot(s).toString(2))
        if(name in listOf("drive-recenter","walking-compass-recenter")) {
            val c=checkNotNull(cursor) { "Rendered cursor must be visible" }
            val x=c.x.toInt().coerceIn(0,screenshot.width-1)
            val y=c.y.toInt().coerceIn(0,screenshot.height-1)
            val color=screenshot.getPixel(x,y)
            assertTrue("Cursor must contain its blue arrow in the actual screenshot: $name ($x,$y)=$color",
                android.graphics.Color.blue(color)>180 && android.graphics.Color.red(color)<120 &&
                    android.graphics.Color.green(color)<170)
        }
        if(name=="manual-zoom")s.onActivity { a ->
            map(a).debugCursorBitmap()?.let { bitmap ->
                File(output,"cursor-bitmap.png").outputStream().use {
                    bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)
                }
            }
        }
    }
    private fun pan(s:ActivityScenario<MainActivity>) {
        val before=snapshot(s)
        capture(s,"pan-before")
        var x=0f;var y=0f;var width=0f
        s.onActivity { width=it.window.decorView.width.toFloat();x=width*.30f;y=it.window.decorView.height*.45f }
        val down=SystemClock.uptimeMillis()
        for(i in 0..12) {
            val action=when(i){0->MotionEvent.ACTION_DOWN;12->MotionEvent.ACTION_UP;else->MotionEvent.ACTION_MOVE}
            val e=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,x+i*width*.025f,y,0)
            e.source=InputDevice.SOURCE_TOUCHSCREEN
            assertTrue("Android must accept pan event $action",instrumentation.uiAutomation.injectInputEvent(e,false));e.recycle();SystemClock.sleep(16)
        }
        SystemClock.sleep(400)
        capture(s,"pan-after")
        await("gesture must disable follow",5){!snapshot(s).optBoolean("follow",true)}
        val after=snapshot(s)
        assertTrue("pan must actually move the MapLibre camera",distance(
            Coordinate(before.getDouble("cameraLat"),before.getDouble("cameraLon")),
            Coordinate(after.getDouble("cameraLat"),after.getDouble("cameraLon")))>2.0)
    }
    private fun manualZoom(s:ActivityScenario<MainActivity>) {
        val before=snapshot(s).getDouble("mapZoom")
        var x=0f;var y=0f;var width=0f
        s.onActivity { width=it.window.decorView.width.toFloat();x=width*.5f;y=it.window.decorView.height*.45f }
        capture(s,"zoom-before")
        val down=SystemClock.uptimeMillis()
        fun send(action:Int,span:Float,count:Int=2) {
            val properties=Array(count) { i -> MotionEvent.PointerProperties().apply {
                id=i;toolType=MotionEvent.TOOL_TYPE_FINGER
            } }
            val coordinates=Array(count) { i -> MotionEvent.PointerCoords().apply {
                this.x=x+(if(i==0)-span else span);this.y=y;pressure=1f;size=1f
            } }
            val event=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,count,
                properties,coordinates,0,0,1f,1f,0,0,InputDevice.SOURCE_TOUCHSCREEN,0)
            assertTrue("Android must accept pinch event $action",instrumentation.uiAutomation.injectInputEvent(event,false));event.recycle()
            SystemClock.sleep(16)
        }
        send(MotionEvent.ACTION_DOWN,width*.28f,1)
        send(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),width*.28f)
        // MapLibre rejects scales below 0.6dp/ms. Synchronous injection
        // plus slow sleeps made the old synthetic pinch fall below that gate.
        for(i in 1..8)send(MotionEvent.ACTION_MOVE,width*(.28f-.20f*i/8))
        send(MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),width*.08f)
        send(MotionEvent.ACTION_UP,width*.08f,1)
        SystemClock.sleep(500)
        capture(s,"manual-zoom")
        val after=snapshot(s).getDouble("mapZoom")
        assertTrue("manual pinch must actually zoom MapLibre: $before -> $after",after<before-.2)
        assertFalse("manual zoom must not restore follow",snapshot(s).getBoolean("follow"))
    }
    private fun recenter(s:ActivityScenario<MainActivity>,name:String) {
        val previousFix=model!!.updates.value.fix!!.time
        s.onActivity { a ->
            fun find(v:android.view.View):android.view.View? {
                if(v.contentDescription=="Recenter on my location")return v
                if(v is android.view.ViewGroup) for(i in 0 until v.childCount) {
                    val child=find(v.getChildAt(i));if(child!=null)return child
                }
                return null
            }
            val control=find(a.window.decorView)
            assertNotNull("Recenter control must remain available",control)
            assertTrue(control!!.performClick())
        }
        val d=snapshot(s)
        assertTrue("recenter must restore follow immediately",d.getBoolean("follow"))
        assertEquals("recenter cannot require a new fix",previousFix,model!!.updates.value.fix!!.time,1e-6)
        val center=Coordinate(d.getDouble("cameraLat"),d.getDouble("cameraLon"))
        val cursor=Coordinate(d.getDouble("renderLat"),d.getDouble("renderLon"))
        assertTrue("recenter must use rendered position: $d",distance(center,cursor)<5.0)
        capture(s,name)
    }
    private fun plan(s: ActivityScenario<MainActivity>,from:Coordinate,to:Coordinate,walking:Boolean):JSONObject {
        phase=if(walking)"walk-plan" else "drive-plan"
        s.onActivity { model!!.endNavigation();model!!.voice=false;model!!.mode(if(walking)"walk" else "drive") }
        confirmedStartFix(from)
        s.onActivity {
            model!!.select(JSONObject().put("id","replay-destination").put("name","GPS replay destination")
                .put("lat",to.lat).put("lon",to.lon))
            model!!.calculate(true)
        }
        await("native Portugal route must calculate",90){model!!.updates.value.navigating&&!model!!.updates.value.busy}
        val route=model!!.updates.value.route!!
        assertTrue("route must contain native graph edges",route.getJSONArray("edgeIndexes").length()>0)
        File(output,if(walking)"walk-route.json" else "drive-route.json").writeText(route.toString(2))
        confirmedStartFix(points(route).first(),true)
        await("MapLibre must finish loading",45){!snapshot(s).optBoolean("styleLoading",true)}
        // Changing the simulated start is a setup relocation, not stationary
        // jitter. Wait for its bounded visual correction before taking a new
        // stationary baseline; do not relax the later one-metre assertion.
        await("route-start fix must be presented before replay",25) {
            val f=snapshot(s)
            f.has("renderLat") && distance(Coordinate(f.getDouble("renderLat"),f.getDouble("renderLon")),points(route).first())<.05
        }
        s.onActivity { map(it).recenter() }
        return route
    }
    private fun replay(s:ActivityScenario<MainActivity>,route:JSONObject,speed:Double,tests:Boolean,allowArrival:Boolean=true,startAlong:Double=0.0) {
        val p=points(route)
        val length=(1 until p.size).sumOf { distance(p[it-1],p[it]) }
        var along=startAlong;var tick=0;var checkingRecentered=false
        while(along<length && tick<360 && model!!.updates.value.navigating) {
            val truth=at(p,along)
            var heading=bearing(truth,at(p,(along+3).coerceAtMost(length)))
            val accuracy=if(tests) listOf(5.0,20.0,35.0,60.0,100.0)[(tick/8)%5] else 5.0
            val trueHeading=heading
            val bad=tests && tick in 12..13
            if(bad)heading=AtlasHeading.normalize(heading+180)
            phase=if(tests)"drive-accuracy-$accuracy" else if(speed<3)"walking" else "reroute-replay"
            // Deterministic horizontal noise, recorded alongside the exact truth.
            val jitter=if(tests)sin(tick*1.7)*min(accuracy*.12,5.0) else 0.0
            val measured=Coordinate(truth.lat+jitter/111320.0,truth.lon)
            fix(measured,speed,heading,accuracy,if(bad)5.0 else if(accuracy>=60)60.0 else 8.0,truthHeading=trueHeading)
            SystemClock.sleep(1020)
            if(bad) assertTrue("two inverted GNSS fixes must not reverse the camera",
                AtlasHeading.angleDifference(trueHeading,snapshot(s).getDouble("mapBearing"))<100.0)
            if(!tests && !checkingRecentered && model!!.updates.value.guidance?.optString("state")=="checking") {
                phase="checking-recenter";recenter(s,"checking-recenter");checkingRecentered=true
            }
            if(tests && tick==5) { pan(s);recenter(s,"pan-recenter");manualZoom(s);SystemClock.sleep(400)
                assertFalse(snapshot(s).getBoolean("follow"));recenter(s,"drive-recenter") }
            if(tests && tick==10) { s.onActivity { map(it).compass() };SystemClock.sleep(600)
                assertTrue(AtlasHeading.angleDifference(0.0,snapshot(s).getDouble("mapBearing"))<1.0)
                recenter(s,"north-up-recenter");s.onActivity { map(it).compass() } }
            if(tests && tick in listOf(18,42,55)) {
                val gap=when(tick){18->2;42->5;else->9}
                phase="gps-gap-$gap";capture(s,"gap-$gap-start")
                SystemClock.sleep(gap*1000L)
                recenter(s,"gap-$gap-recenter")
                along+=speed*gap
            }
            if(tests && tick==25) {
                phase="background";s.moveToState(Lifecycle.State.CREATED)
                val t=model!!.updates.value.fix!!.time
                fix(at(p,along+speed),speed,heading);SystemClock.sleep(1200)
                assertTrue("NavigationService must accept background GPS",model!!.updates.value.fix!!.time>t)
                assertNotNull("service must preserve bearing accuracy",model!!.updates.value.fix!!.bearingAccuracy)
                s.moveToState(Lifecycle.State.RESUMED);attach(s);capture(s,"background-return")
            }
            if(tests && tick==30) {
                s.onActivity { map(it).compass() };SystemClock.sleep(500)
                pan(s);s.recreate();attach(s)
                await("recreated MapLibre must load",45){!snapshot(s).optBoolean("styleLoading",true)}
                assertFalse("pan must survive Activity recreation",snapshot(s).getBoolean("follow"))
                assertFalse("north-up must survive Activity recreation",snapshot(s).getBoolean("headingUp"))
                recenter(s,"recreated-recenter");s.onActivity { map(it).compass() }
            }
            if(tick%15==0)capture(s,"${if(tests)"drive" else if(speed<3)"walk" else "deviation"}-$tick")
            along+=speed;tick++
        }
        assertTrue("replay must traverse the whole calculated route",along>=length || model!!.updates.value.arrived)
        if(allowArrival) {
            repeat(7){fix(p.last(),0.0,0.0);SystemClock.sleep(1050)}
            await("native guidance must confirm arrival",15){model!!.updates.value.arrived}
        }
    }
    private fun verifyStationaryWalker(s:ActivityScenario<MainActivity>,walk:JSONObject) {
        val start=points(walk).first()
        phase="walking-stop"
        val stopped=snapshot(s)
        capture(s,"camera-walking-stop-before")
        repeat(5){fix(Coordinate(start.lat+sin(it*1.3)*.000025,start.lon),0.0,180.0,20.0,60.0);SystemClock.sleep(1020)}
        val still=snapshot(s)
        capture(s,"camera-walking-stop-after")
        val drift=distance(Coordinate(stopped.getDouble("renderLat"),stopped.getDouble("renderLon")),
            Coordinate(still.getDouble("renderLat"),still.getDouble("renderLon")))
        events.add(JSONObject().put("event","stationary-walking").put("driftMeters",drift).toString())
        assertTrue("stationary pedestrian jitter must not creep: $drift m; before=$stopped; after=$still",drift<1.0)
        capture(s,"walking-stop")
    }
    /** Actual UI touch; a GPS update can arrive between DOWN and UP. */
    private fun tap(s:ActivityScenario<MainActivity>,label:String,during:()->Unit={}) {
        var x=0f;var y=0f
        s.onActivity { a ->
            fun find(v:android.view.View):android.view.View? {
                if(v.contentDescription==label || v is android.widget.TextView && v.text.toString()==label)return v
                if(v is android.view.ViewGroup)for(i in 0 until v.childCount)find(v.getChildAt(i))?.let{return it}
                return null
            }
            val v=checkNotNull(find(a.window.decorView)){"Missing UI action $label"}
            val at=IntArray(2);v.getLocationOnScreen(at);x=at[0]+v.width*.5f;y=at[1]+v.height*.5f
        }
        val down=SystemClock.uptimeMillis()
        fun send(action:Int) {
            val event=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,x,y,0)
            event.source=InputDevice.SOURCE_TOUCHSCREEN
            assertTrue(instrumentation.uiAutomation.injectInputEvent(event,false));event.recycle()
        }
        send(MotionEvent.ACTION_DOWN);instrumentation.waitForIdleSync()
        during();SystemClock.sleep(120)
        send(MotionEvent.ACTION_UP);SystemClock.sleep(180)
    }
    private fun assertMode(s:ActivityScenario<MainActivity>,mode:String) {
        try {
            await("camera must apply $mode after a single action",15) {
                val f=snapshot(s);f.optString("cameraMode")==mode && !f.optBoolean("cameraPending",true) && !f.optBoolean("styleLoading",true)
            }
        } catch(failure:AssertionError) {
            capture(s,"camera-failed-$mode")
            throw AssertionError("${failure.message}; camera=${snapshot(s)}",failure)
        }
        val f=snapshot(s)
        assertEquals(mode=="FOLLOWING",f.getBoolean("follow"))
        if(mode=="OVERVIEW") {
            assertTrue("remaining route must be measured",f.getInt("remainingPointCount")>=2)
            assertEquals("remaining route must fit the viewport",0,f.getInt("remainingOutsideViewport"))
            assertEquals("remaining route must clear guidance and bottom controls",0,f.getInt("remainingOutsideFraming"))
            assertTrue(AtlasHeading.angleDifference(0.0,f.getDouble("mapBearing"))<.1)
            assertEquals(0.0,f.getDouble("mapTilt"),.1)
        }
        if(mode=="FOLLOWING") {
            assertEquals(18.0,f.getDouble("mapZoom"),.1)
            assertEquals(if(model!!.updates.value.walking)0.0 else 42.0,f.getDouble("mapTilt"),.2)
            val p=f.getJSONArray("cameraPadding")
            assertEquals(if(f.getBoolean("headingUp"))f.getDouble("viewportHeight")*.25 else 0.0,p.getDouble(1),1.0)
        }
        events.add(JSONObject(f.toString()).put("event","camera-$mode").toString())
    }
    private fun assertSameCamera(a:JSONObject,b:JSONObject) {
        assertTrue("GPS must not move a detached camera",distance(
            Coordinate(a.getDouble("cameraLat"),a.getDouble("cameraLon")),
            Coordinate(b.getDouble("cameraLat"),b.getDouble("cameraLon")))<.2)
        assertEquals(a.getDouble("mapZoom"),b.getDouble("mapZoom"),.001)
        assertTrue(AtlasHeading.angleDifference(a.getDouble("mapBearing"),b.getDouble("mapBearing"))<.1)
    }
    private fun cameraSmoke(s:ActivityScenario<MainActivity>,route:JSONObject) {
        phase="camera-smoke"
        val path=points(route)
        var along=0.0
        fun movingFix(accuracy:Double=5.0) {
            along+=8.0;val p=at(path,along)
            fix(p,8.0,bearing(p,at(path,along+3)),accuracy,8.0)
        }
        repeat(3){movingFix();SystemClock.sleep(1020)}
        tap(s,"Overview") { movingFix();SystemClock.sleep(250) }
        assertMode(s,"OVERVIEW");capture(s,"camera-overview-first-tap")
        // The old fit initially passed, then a cursor correction escaped the
        // exact-fit boundary ~250 ms later. Check the settled frame too.
        SystemClock.sleep(650)
        assertEquals("Overview must retain room for cursor corrections",0,
            snapshot(s).getInt("remainingOutsideFraming"))
        val overview=snapshot(s)
        repeat(3){movingFix();SystemClock.sleep(1020)}
        assertSameCamera(overview,snapshot(s))
        assertEquals("Overview framing must survive GPS updates",0,
            snapshot(s).getInt("remainingOutsideFraming"))
        val before=snapshot(s).getDouble("fixTime")
        tap(s,"Recenter on my location")
        assertMode(s,"FOLLOWING")
        assertEquals(before,snapshot(s).getDouble("fixTime"),0.0)
        capture(s,"camera-recenter-no-new-fix")
        repeat(3) {
            tap(s,"Overview");assertMode(s,"OVERVIEW")
            tap(s,"Recenter on my location");assertMode(s,"FOLLOWING")
        }
        fun style(source:String,visual:String,next:(MainActivity)->Unit) {
            s.onActivity { a ->
                model!!.mapSourceMode=source;model!!.mapVisualStyle=visual
                map(a).sourceMode=source;map(a).visualStyle=visual
                map(a).render(model!!.updates.value)
                next(a)
            }
            await("style/source reload must complete",45){!snapshot(s).optBoolean("styleLoading",true)}
        }
        tap(s,"Overview");assertMode(s,"OVERVIEW")
        style(MapSourcePolicy.ONLINE,MapVisualStyle.SATELLITE) { }
        assertMode(s,"OVERVIEW");capture(s,"camera-overview-satellite")
        tap(s,"Recenter on my location");assertMode(s,"FOLLOWING")
        // Request Overview while a new style is being installed.
        style(MapSourcePolicy.ONLINE,MapVisualStyle.HYBRID) { map(it).overview() }
        assertMode(s,"OVERVIEW");capture(s,"camera-overview-during-hybrid-load")
        // Latest request wins even when two earlier requests were pending.
        style(MapSourcePolicy.OFFLINE,MapVisualStyle.STREETS) {
            map(it).overview();map(it).recenter();map(it).overview();map(it).recenter()
        }
        assertMode(s,"FOLLOWING");capture(s,"camera-recenter-during-offline-load")
        pan(s);assertMode(s,"FREE")
        val free=snapshot(s)
        repeat(3){movingFix(35.0);SystemClock.sleep(1020)}
        assertSameCamera(free,snapshot(s))
        style(MapSourcePolicy.ONLINE,MapVisualStyle.HYBRID) { }
        assertMode(s,"FREE");assertSameCamera(free,snapshot(s))
        style(MapSourcePolicy.OFFLINE,MapVisualStyle.STREETS) { map(it).recenter() }
        assertMode(s,"FOLLOWING")
        manualZoom(s);assertMode(s,"FREE")
        tap(s,"Recenter on my location");assertMode(s,"FOLLOWING")
        movingFix(60.0);SystemClock.sleep(1020)
        tap(s,"Overview");assertMode(s,"OVERVIEW")
        tap(s,"Recenter on my location");assertMode(s,"FOLLOWING")
        capture(s,"camera-degraded-recenter")
        // A real background Service keeps updating GPS while the Activity's
        // Choreographer is paused. On return we must show the LATEST fix,
        // never replay the accumulated distance through interpolation.
        phase="background-foreground-catchup"
        val oldCursor=snapshot(s)
        s.moveToState(Lifecycle.State.CREATED)
        repeat(7) {
            movingFix()
            SystemClock.sleep(1020)
        }
        val latest=model!!.updates.value.fix!!
        assertTrue("background GPS must move significantly",
            distance(Coordinate(oldCursor.getDouble("renderLat"),oldCursor.getDouble("renderLon")),
                latest.point)>35.0)
        await("background JNI guidance must catch up",10) {
            model!!.updates.value.guidance?.optDouble("gpsFixTime",-1.0)==latest.time
        }
        s.moveToState(Lifecycle.State.RESUMED);attach(s)
        // The foreground camera and marker must immediately catch up to the
        // LAST CONFIRMED GPS fix. Do not compare them with mutable guidance:
        // RouteGapPrediction keeps advancing that estimated position when the
        // replay intentionally stops delivering real GPS fixes.
        val lastConfirmedFix = latest.point
        val tolerance = max(12.0, latest.accuracy * 1.5)
        try {
            await("resume must snap to the latest confirmed GPS fix, not replay older frames",3) {
                val frame=snapshot(s)
                frame.optString("cameraMode")=="FOLLOWING" &&
                    frame.optDouble("fixTime",Double.NaN)==latest.time &&
                    frame.has("renderLat") && frame.has("renderLon") &&
                    frame.has("cameraLat") && frame.has("cameraLon") &&
                    distance(Coordinate(frame.getDouble("renderLat"),frame.getDouble("renderLon")),
                        lastConfirmedFix)<tolerance &&
                    distance(Coordinate(frame.getDouble("cameraLat"),frame.getDouble("cameraLon")),
                        lastConfirmedFix)<tolerance
            }
        } catch(failure:AssertionError) {
            capture(s,"camera-background-catchup-failed")
            throw AssertionError("${failure.message}; expectedFix=${lastConfirmedFix}; camera=${snapshot(s)}",failure)
        }
        capture(s,"camera-background-caught-up")
        // The cursor must not drift backwards or traverse the missed journey
        // after an immediate foreground catch-up.
        val resumeFrame=snapshot(s)
        val renderedAtResume=Coordinate(
            resumeFrame.getDouble("renderLat"),resumeFrame.getDouble("renderLon"))
        SystemClock.sleep(650)
        val settled=snapshot(s)
        assertTrue("foreground resync must not replay an old visual position",
            distance(renderedAtResume, Coordinate(
                settled.getDouble("renderLat"),settled.getDouble("renderLon")))<20.0)
        tap(s,"Overview");s.recreate();attach(s)
        assertMode(s,"OVERVIEW");capture(s,"camera-overview-recreated")
        tap(s,"Recenter on my location");assertMode(s,"FOLLOWING")
    }
    private fun exportEvidence() {
        if(android.os.Build.VERSION.SDK_INT<29) {
            throw IllegalStateException("GPS replay export requires API 29+ (CI uses 35)")
        }
        val resolver=context.contentResolver
        for(file in output.listFiles().orEmpty().filter { it.isFile }) {
            val values=android.content.ContentValues().apply {
                put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME,file.name)
                put(android.provider.MediaStore.MediaColumns.MIME_TYPE,
                    if(file.extension=="png")"image/png" else "application/octet-stream")
                put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,"Download/$evidenceDirectory/metrics")
                put(android.provider.MediaStore.MediaColumns.IS_PENDING,1)
            }
            val uri=checkNotNull(resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,values))
            checkNotNull(resolver.openOutputStream(uri)).use { target ->
                file.inputStream().use { it.copyTo(target) }
            }
            values.clear();values.put(android.provider.MediaStore.MediaColumns.IS_PENDING,0)
            check(resolver.update(uri,values,null,null)==1)
        }
    }
    @Test fun artifactExportProbe() {
        output.listFiles()?.forEach { it.delete() }
        File(output,"export-probe.txt").writeText("ATLAS_EXPORT_PROBE")
        exportEvidence()
    }
    @Test fun cameraModesAndStationaryWalkingThroughAndroidLocation() = runReplay(true)
    @Test fun portugalTripThroughAndroidLocationServiceJniAndMapLibre() = runReplay(false)
    @Suppress("DEPRECATION")
    private fun runReplay(cameraOnly:Boolean) {
        output.listFiles()?.forEach{it.delete()}
        // run-as-installed package contains hash-verified routing only, not a
        // fake graph or a claim to have tested the full offline map package.
        val region=(context.applicationContext as AtlasApplication).model.regions.regions.first{it.id=="portugal"}
        assertTrue("real Portugal routing package is required",(context.applicationContext as AtlasApplication)
            .model.regions.graph(Coordinate(38.7215,-9.147),Coordinate(38.728,-9.152)).resolve("nodes.bin").isFile)
        locations.addTestProvider(LocationManager.GPS_PROVIDER,false,false,false,false,true,true,true,
            Criteria.POWER_LOW,Criteria.ACCURACY_FINE)
        locations.setTestProviderEnabled(LocationManager.GPS_PROVIDER,true)
        try {
            ActivityScenario.launch(MainActivity::class.java).use { s ->
                attach(s)
                s.onActivity { model!!.mapSourceMode=MapSourcePolicy.OFFLINE }
                val drive=plan(s,Coordinate(38.7215,-9.147),Coordinate(38.728,-9.152),false)
                assertTrue("Portugal drive must include a roundabout",drive.getJSONArray("maneuvers").objects()
                    .any{it.optString("type")=="roundabout"})
                if(cameraOnly) {
                    cameraSmoke(s,drive)
                    val walk=plan(s,Coordinate(38.7215,-9.147),Coordinate(38.7224,-9.1475),true)
                    verifyStationaryWalker(s,walk)
                    repeat(5) { i ->
                        val p=points(walk);val point=at(p,(i+1)*1.5)
                        fix(point,1.5,bearing(point,at(p,(i+1)*1.5+3)))
                        SystemClock.sleep(1020)
                    }
                    capture(s,"camera-walking-resumed")
                    assertTrue("walking must resume after stationary filtering",snapshot(s).getDouble("along")>1.0)
                    s.onActivity { map(it).onDebugFrame=null;model!!.endNavigation() }
                    return@use
                }
                replay(s,drive,8.0,true)
                capture(s,"drive-arrived")
                // Deliberate deviation follows a second real C++ route, not a
                // teleport to force reroute. The destination in Atlas is unchanged.
                val original=plan(s,Coordinate(38.7215,-9.147),Coordinate(38.728,-9.152),false)
                val detour=NativeCore().use { core ->
                    core.graph(model!!.regions.graph(Coordinate(38.7215,-9.147),Coordinate(38.7207,-9.155)).path)
                    JSONObject(core.route(Coordinate(38.7215,-9.147),Coordinate(38.7207,-9.155),false,false,0.0,1))
                }
                phase="deliberate-deviation"
                replay(s,detour,8.0,false,false)
                await("sustained deviation must cause native rerouting",30){
                    model!!.updates.value.route!==original && !model!!.updates.value.busy }
                assertTrue("recenter must also be exercised during the busy reroute state",
                    events.any { JSONObject(it).optString("event")=="recenter-during-reroute" })
                recenter(s,"reroute-recenter")
                File(output,"rerouted-route.json").writeText(model!!.updates.value.route!!.toString(2))
                val resumed=model!!.updates.value.route!!
                val path=points(resumed)
                val pathLength=(1 until path.size).sumOf { distance(path[it-1],path[it]) }
                replay(s,resumed,8.0,false,startAlong=(model!!.updates.value.guidance?.optDouble("along",0.0)
                    ?: 0.0)/resumed.getDouble("distanceMeters")*pathLength)
                // A short real walking route, with stops and bearing noise.
                val walk=plan(s,Coordinate(38.7215,-9.147),Coordinate(38.7224,-9.1475),true)
                verifyStationaryWalker(s,walk)
                pan(s)
                s.onActivity { if(map(it).headingUp)map(it).compass() }
                SystemClock.sleep(650)
                val north=snapshot(s)
                assertTrue("north-up compass must complete without a new GPS fix",
                    AtlasHeading.angleDifference(0.0,north.getDouble("mapBearing"))<1.0)
                assertTrue("manual/compass animation must keep the stationary cursor aligned",
                    AtlasHeading.angleDifference(north.getDouble("cursorBearing"),
                        AtlasHeading.normalize(north.getDouble("travelBearing")-north.getDouble("mapBearing")))<1.5)
                recenter(s,"walking-compass-recenter")
                s.onActivity { if(!map(it).headingUp)map(it).compass() }
                replay(s,walk,1.5,false)
                capture(s,"walk-arrived")
                s.onActivity { map(it).onDebugFrame=null;model!!.endNavigation() }
            }
        } finally {
            instrumentation.runOnMainSync { stateObserver?.cancel();model?.endNavigation() }
            locations.removeTestProvider(LocationManager.GPS_PROVIDER)
            File(output,"frames.ndjson").writeText(synchronized(frames){frames.joinToString("\n")})
            File(output,"fixes.ndjson").writeText(fixes.joinToString("\n"))
            File(output,"events.ndjson").writeText(events.joinToString("\n"))
            // Public MediaStore downloads survive AGP's APK uninstall. Preserve
            // the functional test's original exception if evidence export fails.
            runCatching { exportEvidence() }.onFailure {
                Log.e("ATLAS_GPS_REPLAY","Evidence export failed",it)
            }
            Log.i("ATLAS_GPS_REPLAY","evidence=${output.path} frames=${frames.size} fixes=${fixes.size}")
        }
    }
}
