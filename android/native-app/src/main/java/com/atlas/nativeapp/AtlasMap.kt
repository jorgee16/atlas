package com.atlas.nativeapp

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.os.Bundle
import android.os.SystemClock
import android.view.Choreographer
import android.view.Gravity
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.annotations.IconFactory
import org.maplibre.android.annotations.Marker
import org.maplibre.android.annotations.MarkerOptions
import org.maplibre.android.annotations.Polyline
import org.maplibre.android.annotations.PolylineOptions
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import kotlin.math.abs
import kotlin.math.min

@Suppress("DEPRECATION")
class AtlasMap(private val context: Context, private val regions: RegionStore, val dark: Boolean) {
    val view: MapView
    private var map: MapLibreMap? = null
    var onPan: (() -> Unit)? = null
    var onPoint: ((Coordinate) -> Unit)? = null
    var onPlace: ((JSONObject) -> Unit)? = null
    var onRoute: ((JSONObject) -> Unit)? = null
    var follow = true
    var headingUp = true
    /** Applied before each render; source switching does not alter active routes. */
    var sourceMode: String = MapSourcePolicy.AUTO
        set(value) {
            require(MapSourcePolicy.isValid(value))
            if (field != value) {
                field = value
                onlineFailed = false
            }
        }
    var visualStyle: String=MapVisualStyle.STREETS
        set(value){
            require(MapVisualStyle.valid(value))
            if(field!=value){field=value;onlineFailed=false}
        }
    val activeVisualStyle:String
        get()=if(styleLoading)"loading"
            else if(loadedSource==MapSourcePolicy.ONLINE &&
                MapVisualStyle.usesImagery(visualStyle,sourceMode) && !onlineFailed)
                    visualStyle else MapVisualStyle.STREETS
    var onMapSourceChanged: (() -> Unit)? = null
    private var loadedSource = "loading"
    val activeMapSource: String get() = if (styleLoading) "loading" else loadedSource
    val centerPoint: Coordinate get() = map?.cameraPosition?.target?.let { Coordinate(it.latitude,it.longitude) }
        ?: current?.fix?.point ?: Coordinate(38.7223,-9.1393)
    private var restoreCamera = false
    private var styleKey = ""
    private var styleLoading = false
    private var onlineFailed = false
    private var current: AtlasState? = null
    private var route: JSONObject? = null
    private var options: List<JSONObject>? = null
    private var destination: JSONObject? = null
    private var nearby: List<JSONObject>? = null
    private var positionMarker: Marker? = null
    private val markers = mutableListOf<Marker>()
    private val places = mutableMapOf<Long, JSONObject>()
    private val lines = mutableListOf<Polyline>()
    private var remaining: Polyline? = null
    private var travelled: Polyline? = null
    private var geometry = emptyList<LatLng>()
    private var trailOverlay: Polyline? = null
    private var trailPath: List<LatLng> = emptyList()
    private var trailId: String? = null
    private var lastSegment = -1
    private var lastFixTime = -1.0
    private var lastCameraMoveMs = 0L
    private var lastCompassMoveMs = 0L
    private var deviceHeading: Double? = null
    private val headingStabilizer = MotionHeadingStabilizer()
    private val stationaryPosition = StationaryMapPosition()
    private val renderInterpolator = NavigationRenderInterpolator()
    private val choreographer by lazy { Choreographer.getInstance() }
    private var frameScheduled = false
    private var framesEnabled = false
    private var lastRenderedFrameAt = 0.0
    private var compassAnimationUntil = 0L
    private var lastRenderedMarker: Coordinate? = null
    private var lastTrustedGuidanceAt = Double.NEGATIVE_INFINITY
    private var recenterPending = false
    private var routeRendering = false
    private val freePosition = NavigationPositionInterpolator()
    /** Installed only by instrumented debug replay; no JSON work in production frames. */
    internal var onDebugFrame: ((JSONObject) -> Unit)? = null
    private var debugFrameCount = 0L
    private var lastMarkerAngle = Double.NaN
    private val navigationFrame = Choreographer.FrameCallback { _ ->
        frameScheduled = false
        if (!framesEnabled || styleLoading) return@FrameCallback
        val s = current ?: return@FrameCallback
        if (!s.navigating || s.fix == null || map == null) return@FrameCallback
        // Choreographer's frame clock may exclude deep sleep, while GPS fix
        // timestamps include it. Use the same elapsed-realtime clock for both.
        val time = SystemClock.elapsedRealtimeNanos() / 1e9
        // Throttle expensive MapLibre annotation updates to ~30 FPS.
        if (time - lastRenderedFrameAt < 0.032) {
            scheduleNavigationFrame()
            return@FrameCallback
        }
        val deltaTime = (time - lastRenderedFrameAt).coerceIn(0.0,0.1)
        lastRenderedFrameAt = time
        // A scheduled route frame must never overwrite a newer off-route fix.
        val routeFrame = if (routeRendering) renderInterpolator.sample(time) else null
        val freeFrame = if (routeFrame == null) freePosition.sample(time) else null
        val position = routeFrame?.position ?: freeFrame?.first ?: lastRenderedMarker
            ?: return@FrameCallback
        val markerActive = routeFrame?.active ?: freeFrame?.second ?: false
        val last = lastRenderedMarker
        if (last == null || distanceMeters(last,position) > 0.08) {
            positionMarker?.position = LatLng(position.lat,position.lon)
            lastRenderedMarker=position
        }
        val ready = map ?: return@FrameCallback
        var followingAngle = ready.cameraPosition.bearing
        if (follow && SystemClock.elapsedRealtime() >= compassAnimationUntil) {
            val camera = ready.cameraPosition
            val desiredHeading = if (headingUp) travelHeading(s,s.fix) else 0.0
            val easing = 1-kotlin.math.exp(-2.8*deltaTime)
            val angle = AtlasHeading.normalize(camera.bearing+
                AtlasHeading.signedDelta(camera.bearing,desiredHeading)*easing)
            followingAngle = angle
            val targetZoom = if (s.walking) 18.0 else
                18.0-((s.fix.speed*3.6-40)/85).coerceIn(0.0,.8)
            val zoom = camera.zoom+(targetZoom-camera.zoom)*easing
            val tiltTarget = if(s.walking) 0.0 else 42.0
            val tilt = camera.tilt+(tiltTarget-camera.tilt)*easing
            val center = camera.target ?: LatLng(position.lat,position.lon)
            val centerCoordinate = Coordinate(center.latitude,center.longitude)
            val centerEase = 1-kotlin.math.exp(-6.0*deltaTime)
            val cameraPos = Coordinate(
                center.latitude+(position.lat-center.latitude)*centerEase,
                center.longitude+(position.lon-center.longitude)*centerEase
            )
            if (distanceMeters(centerCoordinate,position)>0.12 ||
                AtlasHeading.angleDifference(camera.bearing,angle)>0.25 ||
                kotlin.math.abs(camera.zoom-zoom)>0.01 ||
                kotlin.math.abs(camera.tilt-tilt)>0.1) {
                ready.moveCamera(CameraUpdateFactory.newCameraPosition(
                    CameraPosition.Builder().target(LatLng(cameraPos.lat,cameraPos.lon))
                        .bearing(angle).zoom(zoom).tilt(tilt).build()
                ))
            }
        }
        // One render clock owns both the map's rotation and the cursor icon.
        // In heading-up guided follow, the arrow stays forward on the screen.
        val cursor = NavigationCameraBehavior.cursorAngle(
            true,follow,headingUp,travelHeading(s,s.fix),followingAngle)
        updatePositionIcon(cursor)
        val camera = ready.cameraPosition
        val error = camera.target?.let {
            distanceMeters(Coordinate(it.latitude,it.longitude),position)
        } ?: Double.POSITIVE_INFINITY
        val expected = if (headingUp) travelHeading(s,s.fix) else 0.0
        val zoom = if (s.walking) 18.0 else
            18.0-((s.fix.speed*3.6-40)/85).coerceIn(0.0,.8)
        debugFrameCount++
        onDebugFrame?.invoke(debugSnapshot())
        if (NavigationCameraBehavior.shouldContinueFrame(follow,markerActive,
                error,AtlasHeading.signedDelta(camera.bearing,expected),
                camera.zoom-zoom,camera.tilt-(if(s.walking)0.0 else 42.0)))
            scheduleNavigationFrame()
    }
    private fun updatePositionIcon(degrees: Double) {
        if (positionMarker == null) return
        if (!lastMarkerAngle.isFinite() ||
            AtlasHeading.angleDifference(lastMarkerAngle,degrees) > 1.2) {
            lastMarkerAngle = degrees
            positionMarker?.icon = positionIcon(degrees)
        }
    }
    private fun distanceMeters(a: Coordinate,b: Coordinate): Double {
        val mid=Math.toRadians((a.lat+b.lat)/2)
        return kotlin.math.hypot((a.lat-b.lat)*111_320.0,
            (a.lon-b.lon)*111_320.0*kotlin.math.cos(mid))
    }
    private fun scheduleNavigationFrame() {
        if (!framesEnabled || frameScheduled || styleLoading) return
        frameScheduled=true
        choreographer.postFrameCallback(navigationFrame)
    }
    private fun stopNavigationFrames() {
        frameScheduled=false
        choreographer.removeFrameCallback(navigationFrame)
    }
    init {
        MapLibre.getInstance(context)
        view = MapView(context)
        view.getMapAsync { ready ->
            map = ready
            ready.uiSettings.isCompassEnabled = false
            ready.uiSettings.isLogoEnabled = false
            ready.uiSettings.isAttributionEnabled = false
            ready.addOnMapLongClickListener { p -> onPoint?.invoke(Coordinate(p.latitude, p.longitude)); true }
            ready.addOnMapClickListener { p ->
                val state = current
                if ((state?.routeOptions?.size ?: 0) > 1) {
                    val projection = ready.projection
                    val touch = projection.toScreenLocation(p)
                    var nearest: JSONObject? = null; var best = 24 * context.resources.displayMetrics.density
                    for (choice in state!!.routeOptions) {
                        val points = choice.getJSONArray("points")
                        var previous: android.graphics.PointF? = null
                        val indices=(0 until points.length() step maxOf(1,points.length()/1500)).toMutableList()
                        if(points.length()>0 && indices.lastOrNull()!=points.length()-1)indices.add(points.length()-1)
                        for (i in indices) {
                            val a=points.getJSONArray(i)
                            val pixel=projection.toScreenLocation(LatLng(a.getDouble(1),a.getDouble(0)))
                            val before=previous
                            if(before!=null){
                                val dx=pixel.x-before.x;val dy=pixel.y-before.y;val length=dx*dx+dy*dy
                                val fraction=if(length>0)((touch.x-before.x)*dx+(touch.y-before.y)*dy)/length else 0f
                                val t=fraction.coerceIn(0f,1f)
                                val distance=kotlin.math.hypot(touch.x-before.x-t*dx,touch.y-before.y-t*dy)
                                if(distance<best){nearest=choice;best=distance}
                            }
                            previous=pixel
                        }
                    }
                    nearest?.let { onRoute?.invoke(it) }
                }
                false
            }
            ready.setOnMarkerClickListener { marker: Marker -> places[marker.id]?.let { onPlace?.invoke(it) }; true }
            ready.addOnCameraIdleListener {
                loadStyle(centerPoint)
                // The marker bitmap is screen-oriented. After a camera bearing
                // animation, re-express its angle in the *new* map reference.
                // Otherwise the marker keeps the bearing of the previous frame.
                val state = current
                if (!styleLoading && state != null) {
                    state.fix?.let { fix ->
                        updatePositionIcon(NavigationCameraBehavior.cursorAngle(
                            state.navigating,follow,headingUp,travelHeading(state,fix),ready.cameraPosition.bearing))
                    }
                }
            }
            // Compass/gesture animations can continue after GPS prediction has
            // stopped. Re-express a screen-oriented cursor against the actual
            // camera even when no navigation frame is currently scheduled.
            ready.addOnCameraMoveListener {
                val state=current
                if (!styleLoading && state != null && (!follow || !headingUp)) {
                    state.fix?.let { fix ->
                        updatePositionIcon(NavigationCameraBehavior.cursorAngle(
                            state.navigating,follow,headingUp,travelHeading(state,fix),ready.cameraPosition.bearing))
                    }
                }
            }
            ready.addOnCameraMoveStartedListener { reason ->
                if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) { follow = false; onPan?.invoke() }
            }
            if (!restoreCamera) ready.cameraPosition = CameraPosition.Builder().target(LatLng(38.7223, -9.1393)).zoom(13.0).build()
            loadStyle(Coordinate(38.7223, -9.1393))
        }
        view.addOnDidFailLoadingMapListener {
            if (!onlineFailed && styleKey.startsWith("online:")) {
                onlineFailed = true
                styleKey = ""
                loadStyle(current?.fix?.point ?: centerPoint)
            }
        }
    }
    /** Return true if a new style is loading; rendering must wait for its callback. */
    private fun loadStyle(at: Coordinate): Boolean {
        val imagery=MapVisualStyle.usesImagery(visualStyle,sourceMode)
        val file=if(sourceMode==MapSourcePolicy.ONLINE || imagery)null else regions.map(at)
        val selection=if(imagery)MapSourcePolicy.ONLINE
            else MapSourcePolicy.resolve(sourceMode,file!=null)
        val navigating=current?.navigating==true
        val key="$selection:$sourceMode:$visualStyle:${file?.absolutePath ?: ""}:$dark:$navigating:$onlineFailed"
        if (key == styleKey) return styleLoading
        styleKey = key
        styleLoading = true
        stopNavigationFrames()
        renderInterpolator.reset()
        lastRenderedMarker=null
        // Annotation objects survive style switches in the legacy MapLibre API.
        // Remove them from the map, not just from our Kotlin references.
        map?.clear()
        trailOverlay=null
        lines.clear(); markers.clear(); places.clear()
        positionMarker = null
        lastMarkerAngle = Double.NaN
        remaining = null; travelled = null; geometry = emptyList()
        route = null; destination = null; options = null; nearby = null
        val builder = when {
            selection == MapSourcePolicy.OFFLINE -> Style.Builder().fromJson(
                AtlasCartography.offlineStyle("pmtiles://file://" + file!!.absolutePath, dark, navigating))
            selection == MapSourcePolicy.UNAVAILABLE -> Style.Builder().fromJson(
                """{"version":8,"sources":{},"layers":[{"id":"atlas-no-offline-map","type":"background","paint":{"background-color":"${if (dark) "#1D2B38" else "#F0F2EF"}"}}]}""")
            imagery && !onlineFailed -> Style.Builder().fromJson(
                AtlasCartography.satelliteStyle(visualStyle==MapVisualStyle.HYBRID))
            !onlineFailed -> Style.Builder().fromUri(AtlasCartography.onlineUri(dark, navigating))
            else -> Style.Builder().fromJson("""{"version":8,
                "sources":{"osm":{"type":"raster",
                "tiles":["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
                "tileSize":256,"attribution":"© OpenStreetMap contributors"}},
                "layers":[{"id":"osm","type":"raster","source":"osm",
                "paint":{"raster-saturation":-0.35,"raster-contrast":0.05}}]}""")
        }
        map?.setStyle(builder) { style ->
            if (key != styleKey) return@setStyle
            if (selection == MapSourcePolicy.ONLINE && !onlineFailed && !imagery) {
                AtlasCartography.enhanceOnline(style, dark, navigating)
            }
            // A render may have happened while style loading; purge any
            // transient annotations before restoring exactly one live cursor.
            map?.clear()
            trailOverlay=null
            lines.clear(); markers.clear(); places.clear()
            remaining = null; travelled = null; geometry = emptyList()
            lastSegment = -1; positionMarker = null
            lastMarkerAngle = Double.NaN
            route = null; destination = null; options = null; nearby = null
            styleLoading = false
            loadedSource = selection
            current?.let { render(it) }
            if (recenterPending) recenter()
            addTrailOverlay()
            onMapSourceChanged?.invoke()
        }
        return true
    }

    /** Trails are visual overlays, never inputs to the route planner. */
    fun previewTrail(trail: Trail?) {
        if(trailId==trail?.id && (trail==null || trailOverlay!=null))return
        trailOverlay?.let{map?.removePolyline(it)}
        trailOverlay=null
        trailId=trail?.id
        trailPath=trail?.polyline?.map{LatLng(it.lat,it.lon)}.orEmpty()
        addTrailOverlay()
        if(trail!=null && trailPath.size>=2 && map!=null) {
            follow=false
            val bounds=LatLngBounds.Builder().includes(trailPath).build()
            map?.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds,
                (view.resources.displayMetrics.density*44).toInt()),450)
        }
    }
    private fun addTrailOverlay() {
        if(trailOverlay!=null || trailPath.size<2 || styleLoading || map?.style==null)return
        trailOverlay=map?.addPolyline(PolylineOptions().addAll(trailPath)
            .color(Color.rgb(49,94,251)).width(7f))
    }
    fun center(point: Coordinate, zoom: Double = 15.0) { map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(point.lat, point.lon), zoom)) }
    fun recenter() {
        follow = true
        lastFixTime = -1.0
        lastCameraMoveMs = 0L
        val s = current
        val fix = s?.fix
        val ready = map
        if (ready == null || ready.style == null || styleLoading || s == null || fix == null) {
            recenterPending = true
            return
        }
        recenterPending = false
        val now = SystemClock.elapsedRealtimeNanos()/1e9
        // Recenter MUST work even with no new 1Hz fix. Do not wait for the
        // interpolator to generate another target before restoring follow.
        val target = if (s.navigating) lastRenderedMarker
            ?: (if (routeRendering) renderInterpolator.sample(now)?.position
                else freePosition.sample(now)?.first)
            ?: s.guidance?.coordinate() ?: fix.point
            else fix.point
        val travel = travelHeading(s,fix)
        val bearing = if (headingUp) travel else 0.0
        val zoom = if (!s.navigating) 15.0 else if(s.walking) 18.0 else
            18.0 - ((fix.speed*3.6-40)/85).coerceIn(0.0,.8)
        ready.setPadding(0,
            if (s.navigating && headingUp) (view.height*.25).toInt() else 0,
            0,0)
        // A single immediate camera transaction prevents the old 700ms
        // animation from fighting the 30fps navigation camera.
        ready.cancelTransitions()
        compassAnimationUntil = 0L
        ready.moveCamera(CameraUpdateFactory.newCameraPosition(
            CameraPosition.Builder().target(LatLng(target.lat,target.lon))
                .zoom(zoom).bearing(bearing)
                .tilt(if (s.navigating && !s.walking) 42.0 else 0.0)
                .build()))
        val cursor = NavigationCameraBehavior.cursorAngle(
            s.navigating,follow,headingUp,travel,bearing)
        updatePositionIcon(cursor)
        if (s.navigating) scheduleNavigationFrame()
    }

    /** The phone azimuth is used when exploring or when GPS cannot infer travel. */
    fun setDeviceHeading(heading: Double) {
        if (!heading.isFinite()) return
        val clean = AtlasHeading.normalize(heading)
        val previous = deviceHeading
        deviceHeading = if (previous == null) clean else
            AtlasHeading.normalize(previous +
                AtlasHeading.signedDelta(previous, clean) * 0.18)
        val state = current ?: return
        // Never let the phone compass override a confirmed GPS course
        // during driving, even if the user is only exploring the map.
        // The same conflict used to make the camera and arrow disagree
        // several times per second between 1 Hz GPS fixes.
        if (state.navigating) return
        val fix = state.fix ?: return
        val freshGps = SystemClock.elapsedRealtimeNanos() / 1e9 - fix.time in 0.0..5.0
        if (freshGps && headingStabilizer.ownsMovingHeading(fix)) return
        if (!headingUp || !follow) return
        val ready = map ?: return
        val target = deviceHeading ?: return
        val now = SystemClock.elapsedRealtime()
        if (now - lastCompassMoveMs < 550L ||
            AtlasHeading.angleDifference(ready.cameraPosition.bearing, target) < 9.0) return
        lastCompassMoveMs = now
        ready.animateCamera(CameraUpdateFactory.bearingTo(target), 450)
        positionMarker?.icon = positionIcon(0.0)
    }

    private fun travelHeading(s: AtlasState, fix: Fix): Double {
        val guidance = s.guidance
        val distance = guidance?.optDouble("offRoute",Double.POSITIVE_INFINITY)
            ?: Double.POSITIVE_INFINITY
        val onRoute = s.navigating && guidance != null &&
            distance.isFinite() && distance < maxOf(30.0, fix.accuracy * 1.5) &&
            guidance.optString("state") !in listOf("checking","reroute","changed")
        val routeBearing = if (onRoute) guidance
            ?.optDouble("bearing")?.takeIf { it.isFinite() && it >= 0.0 } else null
        return headingStabilizer.resolve(fix,deviceHeading,s.navigating,routeBearing,onRoute)
    }

    fun compass() {
        headingUp = !headingUp
        val state = current
        val fix = state?.fix
        val target = if (headingUp && state != null && fix != null)
            travelHeading(state, fix) else 0.0
        // One animation owns a compass tap. The next render from the same
        // fix must not immediately launch another, conflicting animation.
        lastFixTime = fix?.time ?: -1.0
        lastCameraMoveMs = SystemClock.elapsedRealtime()
        map?.setPadding(0, if (state?.navigating == true && headingUp)
            (view.height * .25).toInt() else 0, 0, 0)
        compassAnimationUntil = SystemClock.elapsedRealtime() + 400L
        map?.animateCamera(CameraUpdateFactory.bearingTo(target), 350)
        if (follow && state != null) render(state)
        scheduleNavigationFrame()
    }
    /** Drop navigation-only camera settings when End is confirmed. */
    fun endNavigation() {
        stopNavigationFrames()
        renderInterpolator.reset()
        stationaryPosition.reset()
        follow = true
        lastFixTime = -1.0
        lastCameraMoveMs = 0L
        map?.setPadding(0, 0, 0, 0)
        val target = current?.fix?.point ?: return
        val bearing = if (headingUp) current?.fix?.let {
            travelHeading(current!!, it)
        } ?: deviceHeading ?: 0.0 else 0.0
        map?.animateCamera(CameraUpdateFactory.newCameraPosition(
            CameraPosition.Builder().target(LatLng(target.lat, target.lon))
                .zoom(15.0).bearing(bearing).tilt(0.0).build()), 400)
    }

    fun overview() {
        if (geometry.size < 2) return
        follow = false
        val bounds = LatLngBounds.Builder().includes(geometry).build()
        val d = context.resources.displayMetrics.density
        map?.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds, (40*d).toInt(), (140*d).toInt(), (40*d).toInt(), (260*d).toInt()))
    }
    fun render(s: AtlasState) {
        current = s
        if (recenterPending && s.fix != null && !styleLoading && map?.style != null) {
            // A delayed first GPS fix must also satisfy a recenter request.
            recenter()
        }
        if (!s.navigating) {
            stopNavigationFrames()
            renderInterpolator.reset()
            lastRenderedMarker=null
            routeRendering=false
            freePosition.reset()
        }
        val ready = map ?: return
        if (ready.style == null) return
        val anchor = if(s.navigating && s.fix!=null)s.fix.point else centerPoint
        // Do not draw route annotations into the old style while the new
        // exploration/navigation style is being installed asynchronously.
        if (loadStyle(anchor)) return
        if (s.route !== route || s.routeOptions !== options) {
            val previousVisible = lastRenderedMarker
            lines.forEach { ready.removePolyline(it) }; lines.clear(); remaining = null; travelled = null; lastSegment = -1
            route = s.route; options = s.routeOptions
            for (choice in s.routeOptions.filter { it !== s.route }) {
                val points = points(choice.getJSONArray("points"))
                lines.add(ready.addPolyline(PolylineOptions().addAll(points).color(Color.parseColor(if (dark) "#667385" else "#AAB5C7")).width(4f)))
            }
            geometry = s.route?.let { points(it.getJSONArray("points")) } ?: emptyList()
            if (s.navigating && geometry.size >= 2) {
                renderInterpolator.setRoute(geometry.map { Coordinate(it.latitude,it.longitude) },
                    s.route!!.optDouble("distanceMeters",0.0),previousVisible)
                // Do not flash/reset a visible cursor during a reroute.
                lastRenderedMarker=previousVisible
            }
            if (geometry.size >= 2) {
                lines.add(ready.addPolyline(PolylineOptions().addAll(geometry).color(Color.WHITE).width(9f)))
                remaining = ready.addPolyline(PolylineOptions().addAll(geometry).color(Color.rgb(49,94,251)).width(6f)).also { lines.add(it) }
                if (!s.navigating) overview()
            }
        }
        if (s.destination !== destination || s.exploreResults !== nearby) {
            markers.forEach { ready.removeMarker(it) }; markers.clear(); places.clear()
            destination = s.destination; nearby = s.exploreResults
            val list = if (s.tab == "Explore") s.exploreResults.take(40) else emptyList()
            for (place in list) addPlace(place, false)
            s.destination?.let { addPlace(it, true) }
        }
        if (s.navigating && s.guidance != null && geometry.size > 1) {
            val segment = s.guidance.optInt("segment").coerceIn(0, geometry.size - 2)
            // Update at every accepted progress fix, not only on segment
            // changes: otherwise travelled/remaining lines appear frozen.
            val snapped = s.guidance.coordinate().let { LatLng(it.lat, it.lon) }
            remaining?.points = listOf(snapped) + geometry.drop(segment + 1)
            val done = geometry.take(segment + 1) + snapped
            if (travelled == null) travelled = ready.addPolyline(PolylineOptions().addAll(done).color(Color.parseColor("#9EA9BA")).width(5f)).also { lines.add(it) }
            else travelled?.points = done
            lastSegment = segment
        }
        s.fix?.let { fix ->
            val candidate = if (s.navigating && !s.busy && s.guidance != null &&
                s.guidance.optString("state") !in listOf("checking","reroute","changed") &&
                s.guidance.optDouble("offRoute") < 60) s.guidance.coordinate() else fix.point
            // Visual-only: retain the map-matched road position during
            // stationary GPS jitter; native guidance keeps receiving fixes.
            val display = stationaryPosition.select(candidate, fix, s.navigating, s.walking)
            val nowSeconds=SystemClock.elapsedRealtimeNanos()/1e9
            val trusted = s.navigating && !s.busy && geometry.size>=2 && s.guidance != null &&
                s.guidance.optDouble("offRoute",Double.POSITIVE_INFINITY)<60.0 &&
                s.guidance.optString("state") !in listOf("checking","reroute","arrived")
            if (trusted) lastTrustedGuidanceAt = s.guidance!!
                .optDouble("predictedAt",s.guidance.optDouble("gpsFixTime",fix.time))
            val hold = NavigationCameraBehavior.useHeldRouteFix(s.navigating,
                trusted,nowSeconds-lastTrustedGuidanceAt)
            val smooth = trusted || hold
            val wasRouteRendering = routeRendering
            routeRendering = smooth
            if (s.navigating && !smooth) {
                freePosition.accept(display,fix.time,fix.accuracy,nowSeconds,
                    if (wasRouteRendering) lastRenderedMarker else null)
            }
            if (trusted) {
                val guidance=s.guidance!!
                val along=guidance.optDouble("along",Double.NaN)
                val predictedAt=guidance.optDouble("predictedAt",Double.NaN)
                if (predictedAt.isFinite()) {
                    renderInterpolator.acceptGapPrediction(along,predictedAt,fix.accuracy,s.walking)
                } else if (!guidance.has("gpsFixTime") ||
                    kotlin.math.abs(guidance.optDouble("gpsFixTime") - fix.time)<0.000001) {
                    // Ignore the intermediate StateFlow update where the new
                    // GPS fix arrives before its JNI guidance projection.
                    renderInterpolator.acceptGps(along,display,fix.speed,fix.accuracy,fix.time,s.walking,fix.bearingAccuracy)
                }
            }
            // During checking/rerouting retain the last filtered position
            // briefly instead of dropping into raw GPS every second.
            // After the hold expires, raw fixes can show a real deviation.
            val displayed = if(smooth) renderInterpolator.sample(nowSeconds)?.position
                ?: lastRenderedMarker ?: display else if(s.navigating)
                    freePosition.sample(nowSeconds)?.first ?: display else display
            val heading = travelHeading(s, fix)
            val position = LatLng(displayed.lat, displayed.lon)
            val markerAngle = NavigationCameraBehavior.cursorAngle(
                s.navigating,follow,headingUp,heading,ready.cameraPosition.bearing)
            if (positionMarker == null) {
                positionMarker = ready.addMarker(MarkerOptions().position(position)
                    .icon(positionIcon(markerAngle)).title("Your location"))
                lastMarkerAngle = markerAngle
            } else {
                positionMarker?.position = position
                updatePositionIcon(markerAngle)
            }
            lastRenderedMarker=displayed
            if (s.navigating) {
                // The camera keeps rotating and moving independently of 1Hz fixes.
                scheduleNavigationFrame()
            }
            val displayTime = s.guidance?.optDouble("predictedAt", fix.time) ?: fix.time
            if (displayTime != lastFixTime && follow && !s.navigating) {
                lastFixTime = displayTime
                val now = SystemClock.elapsedRealtime()
                val camera = ready.cameraPosition
                val cameraTarget = camera.target ?: position
                val latitudeMeters = (position.latitude - cameraTarget.latitude) * 111_320.0
                val longitudeMeters = (position.longitude - cameraTarget.longitude) *
                    111_320.0 * kotlin.math.cos(Math.toRadians(position.latitude))
                val shiftMeters = kotlin.math.hypot(latitudeMeters, longitudeMeters)
                val targetBearing = if (headingUp) heading else 0.0
                val bearingChange = AtlasHeading.angleDifference(camera.bearing, targetBearing)
                val zoom = if (!s.navigating) 15.0 else if (s.walking) 18.0 else
                    (18.0 - ((fix.speed * 3.6 - 40) / 85).coerceIn(0.0, .8))
                val needsCamera = shiftMeters > (if (s.navigating) 5.0 else 10.0) ||
                    bearingChange > 6.0 || abs(camera.zoom - zoom) > 0.15 ||
                    abs(camera.tilt - if (s.navigating && !s.walking) 42.0 else 0.0) > 2.0
                // GPS is typically sampled every second. Avoid cancelling an ongoing
                // camera animation for jitter or duplicate fixes.
                if (needsCamera && now - lastCameraMoveMs >= 850L) {
                    lastCameraMoveMs = now
                    ready.setPadding(0, if (s.navigating && headingUp) (view.height * .25).toInt() else 0, 0, 0)
                    ready.animateCamera(CameraUpdateFactory.newCameraPosition(
                        CameraPosition.Builder().target(position).zoom(zoom)
                            .bearing(targetBearing)
                            .tilt(if (s.navigating && !s.walking) 42.0 else 0.0).build()
                    ), 700)
                }
            }
        }
    }
    internal fun debugCursorBitmap(): Bitmap? = positionMarker?.icon?.bitmap
    internal fun debugSnapshot(): JSONObject {
        val camera = map?.cameraPosition
        val s = current
        val f = s?.fix
        val g = s?.guidance
        return JSONObject().apply {
            put("time",SystemClock.elapsedRealtimeNanos()/1e9)
            put("frames",debugFrameCount)
            put("fixTime",f?.time); put("accuracy",f?.accuracy)
            put("bearingAccuracy",f?.bearingAccuracy); put("speed",f?.speed)
            put("rawSpeed",f?.providerSpeed); put("busy",s?.busy)
            put("rawBearing",f?.providerBearing); put("filteredBearing",f?.bearing)
            put("travelBearing",if(s!=null && f!=null)travelHeading(s,f) else null)
            put("guidance",g?.optString("state")); put("along",g?.optDouble("along"))
            put("offRoute",g?.optDouble("offRoute")); put("segment",g?.optInt("segment"))
            put("predictedAt",g?.optDouble("predictedAt")?.takeIf { it.isFinite() })
            put("routeRendering",routeRendering); put("follow",follow); put("headingUp",headingUp)
            put("styleLoading",styleLoading); put("mapBearing",camera?.bearing)
            put("mapZoom",camera?.zoom)
            put("zoomGesturesEnabled",map?.uiSettings?.isZoomGesturesEnabled)
            put("minZoom",map?.minZoomLevel)
            put("maxZoom",map?.maxZoomLevel)
            put("cameraLat",camera?.target?.latitude); put("cameraLon",camera?.target?.longitude)
            put("renderLat",lastRenderedMarker?.lat); put("renderLon",lastRenderedMarker?.lon)
            put("cursorBearing",lastMarkerAngle.takeIf { it.isFinite() })
        }
    }
    private fun points(array: JSONArray): List<LatLng> = (0 until array.length()).map { array.getJSONArray(it).let { p -> LatLng(p.getDouble(1), p.getDouble(0)) } }
    private fun addPlace(place: JSONObject, selected: Boolean) {
        val p = place.coordinate()
        val marker = map!!.addMarker(MarkerOptions().position(LatLng(p.lat,p.lon)).title(place.optString("name")).icon(pinIcon(selected)))
        markers.add(marker); places[marker.id] = place
    }
    private fun pinIcon(selected: Boolean): org.maplibre.android.annotations.Icon {
        val density = context.resources.displayMetrics.density
        val size = ((if (selected) 38 else 24) * density).toInt()
        val bitmap = Bitmap.createBitmap(size,size,Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap); val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = Color.WHITE; canvas.drawCircle(size/2f,size/2f,size*.46f,paint)
        paint.color = Color.rgb(49,94,251); canvas.drawCircle(size/2f,size/2f,size*.34f,paint)
        paint.color = Color.WHITE; canvas.drawCircle(size/2f,size/2f,size*.11f,paint)
        return IconFactory.getInstance(context).fromBitmap(bitmap)
    }
    private fun positionIcon(heading: Double): org.maplibre.android.annotations.Icon {
        val size = (44 * context.resources.displayMetrics.density).toInt()
        val bitmap = Bitmap.createBitmap(size,size,Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap); val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = Color.argb(36,49,94,251); canvas.drawCircle(size/2f,size/2f,size*.49f,paint)
        paint.color = Color.WHITE; canvas.drawCircle(size/2f,size/2f,size*.34f,paint)
        canvas.rotate(heading.toFloat(),size/2f,size/2f)
        paint.color = Color.rgb(49,94,251)
        val path=Path().apply { moveTo(size*.5f,size*.22f); lineTo(size*.72f,size*.72f); lineTo(size*.5f,size*.61f); lineTo(size*.28f,size*.72f); close() }
        canvas.drawPath(path,paint)
        return IconFactory.getInstance(context).fromBitmap(bitmap)
    }
    fun onCreate(bundle: Bundle?) {
        restoreCamera = bundle != null
        follow = bundle?.getBoolean("atlas.follow",true) ?: true
        headingUp = bundle?.getBoolean("atlas.headingUp",true) ?: true
        view.onCreate(bundle)
    }
    fun onStart() = view.onStart()
    fun onResume() {
        view.onResume()
        framesEnabled=true
        scheduleNavigationFrame()
    }
    fun onPause() {
        framesEnabled=false
        stopNavigationFrames()
        view.onPause()
    }
    fun onStop() {
        framesEnabled=false
        stopNavigationFrames()
        view.onStop()
    }
    fun onDestroy() {
        framesEnabled=false
        stopNavigationFrames()
        renderInterpolator.reset()
        view.onDestroy()
    }
    fun onLowMemory() = view.onLowMemory()
    fun onSaveInstanceState(bundle: Bundle) {
        bundle.putBoolean("atlas.follow",follow)
        bundle.putBoolean("atlas.headingUp",headingUp)
        view.onSaveInstanceState(bundle)
    }
}

