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
    private val output get()=File(context.getExternalFilesDir(null),"gps-replay").apply { mkdirs() }
    private val frames=Collections.synchronizedList(mutableListOf<String>())
    private val fixes=mutableListOf<String>()
    private val events=mutableListOf<String>()
    private var stateObserver:Job?=null
    private var model: AtlasModel?=null
    private var phase="setup"
    private var lastLogged=0.0

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
                frames.add(frame.toString())
                val now=frame.getDouble("time")
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
    private fun fix(point:Coordinate,speed:Double,heading:Double,accuracy:Double=5.0,bearingAccuracy:Double=5.0) {
        val l=Location(LocationManager.GPS_PROVIDER).apply {
            latitude=point.lat; longitude=point.lon; this.accuracy=accuracy.toFloat()
            this.speed=speed.toFloat(); bearing=heading.toFloat()
            bearingAccuracyDegrees=bearingAccuracy.toFloat()
            time=System.currentTimeMillis(); elapsedRealtimeNanos=SystemClock.elapsedRealtimeNanos()
            altitude=0.0
        }
        locations.setTestProviderLocation(LocationManager.GPS_PROVIDER,l)
        fixes.add(JSONObject().put("time",l.elapsedRealtimeNanos/1e9).put("lat",point.lat)
            .put("lon",point.lon).put("speed",speed).put("accuracy",accuracy)
            .put("heading",heading).put("bearingAccuracy",bearingAccuracy).put("phase",phase).toString())
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
        val screenshot=instrumentation.uiAutomation.takeScreenshot()
        File(output,"$name.png").outputStream().use {
            assertTrue(screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it))
        }
        File(output,"$name.json").writeText(snapshot(s).toString(2))
    }
    private fun pan(s:ActivityScenario<MainActivity>) {
        var x=0f;var y=0f
        s.onActivity { x=it.window.decorView.width*.45f;y=it.window.decorView.height*.45f }
        val down=SystemClock.uptimeMillis()
        for(i in 0..12) {
            val action=when(i){0->MotionEvent.ACTION_DOWN;12->MotionEvent.ACTION_UP;else->MotionEvent.ACTION_MOVE}
            val e=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,x+i*12,y,0)
            e.source=InputDevice.SOURCE_TOUCHSCREEN
            instrumentation.uiAutomation.injectInputEvent(e,true);e.recycle();SystemClock.sleep(16)
        }
        await("gesture must disable follow",5){!snapshot(s).optBoolean("follow",true)}
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
            instrumentation.uiAutomation.injectInputEvent(event,true);event.recycle()
            SystemClock.sleep(40)
        }
        send(MotionEvent.ACTION_DOWN,width*.15f,1)
        send(MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),width*.15f)
        for(i in 1..12)send(MotionEvent.ACTION_MOVE,width*(.15f+.15f*i/12))
        send(MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT),width*.30f)
        send(MotionEvent.ACTION_UP,width*.30f,1)
        SystemClock.sleep(500)
        capture(s,"manual-zoom")
        val after=snapshot(s).getDouble("mapZoom")
        assertTrue("manual pinch must actually zoom MapLibre: $before -> $after",after>before+.2)
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
        fix(from,0.0,0.0);SystemClock.sleep(1100)
        s.onActivity {
            model!!.select(JSONObject().put("id","replay-destination").put("name","GPS replay destination")
                .put("lat",to.lat).put("lon",to.lon))
            model!!.calculate(true)
        }
        await("native Portugal route must calculate",90){model!!.updates.value.navigating&&!model!!.updates.value.busy}
        val route=model!!.updates.value.route!!
        assertTrue("route must contain native graph edges",route.getJSONArray("edgeIndexes").length()>0)
        File(output,if(walking)"walk-route.json" else "drive-route.json").writeText(route.toString(2))
        fix(points(route).first(),0.0,0.0);SystemClock.sleep(1200)
        await("MapLibre must finish loading",45){!snapshot(s).optBoolean("styleLoading",true)}
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
            fix(measured,speed,heading,accuracy,if(bad)5.0 else if(accuracy>=60)60.0 else 8.0)
            SystemClock.sleep(1020)
            if(bad) assertTrue("two inverted GNSS fixes must not reverse the camera",
                AtlasHeading.angleDifference(trueHeading,snapshot(s).getDouble("mapBearing"))<100.0)
            if(!tests && !checkingRecentered && model!!.updates.value.guidance?.optString("state")=="checking") {
                phase="checking-recenter";recenter(s,"checking-recenter");checkingRecentered=true
            }
            if(tests && tick==5) { pan(s);manualZoom(s);SystemClock.sleep(400)
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
                put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,"Download/atlas-gps-replay/metrics")
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
    @Suppress("DEPRECATION")
    @Test fun portugalTripThroughAndroidLocationServiceJniAndMapLibre() {
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
                val start=points(walk).first()
                phase="walking-stop"
                val stopped=snapshot(s)
                repeat(5){fix(Coordinate(start.lat+sin(it*1.3)*.000025,start.lon),0.0,180.0,20.0,60.0);SystemClock.sleep(1020)}
                val still=snapshot(s)
                assertTrue("stationary pedestrian jitter must not creep",distance(
                    Coordinate(stopped.getDouble("renderLat"),stopped.getDouble("renderLon")),
                    Coordinate(still.getDouble("renderLat"),still.getDouble("renderLon")))<1.0)
                capture(s,"walking-stop")
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
