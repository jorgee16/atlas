package com.atlas.nativeapp

import android.app.Application
import android.content.res.Configuration
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
import java.util.concurrent.Executors

data class AtlasState(
    val status: String = "",
    val notice: Long = 0,
    val results: List<JSONObject> = emptyList(),
    val exploreResults: List<JSONObject> = emptyList(),
    val searching: Boolean = false,
    val searchQuery: String = "",
    val searchError: String? = null,
    val nearby: Boolean = false,
    val category: String = "",
    val route: JSONObject? = null,
    val routeOptions: List<JSONObject> = emptyList(),
    val guidance: JSONObject? = null,
    val fix: Fix? = null,
    val destination: JSONObject? = null,
    val origin: Coordinate? = null,
    val navigating: Boolean = false,
    val arrived: Boolean = false,
    val walking: Boolean = false,
    val mode: String = "drive",
    val avoidTolls: Boolean = false,
    val busy: Boolean = false,
    val downloading: String? = null,
    val downloadPercent: Int = 0,
    val downloadError: String? = null,
    val tab: String = "Explore",
    val revision: Int = 0,
    val journeys: List<JSONObject> = emptyList(),
    val journey: JSONObject? = null,
    val journeyLeg: Int = -1
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
    private var searchGeneration = 0L
    private var routeGeneration = 0L
    private var lastSpoken = -1
    var speak: ((String) -> Unit)? = null
    var voice = prefs.getBoolean("voice", true)
        set(value) { field = value; prefs.edit().putBoolean("voice", value).apply(); refresh() }
    var theme: String
        get() = prefs.getString("theme", "system") ?: "system"
        set(value) { prefs.edit().putString("theme", value).apply() }
    val dark: Boolean get() = theme == "dark" || (theme == "system" &&
        (getApplication<Application>().resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES)
    var vehicleClass: Int
        get() = prefs.getInt("vehicle", 1)
        set(value) { require(value in 1..4); prefs.edit().putInt("vehicle", value).apply(); invalidateRoute() }
    var activeTrip: String
        get() = prefs.getString("activeTrip", "") ?: ""
        set(value) { prefs.edit().putString("activeTrip", value).apply(); refresh() }
    var activeDay: String
        get() = prefs.getString("activeDay", "") ?: ""
        set(value) { prefs.edit().putString("activeDay", value).apply(); refresh() }
    val anchor: Coordinate get() = state.value.origin ?: state.value.fix?.point ?: Coordinate(38.7223, -9.1393)
    fun refresh() { state.update { it.copy(revision = it.revision + 1) } }
    fun tab(tab: String) { state.update { it.copy(tab = tab) } }
    fun status(message: String) { state.update { it.copy(status = message, notice = it.notice + 1) } }
    private fun failure(error: Throwable) { if (error !is CancellationException) status(error.message ?: "Something went wrong. Try again.") }
    fun select(place: JSONObject) {
        stop()
        val item = JSONObject(place.toString()).apply { if (!has("id")) put("id", "pin:${getDouble("lat")},${getDouble("lon")}") }
        val recent = recents().filter { it.optString("id") != item.optString("id") }.toMutableList().apply { add(0, item) }.take(20)
        prefs.edit().putString("recents", JSONArray(recent).toString()).apply()
        state.update { it.copy(destination = item, tab = "Navigation", results = emptyList(), route = null,
            routeOptions = emptyList(), guidance = null, arrived = false, journeys = emptyList(), journey = null, journeyLeg = -1) }
    }
    fun clearDestination() { stop(); state.update { it.copy(destination = null, route = null, routeOptions = emptyList(), arrived = false) } }
    fun recents(): List<JSONObject> = storedArray("recents")
    fun origin(point: Coordinate?) { invalidateRoute(); state.update { it.copy(origin = point) } }
    fun mode(value: String) {
        require(value in listOf("drive", "walk", "transit")); invalidateRoute()
        state.update { it.copy(mode = value, walking = value == "walk") }
    }
    fun avoidTolls(value: Boolean) { invalidateRoute(); state.update { it.copy(avoidTolls = value) } }
    private fun invalidateRoute() { stop(); state.update { it.copy(route = null, routeOptions = emptyList(), arrived = false, journeys = emptyList(), journey = null, journeyLeg = -1) } }
    fun clearSearch() { searchJob?.cancel(); ++searchGeneration; state.update { it.copy(results = emptyList(), searching = false, searchQuery = "", searchError = null) } }
    fun search(text: String, nearby: Boolean = false, category: String = "", anchor: Coordinate = this.anchor) {
        searchJob?.cancel(); val generation = ++searchGeneration
        state.update { it.copy(searchQuery = text, nearby = nearby || it.nearby, category = if (nearby) category else it.category, searching = text.trim().length >= 2 || nearby, searchError = null) }
        if (text.trim().length < 2 && !nearby) { state.update { it.copy(results = emptyList()) }; return }
        searchJob = viewModelScope.launch {
            delay(if (nearby) 0 else 260)
            try {
                val results = withContext(worker) { core.search(regions.search(anchor).path); JSONArray(core.find(text, anchor, nearby, category)).objects() }
                if (searchGeneration == generation) state.update { it.copy(results = results, exploreResults = if (nearby) results else it.exploreResults, searching = false) }
            } catch (e: Throwable) {
                if (e !is CancellationException && searchGeneration == generation) state.update { it.copy(searching = false, results = emptyList(), searchError = e.message ?: "Search unavailable") }
            }
        }
    }
    fun calculate(startAfter: Boolean = false) {
        val snapshot = state.value
        val destination = snapshot.destination ?: return status("Choose a destination first")
        val from = snapshot.origin ?: snapshot.fix?.point ?: return status("Use your location or choose a starting point on the map")
        core.cancel(); routeJob?.cancel(); val generation = ++routeGeneration
        routeJob = viewModelScope.launch {
            state.update { it.copy(busy = true, arrived = false) }
            try {
                if (snapshot.mode == "transit") {
                    val journeys = TransitProvider().journeys(from, destination.coordinate())
                    state.update { it.copy(journeys = journeys, journey = journeys.firstOrNull(), journeyLeg = -1) }
                    if (journeys.isEmpty()) status("No public transport journeys found")
                    return@launch
                }
                val choices = withContext(worker) {
                    core.graph(regions.graph(from, destination.coordinate()).path)
                    val primary = JSONObject(core.route(from, destination.coordinate(), snapshot.walking, snapshot.avoidTolls, 0.0, vehicleClass))
                    core.remember(0); primary.put("key", 0).put("label", if (snapshot.avoidTolls) "Without tolls" else "Recommended")
                    val choices = mutableListOf(primary)
                    if (!snapshot.walking && !snapshot.avoidTolls && primary.optDouble("tollEuros") > 0) {
                        try {
                            val alternative = JSONObject(core.route(from, destination.coordinate(), false, true, 0.0, vehicleClass))
                            if (alternative.getJSONArray("edgeIndexes").toString() != primary.getJSONArray("edgeIndexes").toString()) {
                                core.remember(1); alternative.put("key", 1).put("label", "Without tolls"); choices.add(alternative)
                            }
                        } catch (e: IllegalStateException) { if (e.message?.contains("cancel", true) == true) throw e }
                    }
                    core.activate(0)
                    choices
                }
                if (generation == routeGeneration) {
                    lastSpoken = -1
                    state.update { it.copy(route = choices.first(), routeOptions = choices, guidance = null, navigating = startAfter && snapshot.origin == null) }
                }
            } catch (e: Throwable) { failure(e) }
            finally { if (generation == routeGeneration) state.update { it.copy(busy = false) } }
        }
    }
    fun chooseRoute(choice: JSONObject) { viewModelScope.launch {
        try { withContext(worker) { core.activate(choice.getInt("key")) }; state.update { it.copy(route = choice, guidance = null) } }
        catch (e: Throwable) { failure(e) }
    } }
    fun start() {
        if (state.value.origin != null) return status("This is a fixed preview. Choose My location for live navigation.")
        if (state.value.route == null) calculate(true)
        else { lastSpoken = -1; state.update { it.copy(navigating = true, arrived = false) } }
    }
    fun stop() { ++routeGeneration; core.cancel(); routeJob?.cancel(); progressJob?.cancel(); state.update { it.copy(navigating = false, guidance = null, busy = false) } }
    fun fix(fix: Fix) {
        if (progressJob?.isActive == true) return
        progressJob = viewModelScope.launch {
            try {
                val trusted = withContext(worker) { core.filter(fix) }
                state.update { it.copy(fix = trusted) }
                if (!state.value.navigating || state.value.busy) return@launch
                val result = withContext(worker) { JSONObject(core.update(trusted)) }
                state.update { it.copy(guidance = result) }
                val maneuver = result.getInt("maneuver")
                if (voice && maneuver != lastSpoken) {
                    state.value.route?.getJSONArray("maneuvers")?.optJSONObject(maneuver)?.let { speak?.invoke(it.getString("instruction")) }
                    lastSpoken = maneuver
                }
                when (result.getString("state")) {
                    "reroute" -> calculate(true)
                    "arrived" -> {
                        state.value.destination?.optString("id")?.takeIf { it.startsWith("trip:") }?.let { visited(it, true) }
                        stop(); state.update { it.copy(arrived = true) }
                    }
                }
            } catch (e: Throwable) { failure(e) }
        }
    }
    fun download(region: Region) {
        if (downloadJob?.isActive == true) return
        downloadJob = viewModelScope.launch {
            state.update { it.copy(downloading = region.id, downloadPercent = 0, downloadError = null) }
            try {
                var lastPercent = -1
                regions.install(region) { current, total ->
                    val percent = if (total > 0) (current * 100 / total).toInt().coerceIn(0, 100) else 0
                    if (percent != lastPercent) { lastPercent = percent; state.update { it.copy(downloadPercent = percent) } }
                }
                status("${region.name} is ready offline")
            } catch (e: Throwable) {
                if (e !is CancellationException) state.update { it.copy(downloadError = e.message ?: "Download failed. Try again.") }
            } finally { state.update { it.copy(downloading = null, revision = it.revision + 1) } }
        }
    }
    fun cancelDownload() { downloadJob?.cancel() }
    fun remove(region: Region) { viewModelScope.launch { try {
        stop(); withContext(worker) { regions.remove(region) }; refresh(); status("${region.name} removed")
    } catch (e: Throwable) { failure(e) } } }
    private fun storedArray(key: String): List<JSONObject> = try { JSONArray(prefs.getString(key, "[]")).objects() } catch (_: Exception) { emptyList() }
    fun bookmarks(): List<JSONObject> = storedArray("bookmarks")
    fun isSaved(place: JSONObject) = bookmarks().any { it.optString("id") == place.optString("id") }
    fun bookmark(place: JSONObject) {
        val wasSaved = isSaved(place)
        val list = bookmarks().filter { it.optString("id") != place.optString("id") }.toMutableList()
        if (!wasSaved) list.add(JSONObject(place.toString()))
        prefs.edit().putString("bookmarks", JSONArray(list).toString()).apply(); refresh(); status(if (wasSaved) "Place removed from saved" else "Place saved")
    }
    fun trips(): List<JSONObject> = storedArray("trips")
    fun tripId(trip: JSONObject): String = trip.optString("id").ifBlank { trip.optString("name", "trip") }
    fun importTrip(text: String) {
        require(text.toByteArray().size <= 10 * 1024 * 1024) { "Trip file is too large" }
        val doc = JSONObject(text); val trip = doc.getJSONObject("trip"); val days = trip.getJSONObject("days")
        for (day in days.keys()) for (place in days.getJSONArray(day).objects()) { require(place.getString("name").isNotBlank()); place.coordinate() }
        val id = tripId(trip)
        val list = trips().filter { tripId(it.getJSONObject("trip")) != id }.toMutableList(); list.add(doc)
        prefs.edit().putString("trips", JSONArray(list).toString()).putString("activeTrip", id).putString("activeDay", days.keys().asSequence().firstOrNull() ?: "").apply()
        refresh(); status("${trip.optString("name", "Trip")} imported")
    }
    fun removeTrip(id: String) { prefs.edit().putString("trips", JSONArray(trips().filter { tripId(it.getJSONObject("trip")) != id }).toString()).apply(); refresh() }
    fun visited(id: String) = prefs.getBoolean("visited:$id", false)
    fun visited(id: String, value: Boolean) { prefs.edit().putBoolean("visited:$id", value).apply(); refresh() }
    fun tripPlaces(): List<JSONObject> {
        val trip = trips().firstOrNull { tripId(it.getJSONObject("trip")) == activeTrip }?.getJSONObject("trip") ?: trips().firstOrNull()?.getJSONObject("trip") ?: return emptyList()
        val days = trip.getJSONObject("days"); val day = activeDay.takeIf { days.has(it) } ?: days.keys().asSequence().firstOrNull() ?: return emptyList()
        return days.getJSONArray(day).objects().mapIndexed { index, item -> JSONObject(item.toString()).put("id", "trip:${tripId(trip)}:$day:$index") }
    }
    fun nextTripStop(): JSONObject? = tripPlaces().firstOrNull { !visited(it.getString("id")) }
    fun startJourney(journey: JSONObject) { state.update { it.copy(journey = journey, journeyLeg = 0) } }
    fun journeyLeg(index: Int) { state.update { it.copy(journeyLeg = index) } }
    override fun onCleared() {
        speak = null
        kotlinx.coroutines.CoroutineScope(worker).launch { core.close(); worker.close() }
    }
}
