package com.atlas.nativeapp

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

data class AtlasState(
    val status: String = "Explore, plan a trip, or download an offline region",
    val results: List<JSONObject> = emptyList(),
    val route: JSONObject? = null,
    val guidance: JSONObject? = null,
    val fix: Fix? = null,
    val destination: JSONObject? = null,
    val origin: Coordinate? = null,
    val navigating: Boolean = false,
    val walking: Boolean = false,
    val avoidTolls: Boolean = false,
    val busy: Boolean = false,
    val downloading: String? = null,
    val downloadPercent: Int = 0,
    val tab: String = "Explore"
)
class AtlasModel(application: Application) : AndroidViewModel(application) {
    val regions = RegionStore(application)
    private val worker = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val core = NativeCore()
    private val state = MutableStateFlow(AtlasState())
    val updates = state.asStateFlow()
    private val prefs = application.getSharedPreferences("atlas-native", 0)
    private var searchJob: Job? = null
    private var downloadJob: Job? = null
    private var routeJob: Job? = null
    private var progressJob: Job? = null
    private var request = 0L
    private var lastSpoken = -1
    var voice = prefs.getBoolean("voice", true)
        set(value) { field = value; prefs.edit().putBoolean("voice", value).apply() }
    var speak: ((String) -> Unit)? = null
    val anchor: Coordinate get() = state.value.origin ?: state.value.fix?.point ?: Coordinate(38.7223, -9.1393)
    fun tab(tab: String) { state.value = state.value.copy(tab = tab, results = emptyList()) }
    fun status(message: String) { state.value = state.value.copy(status = message) }
    private fun failure(error: Throwable) { if (error !is CancellationException) status(error.message ?: "Operation failed") }
    fun select(place: JSONObject) { state.value = state.value.copy(destination = place, tab = "Navigation", results = emptyList(), navigating = false, route = null, guidance = null) }
    fun origin(point: Coordinate?) { stop(); state.value = state.value.copy(origin = point) }
    fun options(walk: Boolean, avoid: Boolean) { stop(); state.value = state.value.copy(walking = walk, avoidTolls = avoid) }
    fun search(text: String, nearby: Boolean = false, category: String = "") {
        searchJob?.cancel(); val generation = ++request
        if (text.trim().length < 2 && !nearby) { state.value = state.value.copy(results = emptyList()); return }
        searchJob = viewModelScope.launch {
            delay(if (nearby) 0 else 280)
            try {
                val at = anchor
                val results = withContext(worker) { core.search(regions.search(at).path); JSONArray(core.find(text, at, nearby, category)).objects() }
                if (request == generation) state.value = state.value.copy(results = results, status = "${results.size} places")
            } catch (e: Throwable) { failure(e) }
        }
    }
    fun calculate(startAfter: Boolean = false) {
        val destination = state.value.destination ?: return status("Choose a destination")
        val from = state.value.origin ?: state.value.fix?.point ?: return status("Wait for GPS, or choose an origin on the map")
        val walking = state.value.walking; val avoid = state.value.avoidTolls
        core.cancel(); routeJob?.cancel()
        routeJob = viewModelScope.launch {
            state.value = state.value.copy(busy = true, status = "Calculating offline route…")
            try {
                val result = withContext(worker) {
                    core.graph(regions.graph(from, destination.coordinate()).path)
                    JSONObject(core.route(from, destination.coordinate(), walking, avoid, 0.0, 1))
                }
                val active = startAfter && state.value.origin == null
                state.value = state.value.copy(route = result, guidance = null, navigating = active, status = "Route ready")
                lastSpoken = -1
            } catch (e: Throwable) { failure(e) }
            finally { state.value = state.value.copy(busy = false) }
        }
    }
    fun start() {
        if (state.value.origin != null) return status("This is a fixed preview. Use My location to start live guidance.")
        if (state.value.route == null) calculate(true)
        else state.value = state.value.copy(navigating = true, status = "Navigation started")
    }
    fun stop() { core.cancel(); routeJob?.cancel(); progressJob?.cancel(); state.value = state.value.copy(navigating = false, guidance = null, busy = false) }
    fun fix(fix: Fix) {
        if (progressJob?.isActive == true) return
        progressJob = viewModelScope.launch {
            try {
                val trusted = withContext(worker) { core.filter(fix) }
                state.value = state.value.copy(fix = trusted)
                if (!state.value.navigating || state.value.busy) return@launch
                val result = withContext(worker) { JSONObject(core.update(trusted)) }
                state.value = state.value.copy(guidance = result)
                val maneuver = result.getInt("maneuver")
                if (voice && maneuver != lastSpoken) {
                    state.value.route?.getJSONArray("maneuvers")?.optJSONObject(maneuver)?.let { speak?.invoke(it.getString("instruction")) }
                    lastSpoken = maneuver
                }
                when (result.getString("state")) {
                    "reroute" -> calculate(true)
                    "arrived" -> { stop(); status("You have arrived") }
                    "reduced" -> status("GPS accuracy reduced")
                    "checking" -> status("Checking route…")
                    else -> status("Following route")
                }
            } catch (e: Throwable) { failure(e) }
        }
    }
    fun download(region: Region) {
        if (downloadJob?.isActive == true) return
        downloadJob = viewModelScope.launch {
            state.value = state.value.copy(downloading = region.id, downloadPercent = 0)
            try {
                var lastPercent = -1
                regions.install(region) { current, total ->
                    val percent = if (total > 0) (current * 100 / total).toInt() else 0
                    if (percent != lastPercent) { lastPercent = percent; state.update { it.copy(downloadPercent = percent) } }
                }
                status("${region.name} ready offline")
            } catch (e: Throwable) { failure(e) }
            finally { state.value = state.value.copy(downloading = null) }
        }
    }
    fun cancelDownload() { downloadJob?.cancel() }
    fun remove(region: Region) { viewModelScope.launch { try { stop(); withContext(worker) { regions.remove(region) }; status("${region.name} removed") } catch (e: Throwable) { failure(e) } } }
    fun bookmarks(): List<JSONObject> = JSONArray(prefs.getString("bookmarks", "[]")).objects()
    fun bookmark(place: JSONObject) {
        val list = bookmarks().filter { it.optString("id") != place.optString("id") }.toMutableList(); list.add(place)
        prefs.edit().putString("bookmarks", JSONArray(list).toString()).apply(); status("Place saved")
    }
    fun removeBookmark(place: JSONObject) { prefs.edit().putString("bookmarks", JSONArray(bookmarks().filter { it.optString("id") != place.optString("id") }).toString()).apply(); status("Saved place removed") }
    fun trips(): List<JSONObject> = JSONArray(prefs.getString("trips", "[]")).objects()
    fun importTrip(text: String) {
        require(text.toByteArray().size <= 10 * 1024 * 1024) { "Trip file is too large" }
        val doc = JSONObject(text); val trip = doc.getJSONObject("trip"); val days = trip.getJSONObject("days")
        for (day in days.keys()) for (place in days.getJSONArray(day).objects()) { require(place.getString("name").isNotBlank()); place.coordinate() }
        val id = trip.optString("id").ifBlank { trip.optString("name", "trip") }
        val list = trips().filter { it.getJSONObject("trip").optString("id", it.getJSONObject("trip").optString("name", "trip")) != id }.toMutableList(); list.add(doc)
        prefs.edit().putString("trips", JSONArray(list).toString()).apply(); status("Trip imported")
    }
    override fun onCleared() {
        speak = null
        // All queued native operations finish before handle destruction.
        val scope = kotlinx.coroutines.CoroutineScope(worker)
        scope.launch { core.close(); worker.close() }
    }
}
