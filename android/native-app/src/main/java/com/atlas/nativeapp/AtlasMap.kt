package com.atlas.nativeapp

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.os.Bundle
import android.os.SystemClock
import android.view.Choreographer
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.gestures.MoveGestureDetector
import org.maplibre.android.gestures.RotateGestureDetector
import org.maplibre.android.gestures.ShoveGestureDetector
import org.maplibre.android.gestures.StandardScaleGestureDetector
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
    private val cameraState = NavigationCameraState()
    var follow: Boolean
        get() = cameraState.mode == NavigationCameraState.Mode.FOLLOWING
        set(value) { requestCamera(if(value) NavigationCameraState.Mode.FOLLOWING else NavigationCameraState.Mode.FREE) }
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
    internal var overviewInsets: (() -> IntArray)? = null
    internal fun onChromeLayout() {
        if(cameraState.mode==NavigationCameraState.Mode.OVERVIEW) {
            val expected=overviewInsets?.invoke()
            val actual=map?.cameraPosition?.padding
            if(expected!=null && actual!=null && expected.indices.all { abs(expected[it]-actual[it])<1.0 })return
            cameraState.viewportChanged()
            applyCameraMode()
        }
    }
    private var loadedSource = "loading"
    val activeMapSource: String get() = if (styleLoading) "loading" else loadedSource
    val centerPoint: Coordinate get() = map?.cameraPosition?.target?.let { Coordinate(it.latitude,it.longitude) }
        ?: current?.fix?.point ?: Coordinate(38.7223,-9.1393)
    private var restoreCamera = false
    private var styleKey = ""
    private var styleLoading = false
    private var styleGeneration = 0L
    private var onlineFailed = false
    private var current: AtlasState? = null
    private var route: JSONObject? = null
    private var options: List<JSONObject>? = null
    private var destination: JSONObject? = null
    private var nearby: List<JSONObject>? = null
    // A screen-space Android view avoids the legacy annotation texture path,
    // which renders custom cursor bitmaps as white silhouettes on software GPUs.
    // Geometry still comes from MapLibre projection, including camera padding/tilt.
    private val cursorBitmap by lazy { createPositionBitmap() }
    private val positionCursor = ImageView(context).apply {
        visibility = View.GONE
        isClickable = false
        contentDescription = "Your location"
    }
    private var positionCoordinate: Coordinate? = null
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
    // While the Activity is stopped NavigationService keeps receiving fixes.
    // Never animate the stale on-screen cursor over the distance travelled away.
    private var backgroundPausedAt = Double.NaN
    private var resumeSyncPending = false
    private var lastRenderedFrameAt = 0.0
    private var lastRenderedMarker: Coordinate? = null
    private var lastTrustedGuidanceAt = Double.NEGATIVE_INFINITY
    private var interpolatedRoute: JSONObject? = null
    private var cameraRoute: JSONObject? = null
    private var wasNavigating = false
    private var routeRendering = false
    private val freePosition = NavigationPositionInterpolator()
    private val presentedPosition = NavigationPositionLimiter()
    /** Installed only by instrumented debug replay; no JSON work in production frames. */
    internal var onDebugFrame: ((JSONObject) -> Unit)? = null
    private var debugFrameCount = 0L
    private var lastMarkerAngle = Double.NaN
    private val navigationFrame = Choreographer.FrameCallback { _ ->
        frameScheduled = false
        if (!framesEnabled || styleLoading || resumeSyncPending) return@FrameCallback
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
        val desiredPosition = routeFrame?.position ?: freeFrame?.first ?: lastRenderedMarker
            ?: return@FrameCallback
        val position=presentedPosition.commit(desiredPosition,time,StationaryMapPosition.visualSpeed(s.fix))
        val markerActive = (routeFrame?.active ?: freeFrame?.second ?: false) || presentedPosition.active
        val last = lastRenderedMarker
        if (last == null || distanceMeters(last,position) > 0.001) {
            setPosition(position)
            lastRenderedMarker=position
        }
        val ready = map ?: return@FrameCallback
        var followingAngle = ready.cameraPosition.bearing
        if (follow && !cameraState.pending) {
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
                        .bearing(angle).zoom(zoom).tilt(tilt).padding(followPadding(s)).build()
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
        if (positionCoordinate == null || !degrees.isFinite()) return
        if (!lastMarkerAngle.isFinite() ||
            AtlasHeading.angleDifference(lastMarkerAngle,degrees) > 1.2) {
            lastMarkerAngle = degrees
            positionCursor.rotation = degrees.toFloat()
        }
    }
    private fun releaseFollowForGesture() {
        if (cameraState.mode == NavigationCameraState.Mode.FREE) return
        requestCamera(NavigationCameraState.Mode.FREE)
        // Keep the pressed control alive until the input gesture is complete.
        view.post { onPan?.invoke() }
    }
    private fun requestCamera(mode: NavigationCameraState.Mode) {
        cameraState.request(mode)
        map?.cancelTransitions()
        applyCameraMode()
    }
    private fun followPadding(s: AtlasState): DoubleArray = doubleArrayOf(0.0,
        if(s.navigating && headingUp)view.height*.25 else 0.0,0.0,0.0)
    private fun overviewPoints(): List<LatLng> {
        if(geometry.size<2)return emptyList()
        val s=current
        if(s?.navigating!=true)return geometry
        val segment=s.guidance?.optInt("segment",0)?.coerceIn(0,geometry.size-2) ?: 0
        val cursor=lastRenderedMarker?.let { LatLng(it.lat,it.lon) }
        return listOf(cursor ?: geometry[segment])+geometry.drop(segment+1)
    }
    private fun applyCameraMode() {
        if(!cameraState.pending || styleLoading || view.width==0 || view.height==0)return
        val ready=map ?: return
        if(ready.style==null)return
        val request=cameraState.revision
        val s=current ?: return
        when(cameraState.mode) {
            NavigationCameraState.Mode.FOLLOWING -> {
                val fix=s.fix ?: return
                val target=lastRenderedMarker ?: fix.point
                val bearing=if(headingUp)travelHeading(s,fix) else 0.0
                val zoom=if(!s.navigating)15.0 else if(s.walking)18.0 else
                    18.0-((fix.speed*3.6-40)/85).coerceIn(0.0,.8)
                ready.cancelTransitions()
                ready.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder()
                    .target(LatLng(target.lat,target.lon)).zoom(zoom).bearing(bearing)
                    .tilt(if(s.navigating && !s.walking)42.0 else 0.0)
                    .padding(followPadding(s)).build()))
                lastFixTime=fix.time
                updatePositionIcon(NavigationCameraBehavior.cursorAngle(s.navigating,true,headingUp,
                    travelHeading(s,fix),bearing))
                cameraState.applied(request)
                if(s.navigating)scheduleNavigationFrame()
            }
            NavigationCameraState.Mode.OVERVIEW -> {
                val points=overviewPoints()
                if(points.size<2)return
                ready.cancelTransitions()
                // Padding is part of every transaction, never MapLibre's deprecated
                // cached setPadding. Normalize before measuring the route bounds.
                ready.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(ready.cameraPosition)
                    .bearing(0.0).tilt(0.0).padding(0.0,0.0,0.0,0.0).build()))
                val d=context.resources.displayMetrics.density
                val insets=overviewInsets?.invoke() ?: intArrayOf((40*d).toInt(),(220*d).toInt(),(80*d).toInt(),(280*d).toInt())
                // Bounds calculation and its camera must share the same
                // insets. Clearing fitted padding shifts the whole route by
                // half the top/bottom difference, underneath the UI panels.
                val fitted=ready.getCameraForLatLngBounds(LatLngBounds.Builder().includes(points).build(),insets,0.0,0.0)
                    ?: return
                ready.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(fitted)
                    .bearing(0.0).tilt(0.0).padding(insets.map { it.toDouble() }.toDoubleArray()).build()))
                cameraState.applied(request)
            }
            NavigationCameraState.Mode.FREE -> cameraState.applied(request)
        }
        updatePositionPlacement()
    }
    @SuppressLint("ClickableViewAccessibility") // Observer only: MapView retains touch/click handling.
    private fun observeDoubleTap() {
        val taps = GestureDetector(context,object: GestureDetector.SimpleOnGestureListener() {
            override fun onDoubleTap(event: MotionEvent): Boolean {
                releaseFollowForGesture()
                return false
            }
        })
        view.setOnTouchListener { _,event -> taps.onTouchEvent(event);false }
    }
    private fun setPosition(point: Coordinate) {
        positionCoordinate = point
        updatePositionPlacement()
    }
    private fun updatePositionPlacement() {
        val coordinate = positionCoordinate ?: return
        val ready = map ?: return
        if (styleLoading) return
        val screen = ready.projection.toScreenLocation(LatLng(coordinate.lat,coordinate.lon))
        val size = positionCursor.layoutParams.width
        positionCursor.translationX = screen.x-size*.5f
        positionCursor.translationY = screen.y-size*.5f
        positionCursor.visibility = View.VISIBLE
        if(view.indexOfChild(positionCursor)!=view.childCount-1)positionCursor.bringToFront()
    }
    private fun clearPosition() {
        positionCoordinate = null
        positionCursor.visibility = View.GONE
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
        observeDoubleTap()
        view.addOnLayoutChangeListener { _,l,t,r,b,ol,ot,or,ob ->
            if(r-l!=or-ol || b-t!=ob-ot) { cameraState.viewportChanged();applyCameraMode() }
        }
        val cursorSize = (44*context.resources.displayMetrics.density).toInt()
        positionCursor.setImageBitmap(cursorBitmap)
        view.addView(positionCursor,FrameLayout.LayoutParams(cursorSize,cursorSize,Gravity.TOP or Gravity.START))
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
                updatePositionPlacement()
                loadStyle(current?.takeIf { it.navigating }?.fix?.point ?: centerPoint)
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
                updatePositionPlacement()
                val state=current
                if (!styleLoading && state != null && (!follow || !headingUp)) {
                    state.fix?.let { fix ->
                        updatePositionIcon(NavigationCameraBehavior.cursorAngle(
                            state.navigating,follow,headingUp,travelHeading(state,fix),ready.cameraPosition.bearing))
                    }
                }
            }
            // CameraChangeDispatcher coalesces started/idle notifications while
            // our navigation camera is moving. A gesture can therefore lose its
            // REASON_API_GESTURE to the next render frame. Yield synchronously
            // at the recognized gesture boundary instead of waiting for that event.
            ready.addOnMoveListener(object: MapLibreMap.OnMoveListener {
                override fun onMoveBegin(detector: MoveGestureDetector) = releaseFollowForGesture()
                override fun onMove(detector: MoveGestureDetector) {}
                override fun onMoveEnd(detector: MoveGestureDetector) {}
            })
            ready.addOnScaleListener(object: MapLibreMap.OnScaleListener {
                override fun onScaleBegin(detector: StandardScaleGestureDetector) = releaseFollowForGesture()
                override fun onScale(detector: StandardScaleGestureDetector) {}
                override fun onScaleEnd(detector: StandardScaleGestureDetector) {}
            })
            ready.addOnRotateListener(object: MapLibreMap.OnRotateListener {
                override fun onRotateBegin(detector: RotateGestureDetector) = releaseFollowForGesture()
                override fun onRotate(detector: RotateGestureDetector) {}
                override fun onRotateEnd(detector: RotateGestureDetector) {}
            })
            ready.addOnShoveListener(object: MapLibreMap.OnShoveListener {
                override fun onShoveBegin(detector: ShoveGestureDetector) = releaseFollowForGesture()
                override fun onShove(detector: ShoveGestureDetector) {}
                override fun onShoveEnd(detector: ShoveGestureDetector) {}
            })
            // Do not consume queued camera-start reasons: a stale gesture event
            // arriving after Recenter must not switch FOLLOWING back to FREE.
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
        val generation=++styleGeneration
        styleLoading = true
        cameraState.viewportChanged()
        map?.cancelTransitions()
        stopNavigationFrames()
        // Styling does not reset route progress, the stationary anchor or the
        // visible/predicted point. Only annotations are rebuilt below.
        // Annotation objects survive style switches in the legacy MapLibre API.
        // Remove them from the map, not just from our Kotlin references.
        map?.clear()
        trailOverlay=null
        lines.clear(); markers.clear(); places.clear()
        clearPosition()
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
            if (generation!=styleGeneration || key!=styleKey) return@setStyle
            if (selection == MapSourcePolicy.ONLINE && !onlineFailed && !imagery) {
                AtlasCartography.enhanceOnline(style, dark, navigating)
            }
            // A render may have happened while style loading; purge any
            // transient annotations before restoring exactly one live cursor.
            map?.clear()
            trailOverlay=null
            lines.clear(); markers.clear(); places.clear()
            remaining = null; travelled = null; geometry = emptyList()
            lastSegment = -1; clearPosition()
            lastMarkerAngle = Double.NaN
            route = null; destination = null; options = null; nearby = null
            styleLoading = false
            loadedSource = selection
            current?.let { render(it) }
            applyCameraMode()
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
        if(trail!=null && trailPath.size>=2 && map!=null && current?.navigating!=true) {
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
    fun center(point: Coordinate, zoom: Double = 15.0) {
        requestCamera(NavigationCameraState.Mode.FREE)
        map?.moveCamera(CameraUpdateFactory.newLatLngZoom(LatLng(point.lat,point.lon),zoom))
    }
    fun recenter() = requestCamera(NavigationCameraState.Mode.FOLLOWING)

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
        updatePositionIcon(0.0)
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
        val s=current
        when(cameraState.mode) {
            NavigationCameraState.Mode.FOLLOWING -> requestCamera(NavigationCameraState.Mode.FOLLOWING)
            NavigationCameraState.Mode.OVERVIEW -> requestCamera(NavigationCameraState.Mode.OVERVIEW)
            NavigationCameraState.Mode.FREE -> {
                val ready=map ?: return
                val bearing=if(headingUp && s?.fix!=null)travelHeading(s,s.fix) else 0.0
                ready.cancelTransitions()
                ready.moveCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder(ready.cameraPosition)
                    .bearing(bearing).build()))
                s?.fix?.let { updatePositionIcon(NavigationCameraBehavior.cursorAngle(s.navigating,false,
                    headingUp,travelHeading(s,it),bearing)) }
            }
        }
    }
    fun endNavigation() {
        map?.cancelTransitions()
        stopNavigationFrames()
        renderInterpolator.reset()
        interpolatedRoute=null
        stationaryPosition.reset()
        freePosition.reset()
        presentedPosition.reset()
        cameraState.request(NavigationCameraState.Mode.FOLLOWING)
        current=current?.copy(navigating=false)
        applyCameraMode()
    }
    fun overview() = requestCamera(NavigationCameraState.Mode.OVERVIEW)
    fun render(s: AtlasState) {
        current = s
        if (!s.navigating) resumeSyncPending = false
        // Recalculating a route keeps confirmed motion; starting a different
        // trip must not inherit the previous journey's opposite course.
        if(s.navigating && !wasNavigating)headingStabilizer.reset()
        if (!s.navigating) {
            stopNavigationFrames()
            renderInterpolator.reset()
            interpolatedRoute=null
            routeRendering=false
            lastTrustedGuidanceAt=Double.NEGATIVE_INFINITY
            freePosition.reset()
            presentedPosition.reset()
            if(wasNavigating) { stationaryPosition.reset();lastRenderedMarker=null }
        }
        wasNavigating=s.navigating
        val ready = map ?: return
        if (ready.style == null) return
        val anchor = if(s.navigating && s.fix!=null)s.fix.point else centerPoint
        // Do not draw route annotations into the old style while the new
        // exploration/navigation style is being installed asynchronously.
        if (loadStyle(anchor)) return
        if (s.route !== route || s.routeOptions !== options) {
            val previousVisible = lastRenderedMarker
            val previousCameraRoute=cameraRoute
            val newCameraRoute=s.route!==cameraRoute
            cameraRoute=s.route
            lines.forEach { ready.removePolyline(it) }; lines.clear(); remaining = null; travelled = null; lastSegment = -1
            route = s.route; options = s.routeOptions
            for (choice in s.routeOptions.filter { it !== s.route }) {
                val points = points(choice.getJSONArray("points"))
                lines.add(ready.addPolyline(PolylineOptions().addAll(points).color(Color.parseColor(if (dark) "#667385" else "#AAB5C7")).width(4f)))
            }
            geometry = s.route?.let { points(it.getJSONArray("points")) } ?: emptyList()
            if (s.navigating && geometry.size >= 2 && s.route !== interpolatedRoute) {
                interpolatedRoute=s.route
                renderInterpolator.setRoute(geometry.map { Coordinate(it.latitude,it.longitude) },
                    s.route!!.optDouble("distanceMeters",0.0),previousVisible)
                // Do not flash/reset a visible cursor during a reroute.
                lastRenderedMarker=previousVisible
            }
            if (geometry.size >= 2) {
                lines.add(ready.addPolyline(PolylineOptions().addAll(geometry).color(Color.WHITE).width(9f)))
                remaining = ready.addPolyline(PolylineOptions().addAll(geometry).color(Color.rgb(49,94,251)).width(6f)).also { lines.add(it) }
                if (!s.navigating && newCameraRoute && (!restoreCamera || previousCameraRoute!=null)) overview()
                else if(cameraState.mode==NavigationCameraState.Mode.OVERVIEW)cameraState.viewportChanged()
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
            val nowSeconds = SystemClock.elapsedRealtimeNanos() / 1e9
            val catchingUp = resumeSyncPending &&
                NavigationResumePolicy.freshFix(nowSeconds, fix.time)
            if (catchingUp) {
                // Normal visual smoothing is correct for 1 Hz fixes, but not
                // for minutes of movement accumulated while drawing was paused.
                // Recreate ONLY the visual interpolation clock/anchors. Neither
                // C++ guidance nor the user's chosen camera mode is modified.
                stationaryPosition.reset()
                freePosition.reset()
                presentedPosition.reset()
                lastRenderedMarker = null
                lastRenderedFrameAt = nowSeconds
                lastTrustedGuidanceAt = Double.NEGATIVE_INFINITY
                renderInterpolator.reset()
                if (geometry.size >= 2 && s.route != null) {
                    renderInterpolator.setRoute(
                        geometry.map { Coordinate(it.latitude, it.longitude) },
                        s.route.optDouble("distanceMeters", 0.0))
                    interpolatedRoute = s.route
                } else {
                    interpolatedRoute = null
                }
                routeRendering = false
                lastFixTime = -1.0
            }
            // The Activity can observe the newest GPS fix before the JNI
            // projection for that fix arrives. Do not snap to old guidance.
            val guidanceCurrent = !catchingUp || NavigationResumePolicy.currentGuidance(
                fix.time, s.guidance?.optDouble("gpsFixTime", Double.NaN) ?: Double.NaN)
            val candidate = if (guidanceCurrent && s.navigating && !s.busy && s.guidance != null &&
                s.guidance.optString("state") !in listOf("checking","reroute","changed") &&
                s.guidance.optDouble("offRoute") < 60) s.guidance.coordinate() else fix.point
            // Visual-only: retain the map-matched road position during
            // stationary GPS jitter; native guidance keeps receiving fixes.
            val display = stationaryPosition.select(candidate, fix, s.navigating, s.walking)
            val trusted = guidanceCurrent && s.navigating && !s.busy && geometry.size>=2 && s.guidance != null &&
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
                    renderInterpolator.acceptGps(along,display,StationaryMapPosition.visualSpeed(fix),fix.accuracy,fix.time,s.walking,fix.bearingAccuracy)
                }
            }
            // During checking/rerouting retain the last filtered position
            // briefly instead of dropping into raw GPS every second.
            // After the hold expires, raw fixes can show a real deviation.
            val desiredDisplayed = if(smooth) renderInterpolator.sample(nowSeconds)?.position
                ?: lastRenderedMarker ?: display else if(s.navigating)
                    freePosition.sample(nowSeconds)?.first ?: display else display
            if(trusted && !wasRouteRendering &&
                StationaryMapPosition.visualSpeed(fix)<(if(s.walking).45 else 1.2)) {
                // Initial road matching may snap an unprojected fix to a nearby
                // footpath. Both stationary filters must then use the same
                // coordinate reference; raw-origin anchors caused later creep.
                stationaryPosition.rebase(desiredDisplayed,fix,s.walking)
                renderInterpolator.holdStationary(desiredDisplayed)
            }
            val displayed=if(s.navigating)presentedPosition.commit(desiredDisplayed,nowSeconds,
                StationaryMapPosition.visualSpeed(fix)) else desiredDisplayed
            val heading = travelHeading(s, fix)
            val position = LatLng(displayed.lat, displayed.lon)
            val markerAngle = NavigationCameraBehavior.cursorAngle(
                s.navigating,follow,headingUp,heading,ready.cameraPosition.bearing)
            setPosition(displayed)
            updatePositionIcon(markerAngle)
            lastRenderedMarker=displayed
            if (catchingUp) {
                resumeSyncPending = false
                // A following camera must jump to the same current position as
                // the cursor. FREE and OVERVIEW keep their deliberate framing.
                if (follow) cameraState.viewportChanged()
            }
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
                    ready.animateCamera(CameraUpdateFactory.newCameraPosition(
                        CameraPosition.Builder().target(position).zoom(zoom)
                            .bearing(targetBearing)
                            .tilt(0.0).padding(0.0,0.0,0.0,0.0).build()
                    ), 700)
                }
            }
        }
        applyCameraMode()
    }
    internal fun debugCursorBitmap(): Bitmap? = if(positionCoordinate!=null)cursorBitmap else null
    internal fun debugCursorScreenCenter(): android.graphics.PointF? {
        if(positionCursor.visibility!=View.VISIBLE)return null
        val location=IntArray(2)
        view.getLocationOnScreen(location)
        return android.graphics.PointF(location[0]+positionCursor.translationX+positionCursor.width*.5f,
            location[1]+positionCursor.translationY+positionCursor.height*.5f)
    }
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
            put("cameraMode",cameraState.mode.name);put("cameraPending",cameraState.pending)
            put("cameraRevision",cameraState.revision);put("mapTilt",camera?.tilt)
            put("cameraPadding",camera?.padding?.let { JSONArray(it.toList()) })
            put("viewportWidth",view.width);put("viewportHeight",view.height)
            if(cameraState.mode==NavigationCameraState.Mode.OVERVIEW) {
                val pixels=overviewPoints().mapNotNull { map?.projection?.toScreenLocation(it) }
                put("remainingPointCount",pixels.size)
                put("remainingOutsideViewport",pixels.count { it.x<0 || it.y<0 || it.x>view.width || it.y>view.height })
                val padding=camera?.padding ?: doubleArrayOf(0.0,0.0,0.0,0.0)
                put("remainingOutsideFraming",pixels.count {
                    it.x<padding[0]-2 || it.y<padding[1]-2 ||
                        it.x>view.width-padding[2]+2 || it.y>view.height-padding[3]+2
                })
            }
            put("styleLoading",styleLoading); put("mapBearing",camera?.bearing)
            put("mapSource",activeMapSource);put("mapVisualStyle",activeVisualStyle)
            put("mapZoom",camera?.zoom)
            put("zoomGesturesEnabled",map?.uiSettings?.isZoomGesturesEnabled)
            put("minZoom",map?.minZoomLevel)
            put("maxZoom",map?.maxZoomLevel)
            put("cameraLat",camera?.target?.latitude); put("cameraLon",camera?.target?.longitude)
            put("renderLat",lastRenderedMarker?.lat); put("renderLon",lastRenderedMarker?.lon)
            put("cursorBearing",lastMarkerAngle.takeIf { it.isFinite() })
            put("cursorVisible",positionCursor.visibility==View.VISIBLE)
            put("cursorScreenX",debugCursorScreenCenter()?.x)
            put("cursorScreenY",debugCursorScreenCenter()?.y)
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
    private fun createPositionBitmap(): Bitmap {
        val size = (44 * context.resources.displayMetrics.density).toInt()
        val bitmap = Bitmap.createBitmap(size,size,Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap); val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = Color.argb(36,49,94,251); canvas.drawCircle(size/2f,size/2f,size*.49f,paint)
        paint.color = Color.WHITE; canvas.drawCircle(size/2f,size/2f,size*.34f,paint)
        paint.color = Color.rgb(49,94,251)
        val path=Path().apply { moveTo(size*.5f,size*.22f); lineTo(size*.72f,size*.72f); lineTo(size*.5f,size*.61f); lineTo(size*.28f,size*.72f); close() }
        canvas.drawPath(path,paint)
        return bitmap
    }
    fun onCreate(bundle: Bundle?) {
        restoreCamera = bundle != null
        val restored=bundle?.getString("atlas.cameraMode")?.let { name ->
            NavigationCameraState.Mode.values().find { it.name==name }
        } ?: if(bundle?.getBoolean("atlas.follow",true)!=false) NavigationCameraState.Mode.FOLLOWING
            else NavigationCameraState.Mode.FREE
        cameraState.request(restored)
        headingUp = bundle?.getBoolean("atlas.headingUp",true) ?: true
        view.onCreate(bundle)
    }
    fun onStart() = view.onStart()
    fun onResume() {
        view.onResume()
        val now = SystemClock.elapsedRealtimeNanos() / 1e9
        if (NavigationResumePolicy.shouldSynchronize(
                backgroundPausedAt, now, current?.navigating == true)) {
            resumeSyncPending = true
        }
        backgroundPausedAt = Double.NaN
        framesEnabled=true
        if (!resumeSyncPending) scheduleNavigationFrame()
        // MainActivity immediately renders the latest StateFlow state after
        // this callback; render() completes the pending one-shot resync.
    }
    fun onPause() {
        backgroundPausedAt = SystemClock.elapsedRealtimeNanos() / 1e9
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
        bundle.putString("atlas.cameraMode",cameraState.mode.name)
        bundle.putBoolean("atlas.follow",follow)
        bundle.putBoolean("atlas.headingUp",headingUp)
        view.onSaveInstanceState(bundle)
    }
}

