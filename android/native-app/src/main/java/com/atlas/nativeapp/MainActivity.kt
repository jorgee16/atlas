package com.atlas.nativeapp

import android.Manifest
import android.app.AlertDialog
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.annotations.MarkerOptions
import org.maplibre.android.annotations.PolylineOptions
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import java.util.Locale

@Suppress("DEPRECATION")
class MainActivity : ComponentActivity(), LocationListener {
    private val model: AtlasModel by viewModels()
    private lateinit var mapView: MapView
    private var map: MapLibreMap? = null
    private lateinit var status: TextView
    private lateinit var banner: TextView
    private lateinit var summary: TextView
    private lateinit var query: EditText
    private lateinit var results: LinearLayout
    private lateinit var tabs: LinearLayout
    private lateinit var planner: LinearLayout
    private lateinit var action: Button
    private lateinit var routeButton: Button
    private var follow = true
    private var headingUp = true
    private var voice: TextToSpeech? = null
    private var voiceReady = false
    private var lastRoute: JSONObject? = null
    private var lastDestination: JSONObject? = null
    private var lastResults: List<JSONObject>? = null
    private var mapPath = ""
    private var currentTab = ""
    private var lastFixTime = -1.0
    private var lastBearing = 0.0
    private var vehicle: org.maplibre.android.annotations.Marker? = null
    private val manager by lazy { getSystemService(LOCATION_SERVICE) as LocationManager }
    private val permission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { startGps() }
    private val importTrip = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) lifecycleScope.launch {
            try {
                val text = withContext(Dispatchers.IO) { contentResolver.openInputStream(uri)!!.use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (output.size() <= 10 * 1024 * 1024) { val n = input.read(buffer); if (n < 0) break; output.write(buffer, 0, n) }
                    val bytes = output.toByteArray()
                    require(bytes.size <= 10 * 1024 * 1024) { "Trip file is too large" }
                    bytes.toString(Charsets.UTF_8)
                } }
                model.importTrip(text); showTrips()
            } catch (e: Exception) { model.status(e.message ?: "Could not import trip") }
        }
    }
    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun label(text: String, size: Float = 15f) = TextView(this).apply {
        this.text = text; textSize = size; setTextColor(Color.rgb(22, 42, 66)); setPadding(dp(12), dp(8), dp(12), dp(8))
    }
    private fun button(text: String, click: () -> Unit) = Button(this).apply { this.text = text; isAllCaps = false; setOnClickListener { click() } }
    private fun row() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    private fun column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        MapLibre.getInstance(this)
        val root = android.widget.FrameLayout(this)
        root.setOnApplyWindowInsetsListener { view, insets -> view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom); insets }
        mapView = MapView(this); mapView.onCreate(savedInstanceState)
        root.addView(mapView, android.widget.FrameLayout.LayoutParams(-1, -1))
        val top = column().apply { setBackgroundColor(Color.rgb(245, 248, 252)); elevation = dp(4).toFloat() }
        val search = row()
        query = EditText(this).apply {
            hint = "Where to?"; setSingleLine(true); textSize = 17f
            setOnEditorActionListener { _, _, _ -> model.search(text.toString()); true }
        }
        search.addView(query, LinearLayout.LayoutParams(0, dp(52), 1f))
        search.addView(button("Search") { model.search(query.text.toString()); hideKeyboard() })
        search.addView(button("⋮") { showMenu() })
        top.addView(search)
        banner = label("", 21f).apply { visibility = View.GONE; setBackgroundColor(Color.rgb(18, 44, 73)); setTextColor(Color.WHITE) }
        top.addView(banner)
        results = column()
        top.addView(results)
        root.addView(top, android.widget.FrameLayout.LayoutParams(-1, -2, Gravity.TOP))
        val bottom = column().apply { setBackgroundColor(Color.rgb(245, 248, 252)); elevation = dp(4).toFloat() }
        val mapControls = row()
        mapControls.addView(button("GPS") { follow = true; model.updates.value.fix?.let { center(it.point) } })
        mapControls.addView(button("Follow") { follow = !follow; model.status(if (follow) "Follow on" else "Follow paused") })
        mapControls.addView(button("Compass") { headingUp = !headingUp; if (!headingUp) map?.animateCamera(CameraUpdateFactory.bearingTo(0.0)) })
        mapControls.addView(button("Nearby") { model.search("", nearby = true) })
        bottom.addView(mapControls)
        planner = column()
        summary = label("Choose a destination on the map or search above", 16f); planner.addView(summary)
        val options = row()
        options.addView(button("Car / Walk") { val s = model.updates.value; model.options(!s.walking, s.avoidTolls) })
        options.addView(button("Tolls") { val s = model.updates.value; model.options(s.walking, !s.avoidTolls) })
        options.addView(button("Origin") { AlertDialog.Builder(this).setTitle("Route origin").setItems(arrayOf("My location", "Choose on map")) { _, which ->
            if (which == 0) model.origin(null) else model.status("Long-press the map and choose Set origin")
        }.show() })
        planner.addView(options)
        val actions = row()
        routeButton = button("Calculate") { model.calculate() }; actions.addView(routeButton, LinearLayout.LayoutParams(0, -2, 1f))
        action = button("Start") { if (model.updates.value.navigating) {
            AlertDialog.Builder(this).setMessage("End navigation?").setPositiveButton("End") { _, _ -> model.stop() }.setNegativeButton("Continue", null).show()
        } else model.start() }
        actions.addView(action, LinearLayout.LayoutParams(0, -2, 1f)); planner.addView(actions)
        bottom.addView(planner)
        status = label("", 12f); bottom.addView(status)
        tabs = row()
        for (name in listOf("Explore", "Trip", "Navigation")) tabs.addView(button(name) {
            model.tab(name); if (name == "Trip") showTrips()
        }, LinearLayout.LayoutParams(0, -2, 1f))
        bottom.addView(tabs)
        root.addView(bottom, android.widget.FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        setContentView(root)
        mapView.getMapAsync { ready ->
            map = ready
            ready.addOnMapLongClickListener { p ->
                val place = JSONObject().put("id", "pin:${p.latitude},${p.longitude}").put("name", "Selected location").put("lat", p.latitude).put("lon", p.longitude)
                AlertDialog.Builder(this).setTitle("Selected location").setItems(arrayOf("Navigate here", "Set origin", "Save place")) { _, index ->
                    when (index) { 0 -> model.select(place); 1 -> model.origin(place.coordinate()); 2 -> model.bookmark(place) }
                }.show(); true
            }
            ready.addOnCameraMoveStartedListener { reason -> if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) follow = false }
            loadStyle(model.anchor, force = true)
            center(model.anchor, 12.0)
        }
        voice = TextToSpeech(this) { result ->
            voiceReady = result == TextToSpeech.SUCCESS
            if (voiceReady) voice?.language = Locale.UK
        }
        model.speak = { text -> if (voiceReady) voice?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "atlas-maneuver") }
        lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.STARTED) { model.updates.collect { render(it) } } }
        if (hasLocation()) startGps() else permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }
    private fun hideKeyboard() { (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(query.windowToken, 0); query.clearFocus() }
    private fun render(s: AtlasState) {
        status.text = if (s.downloading != null) "Downloading ${s.downloading}: ${s.downloadPercent}%" else s.status
        planner.visibility = if (s.tab == "Navigation" || s.navigating) View.VISIBLE else View.GONE
        tabs.visibility = if (s.navigating) View.GONE else View.VISIBLE
        query.visibility = if (s.navigating) View.GONE else View.VISIBLE
        banner.visibility = if (s.navigating) View.VISIBLE else View.GONE
        routeButton.isEnabled = !s.busy
        routeButton.visibility = if (s.navigating) View.GONE else View.VISIBLE
        action.text = if (s.navigating) "End" else "Start"
        val route = s.route
        if (route != null) {
            val guidance = s.guidance
            val meters = guidance?.optDouble("remaining") ?: route.getDouble("distanceMeters")
            val seconds = guidance?.optDouble("seconds") ?: route.getDouble("durationSeconds")
            val eta = java.text.SimpleDateFormat("HH:mm", Locale.getDefault()).format(java.util.Date(System.currentTimeMillis() + (seconds * 1000).toLong()))
            summary.text = "${s.destination?.optString("name")} · ${"%.1f".format(meters / 1000)} km · ${kotlin.math.ceil(seconds / 60).toInt()} min · $eta\n" +
                (if (s.walking) "Walking" else "Driving") + (if (s.avoidTolls) " · Avoid tolls" else " · Estimated tolls €${"%.2f".format(route.getDouble("tollEuros"))}")
            val index = guidance?.optInt("maneuver") ?: 0
            val m = route.getJSONArray("maneuvers").optJSONObject(index)
            banner.text = "${m?.optString("instruction") ?: "Continue"}\n${guidance?.optDouble("toManeuver")?.toInt() ?: 0} m"
        } else summary.text = (s.destination?.optString("name") ?: "Choose a destination") + "\n" +
            (if (s.walking) "Walking" else "Driving") + (if (s.origin == null) " · My location" else " · Fixed origin") + (if (s.avoidTolls) " · Avoid tolls" else "")
        if (s.navigating) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (lastResults !== s.results) {
            lastResults = s.results; results.removeAllViews()
            for (place in s.results.take(3)) results.addView(button(place.getString("name")) { model.select(place); center(place.coordinate()); hideKeyboard() })
            if (s.results.size > 3) results.addView(button("See all ${s.results.size} places") { showPlaces(s.results) })
        }
        if (lastRoute !== s.route || lastDestination !== s.destination) { lastRoute = s.route; lastDestination = s.destination; drawRoute(s); if (s.destination !== null && !s.navigating && s.route == null) center(s.destination.coordinate()) }
        val fix = s.fix
        if (fix != null) {
            val display = if (s.navigating && s.guidance != null && s.guidance.optDouble("offRoute") < 100) s.guidance.coordinate() else fix.point
            val position = LatLng(display.lat, display.lon)
            if (vehicle == null) vehicle = map?.addMarker(MarkerOptions().position(position).title("Your location"))
            else vehicle?.position = position
        }
        if (fix != null && fix.time != lastFixTime) {
            lastFixTime = fix.time
            loadStyle(fix.point)
            val display = if (s.navigating && s.guidance != null && s.guidance.optDouble("offRoute") < 100) s.guidance.coordinate() else fix.point
            if (follow) {
                fix.bearing?.let { next -> val delta = (next - lastBearing + 540) % 360 - 180; lastBearing = (lastBearing + .35 * delta + 360) % 360 }
                val camera = CameraPosition.Builder().target(LatLng(display.lat, display.lon)).zoom(if (s.navigating) 16.5 else 14.0)
                    .bearing(if (headingUp) lastBearing else 0.0).tilt(if (s.navigating) 40.0 else 0.0).build()
                map?.animateCamera(CameraUpdateFactory.newCameraPosition(camera), 500)
            }
        }
        if (currentTab != s.tab) { currentTab = s.tab; query.hint = if (s.tab == "Navigation") "Where to?" else "Search places" }
    }
    private fun center(p: Coordinate, zoom: Double = 15.0) { map?.animateCamera(CameraUpdateFactory.newLatLngZoom(LatLng(p.lat, p.lon), zoom)) }
    private fun drawRoute(s: AtlasState) {
        val ready = map ?: return
        ready.clear()
        vehicle = null
        s.destination?.let { ready.addMarker(MarkerOptions().position(LatLng(it.getDouble("lat"), it.getDouble("lon"))).title(it.optString("name"))) }
        s.route?.getJSONArray("points")?.let { points ->
            val line = PolylineOptions().color(Color.rgb(37, 99, 235)).width(6f)
            for (i in 0 until points.length()) { val p = points.getJSONArray(i); line.add(LatLng(p.getDouble(1), p.getDouble(0))) }
            ready.addPolyline(line)
        }
    }
    private fun loadStyle(point: Coordinate, force: Boolean = false) {
        val file = model.regions.map(point)
        val path = file?.absolutePath ?: "online"
        if (!force && path == mapPath) return
        mapPath = path
        val vector = if (file != null) """"sources":{"atlas":{"type":"vector","url":${JSONObject.quote("pmtiles://file://" + file.absolutePath)}}},"layers":[
            {"id":"background","type":"background","paint":{"background-color":"#f1efe9"}},
            {"id":"water","type":"fill","source":"atlas","source-layer":"water","paint":{"fill-color":"#a9d8ed"}},
            {"id":"landcover","type":"fill","source":"atlas","source-layer":"landcover","paint":{"fill-color":"#d5e5c5"}},
            {"id":"buildings","type":"fill","source":"atlas","source-layer":"building","paint":{"fill-color":"#ded8ce"}},
            {"id":"roads","type":"line","source":"atlas","source-layer":"transportation","paint":{"line-color":"#ffffff","line-width":3}}
        ]""" else """"sources":{"osm":{"type":"raster","tiles":["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],"tileSize":256,"attribution":"© OpenStreetMap contributors"}},"layers":[{"id":"osm","type":"raster","source":"osm"}]"""
        map?.setStyle(Style.Builder().fromJson("""{"version":8,$vector}""")) { drawRoute(model.updates.value) }
    }
    private fun showPlaces(places: List<JSONObject>) { AlertDialog.Builder(this).setTitle("Places").setItems(places.map { it.optString("name") }.toTypedArray()) { _, i -> model.select(places[i]); center(places[i].coordinate()) }.setNegativeButton("Close", null).show() }
    private fun showMenu() {
        val items = arrayOf("Offline regions", "Saved places", "Trips", "Public transport", if (model.voice) "Mute voice" else "Enable voice", "Nearby categories")
        AlertDialog.Builder(this).setItems(items) { _, which -> when (which) {
            0 -> showRegions(); 1 -> showBookmarks(); 2 -> showTrips(); 3 -> showTransit(); 4 -> { model.voice = !model.voice }; 5 -> {
                val cats = arrayOf("cafe", "restaurant", "pub", "museum", "park", "shop")
                AlertDialog.Builder(this).setTitle("Nearby").setItems(cats) { _, i -> model.search("", true, cats[i]) }.show()
            }
        } }.show()
    }
    private fun showTransit() {
        val destination = model.updates.value.destination ?: return model.status("Choose a destination first")
        lifecycleScope.launch {
            model.status("Loading public transport journeys…")
            try {
                val provider = TransitProvider()
                val journeys = provider.journeys(model.anchor, destination.coordinate())
                AlertDialog.Builder(this@MainActivity).setTitle("Public transport · London")
                    .setItems(journeys.map(provider::summary).toTypedArray()) { _, index ->
                        AlertDialog.Builder(this@MainActivity).setTitle(provider.summary(journeys[index]))
                            .setMessage(provider.instructions(journeys[index]).joinToString("\n\n"))
                            .setPositiveButton("Close", null).show()
                    }.setNegativeButton("Close", null).show()
                model.status("${journeys.size} public transport journeys")
            } catch (e: Exception) { model.status(e.message ?: "Public transport unavailable") }
        }
    }
    private fun showRegions() {
        val regions = model.regions.regions
        AlertDialog.Builder(this).setTitle("Offline regions").setItems(regions.map { r -> "${r.name} · ${r.bytes / 1024 / 1024} MB · " + when (model.regions.installedVersion(r)) { r.version -> "Ready"; null -> "Download"; else -> "Update" } }.toTypedArray()) { _, index ->
            val r = regions[index]
            AlertDialog.Builder(this).setTitle(r.name).setMessage("${r.bytes / 1024 / 1024} MB · v${r.version}")
                .setPositiveButton("Download / update") { _, _ -> model.download(r) }
                .setNeutralButton("Remove") { _, _ -> AlertDialog.Builder(this).setMessage("Remove ${r.name} offline data?").setPositiveButton("Remove") { _, _ -> model.remove(r) }.setNegativeButton("Cancel", null).show() }
                .setNegativeButton("Close", null).show()
        }.setNeutralButton("Cancel download") { _, _ -> model.cancelDownload() }.setNegativeButton("Close", null).show()
    }
    private fun showBookmarks() {
        val places = model.bookmarks()
        AlertDialog.Builder(this).setTitle("Saved places").setItems(places.map { it.optString("name") }.toTypedArray()) { _, i ->
            AlertDialog.Builder(this).setTitle(places[i].optString("name")).setPositiveButton("Navigate") { _, _ -> model.select(places[i]) }.setNeutralButton("Remove") { _, _ -> model.removeBookmark(places[i]) }.setNegativeButton("Close", null).show()
        }.setNegativeButton("Close", null).show()
    }
    private fun showTrips() {
        val trips = model.trips()
        AlertDialog.Builder(this).setTitle("Your trips").setItems(trips.map { it.getJSONObject("trip").optString("name", "Trip") }.toTypedArray()) { _, i ->
            val days = trips[i].getJSONObject("trip").getJSONObject("days")
            val keys = days.keys().asSequence().toList()
            AlertDialog.Builder(this).setTitle("Days").setItems(keys.map { "Day $it" }.toTypedArray()) { _, day -> showPlaces(days.getJSONArray(keys[day]).objects().mapIndexed { n, place -> JSONObject(place.toString()).put("id", "trip:$i:${keys[day]}:$n") }) }.show()
        }.setPositiveButton("Import JSON") { _, _ -> importTrip.launch(arrayOf("application/json", "text/*")) }
            .setNegativeButton("Close", null).show()
    }
    private fun hasLocation() = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    private fun startGps() {
        if (!hasLocation()) { model.status("Location permission is needed for live guidance. Map selection still works."); return }
        try {
            for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) if (manager.isProviderEnabled(provider)) manager.requestLocationUpdates(provider, 1000L, 0f, this)
        } catch (e: SecurityException) { model.status("Location permission unavailable") }
    }
    override fun onLocationChanged(location: Location) {
        val previous = model.updates.value.fix
        val point = Coordinate(location.latitude, location.longitude)
        val time = location.elapsedRealtimeNanos / 1e9
        // Native progress owns route projection; reject stale and implausible jumps before presentation.
        if (previous != null && time <= previous.time) return
        val speed = if (location.hasSpeed()) location.speed.toDouble().coerceAtLeast(0.0) else 0.0
        val heading = if (location.hasBearing() && speed > .55) location.bearing.toDouble() else previous?.bearing
        model.fix(Fix(point, if (location.hasAccuracy()) location.accuracy.toDouble().coerceAtLeast(0.0) else 100.0, speed, heading, time))
    }
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) { model.status("GPS provider unavailable") }
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onStart() { super.onStart(); mapView.onStart(); startGps() }
    override fun onResume() { super.onResume(); mapView.onResume() }
    override fun onPause() { mapView.onPause(); super.onPause() }
    override fun onStop() { manager.removeUpdates(this); mapView.onStop(); super.onStop() }
    override fun onLowMemory() { super.onLowMemory(); mapView.onLowMemory() }
    override fun onSaveInstanceState(outState: Bundle) { super.onSaveInstanceState(outState); mapView.onSaveInstanceState(outState) }
    override fun onDestroy() { model.speak = null; voice?.stop(); voice?.shutdown(); mapView.onDestroy(); super.onDestroy() }
}
