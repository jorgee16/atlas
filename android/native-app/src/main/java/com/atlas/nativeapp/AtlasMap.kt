package com.atlas.nativeapp

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.os.Bundle
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
    private var styleKey = ""
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
                        for (i in 0 until points.length() step maxOf(1, points.length() / 150)) {
                            val a = points.getJSONArray(i)
                            val pixel = projection.toScreenLocation(LatLng(a.getDouble(1), a.getDouble(0)))
                            val distance = kotlin.math.hypot(pixel.x - touch.x, pixel.y - touch.y)
                            if (distance < best) { nearest = choice; best = distance }
                        }
                    }
                    nearest?.let { onRoute?.invoke(it) }
                }
                false
            }
            ready.addOnMarkerClickListener { marker -> places[marker.id]?.let { onPlace?.invoke(it) }; true }
            ready.addOnCameraMoveStartedListener { reason ->
                if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) { follow = false; onPan?.invoke() }
            }
            ready.cameraPosition = CameraPosition.Builder().target(LatLng(38.7223, -9.1393)).zoom(13.0).build()
            loadStyle(Coordinate(38.7223, -9.1393))
        }
        view.addOnDidFailLoadingMapListener {
            if (!onlineFailed && styleKey.startsWith("online")) { onlineFailed = true; styleKey = ""; loadStyle(current?.fix?.point ?: Coordinate(38.7223, -9.1393)) }
        }
    }
    private fun loadStyle(at: Coordinate) {
        val file = regions.map(at)
        val key = file?.absolutePath ?: "online:$dark:$onlineFailed"
        if (key == styleKey) return
        styleKey = key
        val builder = if (file != null) {
            val base = if (dark) "#14202C" else "#F1F2ED"
            val water = if (dark) "#1E3A4D" else "#BDDCE8"
            val land = if (dark) "#20382E" else "#DEEDD5"
            Style.Builder().fromJson("""{"version":8,"sources":{"atlas":{"type":"vector","url":${JSONObject.quote("pmtiles://file://" + file.absolutePath)}}},"layers":[
                {"id":"background","type":"background","paint":{"background-color":"$base"}},
                {"id":"landcover","type":"fill","source":"atlas","source-layer":"landcover","paint":{"fill-color":"$land"}},
                {"id":"water","type":"fill","source":"atlas","source-layer":"water","paint":{"fill-color":"$water"}},
                {"id":"buildings","type":"fill","source":"atlas","source-layer":"building","paint":{"fill-color":"${if (dark) "#2A3541" else "#E0E2DF"}"}},
                {"id":"roads","type":"line","source":"atlas","source-layer":"transportation","paint":{"line-color":"${if (dark) "#435465" else "#FFFFFF"}","line-width":3}}
            ]}""")
        } else if (!onlineFailed) Style.Builder().fromUri("https://tiles.openfreemap.org/styles/${if (dark) "dark" else "positron"}")
        else Style.Builder().fromJson("""{"version":8,"sources":{"osm":{"type":"raster","tiles":["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],"tileSize":256,"attribution":"© OpenStreetMap contributors"}},"layers":[{"id":"osm","type":"raster","source":"osm","paint":{"raster-saturation":-0.65,"raster-contrast":-0.12}}]}""")
        map?.setStyle(builder) {
            route = null; destination = null; options = null; nearby = null; positionMarker = null
            current?.let { render(it) }
        }
    }
    fun center(point: Coordinate, zoom: Double = 15.0) { map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(point.lat, point.lon), zoom)) }
    fun recenter() { follow = true; current?.fix?.point?.let { center(it, if (current?.navigating == true) 17.5 else 15.0) } }
    fun compass() { headingUp = !headingUp; if (!headingUp) map?.animateCamera(CameraUpdateFactory.bearingTo(0.0)) }
    fun overview() {
        if (geometry.size < 2) return
        follow = false
        val bounds = LatLngBounds.Builder().includes(geometry).build()
        val d = context.resources.displayMetrics.density
        map?.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds, (40*d).toInt(), (140*d).toInt(), (40*d).toInt(), (260*d).toInt()))
    }
    fun render(s: AtlasState) {
        current = s
        val ready = map ?: return
        if (ready.style == null) return
        val anchor = s.origin ?: s.fix?.point ?: s.destination?.coordinate() ?: Coordinate(38.7223, -9.1393)
        loadStyle(anchor)
        if (s.route !== route || s.routeOptions !== options) {
            lines.forEach { ready.removePolyline(it) }; lines.clear(); remaining = null; travelled = null; lastSegment = -1
            route = s.route; options = s.routeOptions
            for (choice in s.routeOptions.filter { it !== s.route }) {
                val points = points(choice.getJSONArray("points"))
                lines.add(ready.addPolyline(PolylineOptions().addAll(points).color(Color.parseColor(if (dark) "#667385" else "#AAB5C7")).width(4f)))
            }
            geometry = s.route?.let { points(it.getJSONArray("points")) } ?: emptyList()
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
            if (segment != lastSegment) {
                lastSegment = segment
                val snapped = s.guidance.coordinate().let { LatLng(it.lat, it.lon) }
                remaining?.points = listOf(snapped) + geometry.drop(segment + 1)
                val done = geometry.take(segment + 1) + snapped
                if (travelled == null) travelled = ready.addPolyline(PolylineOptions().addAll(done).color(Color.parseColor("#9EA9BA")).width(5f)).also { lines.add(it) }
                else travelled?.points = done
            }
        }
        s.fix?.let { fix ->
            val display = if (s.navigating && s.guidance != null && s.guidance.optDouble("offRoute") < 100) s.guidance.coordinate() else fix.point
            val heading = s.guidance?.takeUnless { it.isNull("bearing") }?.optDouble("bearing") ?: fix.bearing ?: 0.0
            val position = LatLng(display.lat, display.lon)
            if (positionMarker == null) positionMarker = ready.addMarker(MarkerOptions().position(position).icon(positionIcon(heading)).title("Your location"))
            else { positionMarker?.position = position; positionMarker?.icon = positionIcon(heading) }
            if (fix.time != lastFixTime && follow) {
                lastFixTime = fix.time
                ready.setPadding(0, if (s.navigating && headingUp) (view.height * .25).toInt() else 0, 0, 0)
                val zoom = if (!s.navigating) 15.0 else if (s.walking) 18.0 else (18.0 - ((fix.speed * 3.6 - 40) / 85).coerceIn(0.0, .8))
                ready.animateCamera(CameraUpdateFactory.newCameraPosition(CameraPosition.Builder().target(position).zoom(zoom)
                    .bearing(if (headingUp) heading else 0.0).tilt(if (s.navigating && !s.walking) 42.0 else 0.0).build()), 600)
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
    fun onResume() = view.onResume()
    fun onPause() = view.onPause()
    fun onStop() = view.onStop()
    fun onDestroy() = view.onDestroy()
    fun onLowMemory() = view.onLowMemory()
    fun onSaveInstanceState(bundle: Bundle) = view.onSaveInstanceState(bundle)
}
