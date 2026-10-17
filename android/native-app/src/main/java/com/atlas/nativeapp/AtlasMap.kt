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
    var onMapSourceChanged: (() -> Unit)? = null
    private var loadedSource = "loading"
    val activeMapSource: String get() = if (styleLoading) "loading" else loadedSource
    val centerPoint: Coordinate get() = map?.cameraPosition?.target?.let { Coordinate(it.latitude,it.longitude) }
        ?: current?.fix?.point ?: Coordinate(38.7223,-9.1393)
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
    private var lastSegment = -1
    private var lastFixTime = -1.0
    private var lastCameraMoveMs = 0L
    private var lastCompassMoveMs = 0L
    private var deviceHeading: Double? = null
    private var lastTravelHeading: Double? = null
    private val stationaryPosition = StationaryMapPosition()
    private val renderInterpolator = NavigationRenderInterpolator()
    private val choreographer by lazy { Choreographer.getInstance() }
    private var frameScheduled = false
    private var framesEnabled = false
    private var lastRenderedFrameAt = 0.0
    private var compassAnimationUntil = 0L
    private var lastRenderedMarker: Coordinate? = null
    private val navigationFrame = Choreographer.FrameCallback { frameTimeNanos ->
        frameScheduled = false
        if (!framesEnabled || styleLoading) return@FrameCallback
        val s = current ?: return@FrameCallback
        if (!s.navigating || s.fix == null || map == null) return@FrameCallback
        val time = frameTimeNanos / 1e9
        // Throttle expensive MapLibre annotation updates to ~30 FPS.
        if (time - lastRenderedFrameAt < 0.032) {
            scheduleNavigationFrame()
            return@FrameCallback
        }
        val deltaTime = (time - lastRenderedFrameAt).coerceIn(0.0,0.1)
        lastRenderedFrameAt = time
        val frame = renderInterpolator.sample(time) ?: return@FrameCallback
        val position = frame.position
        val last = lastRenderedMarker
        if (last == null || distanceMeters(last,position) > 0.08) {
            positionMarker?.position = LatLng(position.lat,position.lon)
            lastRenderedMarker=position
        }
        val ready = map ?: return@FrameCallback
        if (follow && SystemClock.elapsedRealtime() >= compassAnimationUntil) {
            val camera = ready.cameraPosition
            val desiredHeading = if (headingUp) travelHeading(s,s.fix) else 0.0
            val easing = 1-kotlin.math.exp(-2.8*deltaTime)
            val angle = AtlasHeading.normalize(camera.bearing+
                AtlasHeading.signedDelta(camera.bearing,desiredHeading)*easing)
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
        if (frame.active || follow &&
            (ready.cameraPosition.target?.let {
                distanceMeters(Coordinate(it.latitude,it.longitude),position)>0.15
            } ?: false)) scheduleNavigationFrame()
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
            ready.addOnCameraIdleListener { loadStyle(centerPoint) }
            ready.addOnCameraMoveStartedListener { reason ->
                if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) { follow = false; onPan?.invoke() }
            }
            ready.cameraPosition = CameraPosition.Builder().target(LatLng(38.7223, -9.1393)).zoom(13.0).build()
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
        val file = if (sourceMode == MapSourcePolicy.ONLINE) null else regions.map(at)
        val selection = MapSourcePolicy.resolve(sourceMode, file != null)
        val navigating = current?.navigating == true
        val key = "$selection:$sourceMode:${file?.absolutePath ?: ""}:$dark:$navigating:$onlineFailed"
        if (key == styleKey) return styleLoading
        styleKey = key
        styleLoading = true
        stopNavigationFrames()
        renderInterpolator.reset()
        lastRenderedMarker=null
        // Annotation objects survive style switches in the legacy MapLibre API.
        // Remove them from the map, not just from our Kotlin references.
        map?.clear()
        lines.clear(); markers.clear(); places.clear()
        positionMarker = null
        remaining = null; travelled = null; geometry = emptyList()
        route = null; destination = null; options = null; nearby = null
        val builder = when {
            selection == MapSourcePolicy.OFFLINE -> Style.Builder().fromJson(
                AtlasCartography.offlineStyle("pmtiles://file://" + file!!.absolutePath, dark, navigating))
            selection == MapSourcePolicy.UNAVAILABLE -> Style.Builder().fromJson(
                """{"version":8,"sources":{},"layers":[{"id":"atlas-no-offline-map","type":"background","paint":{"background-color":"${if (dark) "#1D2B38" else "#F0F2EF"}"}}]}""")
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
            if (selection == MapSourcePolicy.ONLINE && !onlineFailed) {
                AtlasCartography.enhanceOnline(style, dark, navigating)
            }
            // A render may have happened while style loading; purge any
            // transient annotations before restoring exactly one live cursor.
            map?.clear()
            lines.clear(); markers.clear(); places.clear()
            remaining = null; travelled = null; geometry = emptyList()
            lastSegment = -1; positionMarker = null
            route = null; destination = null; options = null; nearby = null
            styleLoading = false
            loadedSource = selection
            current?.let { render(it) }
            onMapSourceChanged?.invoke()
        }
        return true
    }

    fun center(point: Coordinate, zoom: Double = 15.0) { map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(point.lat, point.lon), zoom)) }
    fun recenter() {
        follow = true
        lastFixTime = -1.0
        lastCameraMoveMs = 0L
        current?.let { render(it) }
        scheduleNavigationFrame()
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
        // In guidance mode the route / confirmed motion owns camera heading.
        // Previously the sensor rotated the camera while every GPS fix
        // rotated it back, making the view swing when the driver was stopped.
        if (state.navigating) return
        val fix = state.fix ?: return
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
        val routeBearing = if (s.navigating) s.guidance?.optDouble("bearing")
            ?.takeIf { it.isFinite() && it >= 0.0 } else null
        val course = if (fix.speed >= 1.2)
            (routeBearing ?: fix.bearing?.takeIf { it.isFinite() }) else null
        if (course != null) lastTravelHeading = AtlasHeading.normalize(course)
        return AtlasHeading.choose(s.navigating, fix.speed,
            routeBearing, fix.bearing, deviceHeading, lastTravelHeading)
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
        val bearing = if (headingUp) deviceHeading ?: 0.0 else 0.0
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
        if (!s.navigating) {
            stopNavigationFrames()
            renderInterpolator.reset()
            lastRenderedMarker=null
        }
        val ready = map ?: return
        if (ready.style == null) return
        val anchor = if(s.navigating && s.fix!=null)s.fix.point else centerPoint
        // Do not draw route annotations into the old style while the new
        // exploration/navigation style is being installed asynchronously.
        if (loadStyle(anchor)) return
        if (s.route !== route || s.routeOptions !== options) {
            lines.forEach { ready.removePolyline(it) }; lines.clear(); remaining = null; travelled = null; lastSegment = -1
            route = s.route; options = s.routeOptions
            for (choice in s.routeOptions.filter { it !== s.route }) {
                val points = points(choice.getJSONArray("points"))
                lines.add(ready.addPolyline(PolylineOptions().addAll(points).color(Color.parseColor(if (dark) "#667385" else "#AAB5C7")).width(4f)))
            }
            geometry = s.route?.let { points(it.getJSONArray("points")) } ?: emptyList()
            if (s.navigating && geometry.size >= 2) {
                renderInterpolator.setRoute(geometry.map { Coordinate(it.latitude,it.longitude) },
                    s.route!!.optDouble("distanceMeters",0.0))
                lastRenderedMarker=null
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
            val candidate = if (s.navigating && s.guidance != null &&
                s.guidance.optDouble("offRoute") < 100) s.guidance.coordinate() else fix.point
            // Visual-only: retain the map-matched road position during
            // stationary GPS jitter; native guidance keeps receiving fixes.
            val display = stationaryPosition.select(candidate, fix, s.navigating, s.walking)
            val smooth = s.navigating && geometry.size>=2 && s.guidance != null &&
                s.guidance.optDouble("offRoute",0.0)<60.0 &&
                s.guidance.optString("state") !in listOf("checking","reroute","arrived")
            val nowSeconds=SystemClock.elapsedRealtimeNanos()/1e9
            if (smooth) {
                val guidance=s.guidance!!
                val along=guidance.optDouble("along",Double.NaN)
                val predictedAt=guidance.optDouble("predictedAt",Double.NaN)
                if (predictedAt.isFinite()) {
                    renderInterpolator.acceptGapPrediction(along,predictedAt,fix.accuracy,s.walking)
                } else if (!guidance.has("gpsFixTime") ||
                    kotlin.math.abs(guidance.optDouble("gpsFixTime") - fix.time)<0.000001) {
                    // Ignore the intermediate StateFlow update where the new
                    // GPS fix arrives before its JNI guidance projection.
                    renderInterpolator.acceptGps(along,display,fix.speed,fix.accuracy,fix.time,s.walking)
                }
            } else if (s.navigating) {
                stopNavigationFrames()
                renderInterpolator.reset()
            }
            val displayed = if(smooth) renderInterpolator.sample(nowSeconds)?.position ?: display else display
            val heading = travelHeading(s, fix)
            val position = LatLng(displayed.lat, displayed.lon)
            if (positionMarker == null) positionMarker = ready.addMarker(MarkerOptions().position(position).icon(positionIcon(AtlasHeading.normalize(heading - ready.cameraPosition.bearing))).title("Your location"))
            else { positionMarker?.position = position; positionMarker?.icon = positionIcon(AtlasHeading.normalize(heading - ready.cameraPosition.bearing)) }
            lastRenderedMarker=displayed
            if (smooth) {
                // Camera and cursor share one frame clock; a new 1 Hz fix
                // only updates the target, never starts a competing animation.
                scheduleNavigationFrame()
            }
            val displayTime = s.guidance?.optDouble("predictedAt", fix.time) ?: fix.time
            if (displayTime != lastFixTime && follow && !smooth) {
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
    fun onCreate(bundle: Bundle?) = view.onCreate(bundle)
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
    fun onSaveInstanceState(bundle: Bundle) = view.onSaveInstanceState(bundle)
}
