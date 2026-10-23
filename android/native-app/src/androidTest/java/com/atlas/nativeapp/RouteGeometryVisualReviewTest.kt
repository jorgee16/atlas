package com.atlas.nativeapp

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.location.LocationManager
import android.os.SystemClock
import android.provider.MediaStore
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.annotations.Polyline
import org.maplibre.android.annotations.PolylineOptions
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.*

/** Actual Portugal C++ routes on actual MapLibre tiles. Controlled visual review,
 * not a replacement for the Android Location/Service/JNI navigation replay. */
@RunWith(AndroidJUnit4::class)
class RouteGeometryVisualReviewTest {
    private val instrumentation=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val model get()=(context.applicationContext as AtlasApplication).model
    private val output get()=File(context.getExternalFilesDir(null),"route-visual-review").apply { mkdirs() }
    private val results=JSONArray()
    private val navigationImages=JSONArray()
    private val routingAttempts=JSONArray()
    private data class RoadCase(val name:String,val from:Coordinate,val to:Coordinate,
        val alternatives:List<Pair<Coordinate,Coordinate>> = emptyList())

    private fun route(road:RoadCase):JSONObject = NativeCore().use { core ->
        core.graph(model.regions.graph(road.from,road.to).path)
        for((from,to) in listOf(road.from to road.to)+road.alternatives) {
            val attempt=JSONObject().put("case",road.name)
                .put("from",JSONArray().put(from.lon).put(from.lat))
                .put("to",JSONArray().put(to.lon).put(to.lat))
            routingAttempts.put(attempt)
            try {
                val result=JSONObject(core.route(from,to,false,false,0.0,1))
                attempt.put("result","connected");return@use result
            } catch(error:IllegalStateException) {
                // Arbitrary endpoints can snap to disconnected/private road components.
                // Record the genuine failure, then try another public-road corridor
                // in the SAME geographic case. Never substitute invented geometry.
                attempt.put("error",error.message)
                if(error.message?.contains("No route connects") != true)throw error
            }
        }
        error("No connected real routing corridor available for ${road.name}: $routingAttempts")
    }

    private fun atlas(activity:MainActivity):AtlasMap = MainActivity::class.java
        .getDeclaredField("atlasMap").apply { isAccessible=true }.get(activity) as AtlasMap
    private fun map(value:AtlasMap):MapLibreMap = AtlasMap::class.java
        .getDeclaredField("map").apply { isAccessible=true }.get(value) as MapLibreMap
    private fun waitFor(label:String, predicate:()->Boolean) {
        val end=SystemClock.elapsedRealtime()+45_000
        while(SystemClock.elapsedRealtime()<end) { if(predicate())return;SystemClock.sleep(100) }
        fail(label)
    }
    private fun snapshot(s:ActivityScenario<MainActivity>,name:String) {
        waitFor("actual road tiles must be visible in $name") {
            var roads=false
            s.onActivity { a ->
                val m=map(atlas(a))
                val ids=m.style!!.layers.filter { it is org.maplibre.android.style.layers.LineLayer &&
                    !it.id.startsWith("atlas-route") && !it.id.startsWith("atlas-visual-review") }.map { it.id }.toTypedArray()
                roads=ids.isNotEmpty() && m.queryRenderedFeatures(android.graphics.RectF(0f,0f,
                    atlas(a).view.width.toFloat(),atlas(a).view.height.toFloat()),*ids).isNotEmpty()
            }
            roads
        }
        SystemClock.sleep(400)
        val latch=CountDownLatch(1)
        var image:Bitmap?=null
        s.onActivity { map(atlas(it)).snapshot { bitmap -> image=bitmap;latch.countDown() } }
        assertTrue("MapLibre must produce a rendered snapshot",latch.await(10,TimeUnit.SECONDS))
        checkNotNull(image).let { bitmap ->
            File(output,"$name.png").outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,it)) }
            bitmap.recycle()
        }
    }
    private fun export() {
        for(file in output.listFiles().orEmpty().filter { it.isFile }) {
            val values=ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME,file.name)
                put(MediaStore.MediaColumns.MIME_TYPE,if(file.extension=="png")"image/png" else "application/json")
                put(MediaStore.MediaColumns.RELATIVE_PATH,"Download/atlas-route-visual-review/metrics")
                put(MediaStore.MediaColumns.IS_PENDING,1)
            }
            val uri=checkNotNull(context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values))
            checkNotNull(context.contentResolver.openOutputStream(uri)).use { out -> file.inputStream().use { it.copyTo(out) } }
            values.clear();values.put(MediaStore.MediaColumns.IS_PENDING,0)
            context.contentResolver.update(uri,values,null,null)
        }
    }
    private fun points(route:JSONObject):List<LatLng> = route.getJSONArray("points").let { a ->
        (0 until a.length()).map { val p=a.getJSONArray(it);LatLng(p.getDouble(1),p.getDouble(0)) }
    }
    private fun coordinates(points:List<LatLng>)=JSONArray().apply {
        points.forEach { put(JSONArray().put(it.longitude).put(it.latitude)) }
    }
    // Exact old v0.2.8 rounding, retained ONLY as a visual before-reference.
    private fun legacy(raw:List<LatLng>):List<LatLng> {
        if(raw.size<3 || raw.size>10_000)return raw
        val out=mutableListOf(raw.first())
        for(i in 1 until raw.lastIndex) {
            val a=raw[i-1];val b=raw[i];val c=raw[i+1]
            val sx=111320*cos(Math.toRadians(b.latitude))
            val x1=(b.longitude-a.longitude)*sx;val y1=(b.latitude-a.latitude)*111320
            val x2=(c.longitude-b.longitude)*sx;val y2=(c.latitude-b.latitude)*111320
            val l1=hypot(x1,y1);val l2=hypot(x2,y2)
            val angle=Math.toDegrees(abs(atan2(x1*y2-y1*x2,x1*x2+y1*y2)))
            if(min(l1,l2)<2 || angle !in 9.0..68.0) { out.add(b);continue }
            val trim=min(2.4,min(l1,l2)*.2)
            val entry=LatLng(b.latitude-y1/l1*trim/111320,b.longitude-x1/l1*trim/sx)
            val exit=LatLng(b.latitude+y2/l2*trim/111320,b.longitude+x2/l2*trim/sx)
            out.add(entry);out.add(LatLng(.25*entry.latitude+.5*b.latitude+.25*exit.latitude,
                .25*entry.longitude+.5*b.longitude+.25*exit.longitude));out.add(exit)
        }
        out.add(raw.last());return out
    }

    @Test fun compareRealPortugalRoadGeometryAtStreetZooms() {
        output.listFiles()?.forEach { it.delete() }
        val previousTheme=model.theme
        val cases=listOf(
            RoadCase("lisbon-roundabout",Coordinate(38.7215,-9.147),Coordinate(38.728,-9.152)),
            RoadCase("sintra-curves",Coordinate(38.7854,-9.3904),Coordinate(38.7807,-9.4155),listOf(
                Coordinate(38.7964,-9.3890) to Coordinate(38.7902,-9.4182),
                Coordinate(38.8001,-9.4451) to Coordinate(38.7983,-9.4210))),
            RoadCase("a5-access",Coordinate(38.7195,-9.2384),Coordinate(38.7119,-9.2206),listOf(
                Coordinate(38.7207,-9.2559) to Coordinate(38.7123,-9.2125),
                Coordinate(38.7270,-9.2370) to Coordinate(38.7250,-9.2020))))
        try {
            for(dark in listOf(false,true)) {
                model.theme=if(dark)"dark" else "light"
                ActivityScenario.launch(MainActivity::class.java).use { s ->
                    s.onActivity { a ->
                        (a.getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(a)
                        model.endNavigation()
                        model.mapSourceMode=MapSourcePolicy.OFFLINE
                        model.mapVisualStyle=MapVisualStyle.STREETS
                    }
                    for(road in cases) {
                        val route=route(road)
                        assertTrue("Real routing graph edges required",route.getJSONArray("edgeIndexes").length()>0)
                        val raw=points(route)
                        val anchors=mutableSetOf<Int>()
                        val maneuvers=route.getJSONArray("maneuvers")
                        for(i in 0 until maneuvers.length())anchors.add(maneuvers.getJSONObject(i).getInt("point"))
                        route.optJSONArray("visualProtectedPoints")?.let { a -> for(i in 0 until a.length())anchors.add(a.getInt(i)) }
                        val prepared=RouteVisualSmoothing.prepare(raw,anchors)
                        val before=legacy(raw)
                        val centreIndex=(1 until raw.lastIndex).filter { it !in anchors }.maxByOrNull { i ->
                            // Select a bend that actually changed. A protected 90-degree
                            // junction is a useful safety check, not evidence of curve quality.
                            prepared.points.minOf { RouteVisualSmoothing.distance(it,raw[i]) }
                        } ?: raw.size/2
                        assertTrue("${road.name} must contain an eligible real road bend",
                            prepared.points.minOf { RouteVisualSmoothing.distance(it,raw[centreIndex]) } > .05)
                        File(output,"${road.name}-geometry.json").writeText(JSONObject()
                            .put("nativeRoute",route).put("legacy",coordinates(before))
                            .put("visual",coordinates(prepared.points)).put("reviewPoint",centreIndex).toString())
                        s.onActivity { a ->
                            @Suppress("UNCHECKED_CAST")
                            model.mapSourceMode=MapSourcePolicy.OFFLINE
                            val state=AtlasModel::class.java.getDeclaredField("state").apply { isAccessible=true }
                                .get(model) as MutableStateFlow<AtlasState>
                            state.value=state.value.copy(route=route,routeOptions=listOf(route),navigating=false,
                                tab="Navigation",fix=null,guidance=null)
                            atlas(a).sourceMode=MapSourcePolicy.OFFLINE
                            atlas(a).visualStyle=MapVisualStyle.STREETS
                            atlas(a).render(state.value)
                        }
                        waitFor("offline MapLibre style must load") {
                            var loaded=false;s.onActivity { loaded=!atlas(it).debugSnapshot().optBoolean("styleLoading",true) };loaded
                        }
                        for(source in if(road===cases.first())listOf(MapSourcePolicy.OFFLINE,MapSourcePolicy.ONLINE) else listOf(MapSourcePolicy.OFFLINE)) {
                            s.onActivity { a -> model.mapSourceMode=source;atlas(a).sourceMode=source;atlas(a).render(model.updates.value) }
                            waitFor("requested Streets source must load") {
                                var loaded=false;s.onActivity { loaded=!atlas(it).debugSnapshot().optBoolean("styleLoading",true) && atlas(it).activeMapSource==source };loaded
                            }
                            val zooms=if(!dark && source==MapSourcePolicy.OFFLINE)listOf(15.0,16.0,17.0,18.0) else listOf(17.0,18.0)
                            s.onActivity { a ->
                                @Suppress("UNCHECKED_CAST")
                                val layers=AtlasMap::class.java.getDeclaredField("routeLayers").apply { isAccessible=true }
                                    .get(atlas(a)) as MutableList<RouteLineRenderer>
                                layers.forEach { it.remove() };layers.clear()
                                atlas(a).follow=false
                            }
                            for(zoom in zooms) {
                                s.onActivity { map(atlas(it)).moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder()
                                    .target(raw[centreIndex]).zoom(zoom).tilt(0.0).bearing(0.0).padding(0.0,0.0,0.0,0.0).build())) }
                                waitFor("real road vector tiles must be rendered before visual comparison") {
                                    var roads=false
                                    s.onActivity { a ->
                                        val m=map(atlas(a))
                                        val ids=m.style!!.layers.filter { it is org.maplibre.android.style.layers.LineLayer &&
                                            !it.id.startsWith("atlas-route") }.map { it.id }.toTypedArray()
                                        roads=ids.isNotEmpty() && m.queryRenderedFeatures(android.graphics.RectF(0f,0f,
                                            atlas(a).view.width.toFloat(),atlas(a).view.height.toFloat()),*ids).isNotEmpty()
                                    }
                                    roads
                                }
                                if(!dark && zoom==18.0)s.onActivity { a ->
                                    val m=map(atlas(a))
                                    val ids=m.style!!.layers.filter { it is org.maplibre.android.style.layers.LineLayer &&
                                        !it.id.startsWith("atlas-route") }.map { it.id }.toTypedArray()
                                    val features=m.queryRenderedFeatures(android.graphics.RectF(0f,0f,
                                        atlas(a).view.width.toFloat(),atlas(a).view.height.toFloat()),*ids)
                                    File(output,"${road.name}-$source-displayed-roads.json").writeText(
                                        org.maplibre.geojson.FeatureCollection.fromFeatures(features).toJson())
                                }
                                for(variant in listOf("raw","before","after")) {
                                    val annotations=mutableListOf<Polyline>();var layer:RouteLineRenderer?=null
                                    s.onActivity { a ->
                                        val m=map(atlas(a))
                                        if(variant=="after")layer=RouteLineRenderer(m.style!!,"atlas-visual-review",prepared,false,dark)
                                        else {
                                            val p=if(variant=="raw")raw else before
                                            annotations.add(m.addPolyline(PolylineOptions().addAll(p).color(android.graphics.Color.WHITE).width(9f)))
                                            annotations.add(m.addPolyline(PolylineOptions().addAll(p).color(android.graphics.Color.rgb(49,94,251)).width(6f)))
                                        }
                                    }
                                    val name="${road.name}-${if(dark)"dark" else "light"}-$source-z${zoom.toInt()}-$variant"
                                    snapshot(s,name)
                                    if(road===cases.first() && source==MapSourcePolicy.OFFLINE && zoom==18.0 && variant=="after") {
                                        val immutable=prepared.points
                                        s.onActivity { layer!!.progress(prepared.fraction(centreIndex,raw[centreIndex])) }
                                        snapshot(s,"$name-progress-boundary")
                                        assertSame("Progress paint must retain the same centreline",immutable,prepared.points)
                                    }
                                    s.onActivity { a -> layer?.remove();annotations.forEach { map(atlas(a)).removePolyline(it) } }
                                    results.put(JSONObject().put("image",name).put("source",source).put("dark",dark)
                                        .put("zoom",zoom).put("variant",variant).put("rawPoints",raw.size).put("visualPoints",prepared.points.size))
                                }
                            }
                            if(road===cases.first()) {
                                // Exercise actual navigation cartography without injecting fake
                                // GPS/guidance or starting a service: visual scope only.
                                var onSource:(()->Unit)?=null
                                s.onActivity { a ->
                                    onSource=atlas(a).onMapSourceChanged
                                    atlas(a).onMapSourceChanged=null
                                    atlas(a).render(model.updates.value.copy(navigating=true,fix=null,guidance=null))
                                }
                                waitFor("navigation Streets style must load") {
                                    var loaded=false;s.onActivity { loaded=!atlas(it).debugSnapshot().optBoolean("styleLoading",true) };loaded
                                }
                                s.onActivity { a -> atlas(a).follow=false
                                    map(atlas(a)).moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder()
                                        .target(raw[centreIndex]).zoom(17.0).tilt(0.0).bearing(0.0).padding(0.0,0.0,0.0,0.0).build())) }
                                val name="${road.name}-${if(dark)"dark" else "light"}-$source-z17-navigation-after"
                                snapshot(s,name)
                                navigationImages.put(name)
                                s.onActivity { a -> atlas(a).onMapSourceChanged=onSource;atlas(a).render(model.updates.value) }
                                waitFor("exploration style must be restored") {
                                    var loaded=false;s.onActivity { loaded=!atlas(it).debugSnapshot().optBoolean("styleLoading",true) };loaded
                                }
                            }
                        }
                    }
                }
            }
        } finally {
            instrumentation.runOnMainSync { model.endNavigation();model.theme=previousTheme }
            File(output,"route-visual-summary.json").writeText(JSONObject().put("cases",results).put("navigationImages",navigationImages)
                .put("routingAttempts",routingAttempts)
                .put("scope","Actual C++ Portugal routes and MapLibre snapshots; controlled visual review, not a GPS replay").toString(2))
            export()
        }
    }
}
