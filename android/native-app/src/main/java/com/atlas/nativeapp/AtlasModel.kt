package com.atlas.nativeapp

import android.app.Application
import android.content.res.Configuration
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
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
    // Previous real, native-filtered fix stays available across background
    // navigation: the map can validate a pair of observations on resume.
    val previousFix: Fix? = null,
    // Accepted REAL fixes per second (10s rolling window), never 30Hz drawing frames.
    val gpsHz: Double = 0.0,
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
    val journeyLeg: Int = -1,
    val journeyPhase: String = "",
    val journeyHistory: JSONArray = JSONArray()
)

/** End means discard the active itinerary; cancelling a calculation does not. */
internal fun AtlasState.afterEndingNavigation(): AtlasState = copy(
    destination = null,
    origin = null,
    route = null,
    routeOptions = emptyList(),
    guidance = null,
    navigating = false,
    arrived = false,
    busy = false,
    journeys = emptyList(),
    journey = null,
    journeyLeg = -1,
    journeyPhase = "",
    tab = "Explore"
)

class AtlasModel(application: Application) : AndroidViewModel(application) {
    val regions = RegionStore(application)
    private val worker = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val core = NativeCore()
    private val state = MutableStateFlow(AtlasState())
    val updates = state.asStateFlow()
    private val prefs = application.getSharedPreferences("atlas-native", 0)
    private val workManager = androidx.work.WorkManager.getInstance(application)
    private var workMonitor: Job? = null
    private val navigationSnapshotKey = "active-navigation-snapshot"
    /** A saved target is never treated as an active route until C++ replans it. */
    val canResumePreviousNavigation: Boolean
        get() = !state.value.navigating && prefs.contains(navigationSnapshotKey)
    fun discardPreviousNavigation() {
        prefs.edit().remove(navigationSnapshotKey).commit()
        refresh()
    }
    private fun recordNavigation() {
        val s=state.value
        val destination=s.destination ?: return
        if (!s.navigating || s.mode=="transit") return
        val snapshot=JSONObject()
            .put("version",1)
            .put("destination",JSONObject(destination.toString()))
            .put("mode",s.mode)
            .put("avoidTolls",s.avoidTolls)
            .put("timestamp",System.currentTimeMillis())
        prefs.edit().putString(navigationSnapshotKey,snapshot.toString()).commit()
    }
    fun resumePreviousNavigation() {
        val snapshot=try { JSONObject(prefs.getString(navigationSnapshotKey,"") ?: "") }
            catch (_:Exception) { discardPreviousNavigation();return status("Previous trip is invalid") }
        val destination=try { snapshot.getJSONObject("destination") }
            catch (_:Exception) { discardPreviousNavigation();return status("Previous trip is invalid") }
        if (!destination.has("lat") || !destination.has("lon") ||
            !destination.getDouble("lat").isFinite() || !destination.getDouble("lon").isFinite()) {
            discardPreviousNavigation()
            return status("Saved destination has invalid coordinates")
        }
        val now=android.os.SystemClock.elapsedRealtimeNanos()/1e9
        val fix=state.value.fix
        if (fix==null || !NavigationStartPolicy.freshFix(now,fix.time,fix.accuracy,15.0)) {
            return status("Waiting for a recent GPS fix. Try Resume again shortly.")
        }
        val requestedMode=snapshot.optString("mode","drive").takeIf { it in listOf("drive","walk") }?:"drive"
        stop()
        state.update { it.copy(
            destination=destination, origin=null, mode=requestedMode,
            walking=requestedMode=="walk", avoidTolls=snapshot.optBoolean("avoidTolls",false),
            route=null, routeOptions=emptyList(), guidance=null,
            navigating=false, tab="Navigation", arrived=false
        ) }
        calculate(true) // graph and guidance are rebuilt; never reuse stale JNI state.
    }
    private var lastCatalogCheckMs = 0L
    private var searchJob: Job? = null
    private var downloadJob: Job? = null
    init { observeRegionWork() }
    private var routeJob: Job? = null
    // Conflated channel retains the newest GPS fix instead of discarding it
    // when JNI processing temporarily falls behind the Android location rate.
    private val locationFixes = Channel<Fix>(Channel.CONFLATED)
    private var lastQueuedFixTime = Double.NEGATIVE_INFINITY
    private val recentRealFixTimes = java.util.ArrayDeque<Double>()
    // The preview may have been planned minutes before Start was pressed.
    // Keep the origin used for graph calculation rather than assuming that
    // the selected route still starts near the vehicle.
    private var preparedLiveRouteOrigin: Coordinate? = null
    private var preparedLiveRouteHeading: Double? = null
    private var navigationRevision = 0L
    private val fixPump = viewModelScope.launch {
        for (next in locationFixes) {
            try { processLocationFix(next) }
            catch (e: Throwable) { failure(e) }
        }
    }
    private var searchGeneration = 0L
    private var routeGeneration = 0L
    private var lastSpoken = -1
    private var journeyExecution: TransitExecution? = null
    private var enrichmentJob: Job? = null
    var speak: ((String) -> Unit)? = null
    var diagnosticsEnabled: Boolean
        get() = prefs.getBoolean("diagnosticsEnabled",false)
        set(value) {
            prefs.edit().putBoolean("diagnosticsEnabled",value).apply()
            refresh()
        }
    var voice = prefs.getBoolean("voice", true)
        set(value) { field = value; prefs.edit().putBoolean("voice", value).apply(); refresh() }
    var theme: String
        get() = prefs.getString("theme", "system") ?: "system"
        set(value) { prefs.edit().putString("theme", value).apply() }
    var mapSourceMode: String
        get() = prefs.getString("mapSourceMode", MapSourcePolicy.AUTO)
            ?.takeIf(MapSourcePolicy::isValid) ?: MapSourcePolicy.AUTO
        set(value) {
            require(MapSourcePolicy.isValid(value))
            if (mapSourceMode != value) {
                prefs.edit().putString("mapSourceMode", value).apply()
                refresh()
            }
        }
    var mapVisualStyle: String
        get()=prefs.getString("mapVisualStyle",MapVisualStyle.STREETS)
            ?.takeIf(MapVisualStyle::valid)?:MapVisualStyle.STREETS
        set(value){
            require(MapVisualStyle.valid(value))
            if(mapVisualStyle!=value){
                prefs.edit().putString("mapVisualStyle",value).apply()
                refresh()
            }
        }
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
    fun refreshRegionCatalog(force: Boolean = false) {
        val now = android.os.SystemClock.elapsedRealtime()
        if (!force && now-lastCatalogCheckMs < 15L*60*1000) return
        lastCatalogCheckMs=now
        viewModelScope.launch {
            try {
                val updated=regions.refreshCatalog()
                if (updated) refresh()
                if (force) status(if (updated) "Region catalog updated" else "Regions already up to date")
            } catch (e: Exception) {
                if (force) failure(e)
            }
        }
    }
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
    private fun invalidateRoute() { preparedLiveRouteOrigin=null;preparedLiveRouteHeading=null; stop(); state.update { it.copy(route = null, routeOptions = emptyList(), arrived = false, journeys = emptyList(), journey = null, journeyLeg = -1) } }
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
    fun calculate(startAfter: Boolean = false, directionalReroute: Boolean = false) {
        val snapshot = state.value
        val destination = snapshot.destination ?: return status("Choose a destination first")
        val from = snapshot.origin ?: snapshot.fix?.point ?: return status("Use your location or choose a starting point on the map")
        core.cancel(); routeJob?.cancel()
        val generation = ++routeGeneration
        ++navigationRevision
        routeJob = viewModelScope.launch {
            state.update { it.copy(busy = true, arrived = false) }
            try {
                if (snapshot.mode == "transit") {
                    val journeys = TransitProvider().journeys(from, destination.coordinate())
                    if(generation!=routeGeneration)return@launch
                    state.update { it.copy(journeys = journeys, journey = journeys.firstOrNull(), journeyLeg = -1) }
                    if (journeys.isEmpty()) status("No public transport journeys found")
                    return@launch
                }
                // The user can continue driving while the button action waits
                // for the native worker: sample the latest FILTERED GPS fix
                // INSIDE the worker before launching graph routing.
                val (choices,liveOrigin,routingHeading) = withContext(worker) {
                    val routingFix=if(snapshot.origin==null)state.value.fix else null
                    val liveOrigin=if(snapshot.origin==null)routingFix?.point ?: from else from
                    val enforceDirection = directionalReroute && snapshot.origin == null &&
                        !snapshot.walking
                    val routingHeading=when {
                        enforceDirection -> NavigationStartPolicy.rerouteHeading(
                            routingFix, state.value.previousFix,
                            android.os.SystemClock.elapsedRealtimeNanos() / 1e9)
                        snapshot.origin==null && !snapshot.walking ->
                            NavigationStartPolicy.movingHeading(routingFix)
                        else -> null
                    }
                    if (enforceDirection && routingHeading == null)
                        throw IllegalStateException(
                            "Waiting for confirmed driving direction before rerouting; keeping the current route")
                    core.graph(regions.graph(liveOrigin, destination.coordinate()).path)
                    val primary = JSONObject(core.route(liveOrigin, destination.coordinate(), snapshot.walking, snapshot.avoidTolls, 0.0, vehicleClass, routingHeading))
                    core.remember(0); primary.put("key", 0).put("label", if (snapshot.avoidTolls) "Without tolls" else "Recommended")
                    val choices = mutableListOf(primary)
                    if (!snapshot.walking && !snapshot.avoidTolls && primary.optDouble("tollEuros") > 0) {
                        try {
                            val alternative = JSONObject(core.route(liveOrigin, destination.coordinate(), false, true, 0.0, vehicleClass, routingHeading))
                            if (alternative.getJSONArray("edgeIndexes").toString() != primary.getJSONArray("edgeIndexes").toString()) {
                                core.remember(1); alternative.put("key", 1).put("label", "Without tolls"); choices.add(alternative)
                            }
                        } catch (e: IllegalStateException) { if (e.message?.contains("cancel", true) == true) throw e }
                    }
                    core.activate(0)
                    Triple(choices,liveOrigin,routingHeading)
                }
                if (generation == routeGeneration) {
                    preparedLiveRouteOrigin = if (snapshot.origin == null) liveOrigin else null
                    preparedLiveRouteHeading = if (snapshot.origin == null) routingHeading else null
                    lastSpoken = -1
                    state.update { it.copy(route = choices.first(), routeOptions = choices, guidance = null, navigating = startAfter && snapshot.origin == null) }
                    if (startAfter && snapshot.origin == null) recordNavigation()
                }
            } catch (e: Throwable) { failure(e) }
            finally { if (generation == routeGeneration) state.update { it.copy(busy = false) } }
        }
    }
    fun chooseRoute(choice: JSONObject) {
        if (state.value.navigating || state.value.busy ||
            state.value.routeOptions.none { it === choice }) return
        core.cancel()
        routeJob?.cancel()
        val generation = ++routeGeneration
        ++navigationRevision
        viewModelScope.launch {
            try {
                withContext(worker) {
                    if (generation == routeGeneration) core.activate(choice.getInt("key"))
                }
                if (generation == routeGeneration) {
                    lastSpoken = -1
                    state.update {
                        it.copy(route = choice, guidance = null,
                            avoidTolls = choice.optString("label") == "Without tolls")
                    }
                }
            } catch (e: Throwable) {
                if (generation == routeGeneration) failure(e)
            }
        }
    }
    fun start() {
        val snapshot = state.value
        if (snapshot.origin != null) return status("This is a fixed preview. Choose My location for live navigation.")
        if (snapshot.navigating) return
        if (snapshot.busy) return status("Still calculating the route. Please wait.")
        val fix = snapshot.fix
        val now = android.os.SystemClock.elapsedRealtimeNanos() / 1e9
        if (fix == null || !NavigationStartPolicy.freshFix(now,fix.time,fix.accuracy)) {
            return status("Waiting for a recent GPS fix before starting navigation.")
        }
        if (snapshot.route == null ||
            NavigationStartPolicy.requiresNewOrigin(
                preparedLiveRouteOrigin,fix.point,fix.accuracy,snapshot.walking,
                NavigationStartPolicy.movingHeading(fix)!=null) ||
            (!snapshot.walking && NavigationStartPolicy.directionChanged(
                preparedLiveRouteHeading,NavigationStartPolicy.movingHeading(fix)))) {
            // Discard the preview's old origin, ask C++ for a fresh route from
            // the current GPS position, and start only after it is calculated.
            calculate(true)
            return
        }
        ++navigationRevision
        lastSpoken = -1
        state.update { it.copy(navigating = true, guidance = null, arrived = false) }
        recordNavigation()
    }
    private fun cancelCurrentRouteWork() {
        ++routeGeneration
        ++navigationRevision
        core.cancel()
        routeJob?.cancel()
        routeJob = null
    }

    /** Internal stop preserves a prepared route for preview/edit workflows. */
    fun stop() {
        preparedLiveRouteOrigin=null
        preparedLiveRouteHeading=null
        cancelCurrentRouteWork()
        state.update { it.copy(navigating = false, guidance = null, busy = false) }
        // A paused/ended live route must not auto-resume after process death.
        prefs.edit().remove(navigationSnapshotKey).commit()
    }

    /** Explicitly ending navigation removes its route and destination atomically. */
    fun endNavigation() {
        cancelCurrentRouteWork()
        lastSpoken = -1
        state.update { it.afterEndingNavigation() }
        prefs.edit().remove(navigationSnapshotKey).commit()
    }
    // Visual extrapolation only; real GPS fixes still own routing decisions.
    fun predictSignalGap(now: Double) {
        state.update { s ->
            val fix = s.fix ?: return@update s
            val guidance = s.guidance ?: return@update s
            val route = s.route ?: return@update s
            if (!s.navigating || s.busy || s.walking) return@update s
            val predicted = RouteGapPrediction.predict(route, guidance, fix, now) ?: return@update s
            s.copy(guidance = predicted)
        }
    }
    fun fix(fix: Fix) {
        if (!fix.time.isFinite() || fix.time <= lastQueuedFixTime) return
        lastQueuedFixTime = fix.time
        locationFixes.trySend(fix)
    }

    private suspend fun processLocationFix(fix: Fix) {
        val trusted = withContext(worker) { core.filter(fix) }
        recentRealFixTimes.addLast(trusted.time)
        while(recentRealFixTimes.isNotEmpty() &&
            (recentRealFixTimes.size>12 ||
             trusted.time-recentRealFixTimes.peekFirst()>10.0))
            recentRealFixTimes.removeFirst()
        val span=if(recentRealFixTimes.size>1)
            recentRealFixTimes.peekLast()-recentRealFixTimes.peekFirst() else 0.0
        val measuredHz=if(span>0.0)(recentRealFixTimes.size-1)/span else 0.0
        state.update { s ->
            // Older asynchronous results must not overwrite newer positions.
            if (s.fix != null && trusted.time <= s.fix.time) s else
                s.copy(previousFix = s.fix, fix = trusted, gpsHz = measuredHz)
        }
        val initial = state.value
        val route = initial.route ?: return
        if (!initial.navigating || initial.busy) return
        val revision = navigationRevision
        val result = withContext(worker) { JSONObject(core.update(trusted)) }
        val current = state.value
        if (revision != navigationRevision || !current.navigating ||
            current.busy || current.route !== route) return
        // Pair this projection with the GPS fix that produced it. JNI
        // runs asynchronously; otherwise the UI can receive a fresh fix
        // with the previous guidance and skip the actual new projection.
        result.put("gpsFixTime",trusted.time)
        state.update { it.copy(guidance = result) }
        val maneuver = result.getInt("maneuver")
        if (voice && maneuver != lastSpoken && result.getString("state") != "checking") {
            route.optJSONArray("maneuvers")?.optJSONObject(maneuver)?.let {
                speak?.invoke(it.optString("instruction"))
            }
            lastSpoken = maneuver
        }
        when (result.getString("state")) {
            "reroute" -> calculate(true, directionalReroute = true)
            "arrived" -> {
                current.destination?.optString("id")?.takeIf { it.startsWith("trip:") }
                    ?.let { visited(it, true) }
                stop()
                state.update { it.copy(arrived = true) }
            }
        }
    }
    /**
     * Durable WorkManager job. Network interruptions retain staged bytes; work may
     * resume after the app process is removed from memory.
     */
    fun download(region: Region) {
        if (state.value.downloading != null) return
        val request=androidx.work.OneTimeWorkRequestBuilder<RegionDownloadWorker>()
            .setInputData(androidx.work.workDataOf(
                RegionDownloadWorker.KEY_REGION to region.id,
                RegionDownloadWorker.KEY_VERSION to region.version))
            .setConstraints(androidx.work.Constraints.Builder()
                .setRequiredNetworkType(androidx.work.NetworkType.CONNECTED).build())
            .setBackoffCriteria(androidx.work.BackoffPolicy.EXPONENTIAL,30,java.util.concurrent.TimeUnit.SECONDS)
            .addTag(RegionDownloadWorker.uniqueName(region.id))
            .build()
        state.update { it.copy(downloading=region.id,downloadPercent=0,downloadError=null) }
        val operation=workManager.enqueueUniqueWork(RegionDownloadWorker.uniqueName(region.id),
            androidx.work.ExistingWorkPolicy.REPLACE,request)
        viewModelScope.launch {
            try {
                // A query before the enqueue transaction finishes can miss the
                // work and incorrectly display a completed download.
                withContext(Dispatchers.IO) { operation.result.get() }
                observeRegionWork()
            } catch (e:Exception) {
                state.update { it.copy(downloading=null,
                    downloadError=e.message ?: "Could not schedule region download",
                    revision=it.revision+1) }
            }
        }
    }
    private fun observeRegionWork() {
        workMonitor?.cancel()
        workMonitor=viewModelScope.launch {
            // WorkInfo lives in WorkManager's database, not in an Activity.
            while (true) {
                val infos=withContext(Dispatchers.IO) {
                    regions.regions.flatMap { region ->
                        workManager.getWorkInfosForUniqueWork(
                            RegionDownloadWorker.uniqueName(region.id)).get()
                    }
                }
                val active=infos.firstOrNull {
                    it.state==androidx.work.WorkInfo.State.RUNNING ||
                    it.state==androidx.work.WorkInfo.State.ENQUEUED ||
                    it.state==androidx.work.WorkInfo.State.BLOCKED
                }
                if (active!=null) {
                    val id=active.tags.firstOrNull { it.startsWith("atlas-region:") }
                        ?.removePrefix("atlas-region:")
                    val progress=active.progress.getInt(RegionDownloadWorker.KEY_PERCENT,0)
                    if (id!=null) state.update {
                        it.copy(downloading=id,downloadPercent=progress,downloadError=null)
                    }
                } else {
                    val current=state.value.downloading
                    if (current!=null) {
                        val last=infos.lastOrNull {
                            it.tags.contains(RegionDownloadWorker.uniqueName(current))
                        }
                        if (last?.state==androidx.work.WorkInfo.State.SUCCEEDED)
                            status("${current.replaceFirstChar{it.uppercase()}} is ready offline")
                        if (last?.state==androidx.work.WorkInfo.State.FAILED)
                            state.update { it.copy(downloadError=last.outputData.getString("error")
                                ?: "Download failed. Try again.") }
                        state.update { it.copy(downloading=null,revision=it.revision+1) }
                    }
                    break
                }
                kotlinx.coroutines.delay(900)
            }
        }
    }
    fun cancelDownload() {
        state.value.downloading?.let { workManager.cancelUniqueWork(RegionDownloadWorker.uniqueName(it)) }
        downloadJob?.cancel()
        state.update { it.copy(downloading=null,revision=it.revision+1) }
    }
    fun remove(region: Region) { viewModelScope.launch { try {
        stop()
        withContext(Dispatchers.IO) {
            workManager.cancelUniqueWork(RegionDownloadWorker.uniqueName(region.id)).result.get()
            regions.remove(region)
        }
        refresh(); status("${region.name} removed")
    } catch (e: Throwable) { failure(e) } } }
    private fun storedArray(key: String): List<JSONObject> = try { JSONArray(prefs.getString(key, "[]")).objects() } catch (_: Exception) { emptyList() }
    fun bookmarks(): List<JSONObject> = storedArray("bookmarks")
    fun exportUserBackup(): String {
        val completed=JSONObject()
        prefs.all.forEach { (key,value) ->
            if (key.startsWith("visited:") && value == true)
                completed.put(key.removePrefix("visited:"),true)
        }
        return JSONObject()
            .put("format","atlas-native-backup")
            .put("schemaVersion",1)
            .put("bookmarks",JSONArray(bookmarks()))
            .put("recents",JSONArray(recents()))
            .put("trips",JSONArray(trips()))
            .put("visited",completed)
            .put("voice",voice)
            .put("theme",theme)
            .put("mapSourceMode",mapSourceMode)
            .put("vehicle",vehicleClass)
            .toString(2)
    }
    /**
     * Import a user-provided Atlas JSON backup. Merge by stable place/trip ID;
     * never read another app's private WebView storage or erase current data.
     */
    fun importUserBackup(text: String) {
        require(text.toByteArray(Charsets.UTF_8).size <= 10*1024*1024) { "Backup too large" }
        val data=JSONObject(text)
        require(data.optString("format")=="atlas-native-backup" &&
            data.optInt("schemaVersion")==1) { "Unsupported Atlas backup format" }
        fun places(array:JSONArray,limit:Int):List<JSONObject> {
            require(array.length()<=limit) { "Backup contains too many places" }
            return array.objects().map { place ->
                require(place.optString("name").isNotBlank() && place.has("lat") && place.has("lon"))
                val point=place.coordinate()
                require(point.lat.isFinite() && point.lon.isFinite() &&
                    point.lat in -90.0..90.0 && point.lon in -180.0..180.0)
                JSONObject(place.toString())
            }
        }
        fun docs(array:JSONArray):List<JSONObject> {
            require(array.length()<=200) { "Backup contains too many trips" }
            return array.objects().map { doc ->
                val trip=doc.getJSONObject("trip")
                val days=trip.getJSONObject("days")
                require(trip.optString("name").isNotBlank() &&
                    days.length() in 1..100)
                for (key in days.keys()) places(days.getJSONArray(key),1000)
                JSONObject(doc.toString())
            }
        }
        val saved=places(data.optJSONArray("bookmarks")?:JSONArray(),3000)
        val recent=places(data.optJSONArray("recents")?:JSONArray(),1000)
        val importedTrips=docs(data.optJSONArray("trips")?:JSONArray())
        val marks=data.optJSONObject("visited")?:JSONObject()
        require(marks.length()<=100000) { "Backup contains too many visited entries" }
        val importedVisited=marks.keys().asSequence().toList()
        require(importedVisited.all { it.length in 1..255 &&
            !it.contains('\n') && !it.contains('\r') })
        fun combine(old:List<JSONObject>,new:List<JSONObject>,key:(JSONObject)->String)=
            (old+new).associateBy(key).values.toList()
        val mergedSaved=combine(bookmarks(),saved){ it.optString("id")
            .ifBlank { "${it.optString("name")}:${it.optDouble("lat")}:${it.optDouble("lon")}" } }
        val mergedRecent=combine(recents(),recent){ it.optString("id")
            .ifBlank { "${it.optString("name")}:${it.optDouble("lat")}:${it.optDouble("lon")}" } }.takeLast(20)
        val mergedTrips=combine(trips(),importedTrips) {
            tripId(it.getJSONObject("trip"))
        }
        val edit=prefs.edit()
            .putString("bookmarks",JSONArray(mergedSaved).toString())
            .putString("recents",JSONArray(mergedRecent).toString())
            .putString("trips",JSONArray(mergedTrips).toString())
        for (id in importedVisited) if (marks.optBoolean(id))
            edit.putBoolean("visited:$id",true)
        val mode=data.optString("mapSourceMode","")
        if (MapSourcePolicy.isValid(mode)) edit.putString("mapSourceMode",mode)
        val appearance=data.optString("theme","")
        if (appearance in listOf("system","light","dark")) edit.putString("theme",appearance)
        if (data.has("voice")) edit.putBoolean("voice",data.optBoolean("voice",true))
        val vehicle=data.optInt("vehicle",vehicleClass)
        if(vehicle in 1..4) edit.putInt("vehicle",vehicle)
        check(edit.commit()) { "Could not save imported Atlas data" }
        voice=prefs.getBoolean("voice",true)
        refresh()
        status("Atlas data imported · ${saved.size} places · ${importedTrips.size} trips")
    }
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
    fun startJourney(journey: JSONObject) {
        enrichmentJob?.cancel()
        journeyExecution=TransitExecution(journey)
        state.update { it.copy(journey=journey,journeyLeg=0,journeyPhase=journeyExecution!!.phase,journeyHistory=JSONArray(journeyExecution!!.history.toString())) }
        enrichJourney()
    }
    fun enrichJourney() {
        val journey=state.value.journey?:return
        enrichmentJob?.cancel()
        enrichmentJob=viewModelScope.launch {
            try {
                val enriched=TransitProvider().enrich(journey)
                if(state.value.journey?.optString("id")==journey.optString("id"))state.update{it.copy(journey=enriched)}
            }catch(e:CancellationException){throw e}catch(_:Exception){ /* Live information is optional; retain the planned journey. */ }
        }
    }
    fun journeyAction(action:String) {
        val execution=journeyExecution?:return
        if(!execution.transition(action))return
        state.update{it.copy(journeyLeg=if(execution.phase=="complete")TransitPolicy.sequence(execution.journey).size else execution.legIndex,
            journeyPhase=execution.phase,journeyHistory=JSONArray(execution.history.toString()))}
        if(execution.phase=="ready_to_board")enrichJourney()
    }
    override fun onCleared() {
        workMonitor?.cancel()
        locationFixes.close()
        speak = null
        kotlinx.coroutines.CoroutineScope(worker).launch { core.close(); worker.close() }
    }
}
