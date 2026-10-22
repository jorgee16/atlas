package com.atlas.nativeapp

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.widget.ImageView
import android.text.TextUtils
import android.graphics.Typeface
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.view.Surface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity(), LocationListener, SensorEventListener {
    private val model: AtlasModel by lazy { (application as AtlasApplication).model }
    private var activityStarted = false
    private var foregroundNavigationRunning = false
    private lateinit var ui: AtlasUi
    private lateinit var atlasMap: AtlasMap
    private lateinit var pages: AtlasPages
    private val trails by lazy { TrailStore(this) }
    private var trailList: List<Trail> = emptyList()
    private var selectedTrailId: String? = null
    private var trailExpanded = false
    private var trailCoverTargetId: String? = null
    private var pendingTrail: Trail? = null
    private lateinit var root: FrameLayout
    private lateinit var top: LinearLayout
    private lateinit var bottom: LinearLayout
    private lateinit var controls: LinearLayout
    private lateinit var navigation: LinearLayout
    private lateinit var guidance: LinearLayout
    private lateinit var pageLayer: LinearLayout
    private lateinit var pageBody: FrameLayout
    private lateinit var snackbar: TextView
    private lateinit var credit: TextView
    private lateinit var mapSourceBadge: TextView
    private lateinit var diagnosticsOverlay: LinearLayout
    private lateinit var diagnosticsLabel: TextView
    private lateinit var diagnosticsBody: TextView
    private var diagnosticsExpanded = false
    private var topSourceBadge: TextView? = null
    private var page: String? = null
    private var pageKey: List<Any?>? = null
    private var lastChrome: List<Any?>? = null
    private var searchInput: EditText? = null
    private var searchTarget = "destination"
    private var selectedPlace: JSONObject? = null
    private var pickingOrigin = false
    private var previewCollapsed = false
    private var fullMap = false
    private var topInset = 0
    private var bottomInset = 0
    private var leftInset = 0
    private var rightInset = 0
    private var lastNotice = 0L
    private var lastTouch = 0L
    private var navigationTouch = false
    private var navigationTouchGeneration = 0L
    private var deferredChrome = false
    // Keep navigation controls attached while 1 Hz GPS/guidance updates refresh
    // their labels. Detaching the Overview button can silently cancel touch UP.
    private var navigationSummaryCard: View? = null
    private var navigationArrival: TextView? = null
    private var navigationRemaining: TextView? = null
    private var navigationDistance: TextView? = null
    private var navigationVoiceIcon: AtlasIcon? = null
    private var lastRoute: JSONObject? = null
    private val handler = Handler(Looper.getMainLooper())
    private val gapTick = object : Runnable {
        override fun run() {
            model.predictSignalGap(android.os.SystemClock.elapsedRealtimeNanos() / 1e9)
            if (::diagnosticsOverlay.isInitialized &&
                (model.diagnosticsEnabled || page=="diagnostics"))
                updateDiagnostics(model.updates.value)
            handler.postDelayed(this, 1000L)
        }
    }
    private val landscape get() = resources.configuration.screenWidthDp > resources.configuration.screenHeightDp
    private val manager by lazy { getSystemService(LOCATION_SERVICE) as LocationManager }
    private val sensors by lazy { getSystemService(SENSOR_SERVICE) as SensorManager }
    private val rotationSensor by lazy { sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) }
    private var lastReliableGpsTime = Double.NEGATIVE_INFINITY
    private val rotationMatrix = FloatArray(9)
    private val sensorAngles = FloatArray(3)
    private val requestPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { startGps(); rebuildChrome() }
    private val importBackup = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if(uri!=null) lifecycleScope.launch {
            try {
                val data=withContext(Dispatchers.IO) {
                    contentResolver.openInputStream(uri)!!.use { input ->
                        val bytes=java.io.ByteArrayOutputStream()
                        val buf=ByteArray(8192)
                        while(true) {
                            val n=input.read(buf);if(n<0)break
                            require(bytes.size()+n<=10*1024*1024) { "Backup exceeds 10 MB" }
                            bytes.write(buf,0,n)
                        }
                        bytes.toString("UTF-8")
                    }
                }
                model.importUserBackup(data)
                recreate()
            } catch (e:Exception) {
                model.status(e.message ?: "Unable to import Atlas backup")
            }
        }
    }
    private val exportBackup = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri!=null) lifecycleScope.launch {
            try {
                val text=model.exportUserBackup()
                withContext(Dispatchers.IO) {
                    contentResolver.openOutputStream(uri,"w")!!.use {
                        it.write(text.toByteArray(Charsets.UTF_8))
                    }
                }
                model.status("Atlas backup exported")
            } catch(e:Exception) {
                model.status(e.message ?: "Could not export backup")
            }
        }
    }
    private var resumeDialogShown=false
    private fun chooseTrailFile() {
        // Providers label KMZ and GPX with inconsistent MIME types. Validate
        // the extension and contents ourselves rather than hiding usable files.
        importTrail.launch(arrayOf("*/*"))
    }

    /** Native light/dark bottom sheet, matching the announced import design. */
    private fun openTrailImportSheet() {
        val sheet = trailSheet("Import a trail",
            "Import routes from your device and explore them on the map.")
        val zone = ui.column().apply {
            gravity = Gravity.CENTER
            val stroke = android.graphics.drawable.GradientDrawable().apply {
                setColor(ui.canvas)
                cornerRadius = ui.dp(20).toFloat()
                setStroke(ui.dp(1), ui.line, ui.dp(7).toFloat(), ui.dp(5).toFloat())
            }
            background = stroke
            minimumHeight = ui.dp(148)
            setPadding(ui.dp(16), ui.dp(22), ui.dp(16), ui.dp(22))
            addView(ui.icon("upload", ui.blue, 30))
            addView(ui.space(13))
            addView(ui.text("Choose a route file", 17f, ui.ink, true).apply {
                gravity = Gravity.CENTER
            })
            addView(ui.space(9))
            addView(ui.text("GPX  ·  KML  ·  KMZ  ·  GeoJSON", 12f, ui.muted).apply {
                gravity = Gravity.CENTER
            })
            contentDescription = "Choose a route file"
            isFocusable = true
        }
        sheet.addView(zone, linear(3))
        sheet.addView(ui.row().apply {
            addView(ui.icon("check", ui.muted, 18))
            addView(ui.text("Files are imported and stored locally on your device.",
                12f, ui.muted), LinearLayout.LayoutParams(0, -2, 1f).apply {
                leftMargin = ui.dp(11)
            })
            setPadding(0, ui.dp(16), 0, ui.dp(4))
        })
        val dialog = showTrailSheet(sheet)
        zone.setOnClickListener {
            dialog.dismiss()
            chooseTrailFile()
        }
    }

    private val importTrail = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) lifecycleScope.launch {
            try {
                val name = contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    val column = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
                } ?: uri.lastPathSegment?.substringAfterLast('/') ?: "Imported trail"
                val trail = withContext(Dispatchers.IO) {
                    contentResolver.openInputStream(uri)!!.use { trails.preview(it, name) }
                }
                showTrailImportPreview(trail)
            } catch (e: Exception) {
                model.status(e.message ?: "Could not read trail file")
            }
        }
    }

    private fun trailSheet(title: String, subtitle: String): LinearLayout =
        ui.column().apply {
            setPadding(ui.dp(22), ui.dp(12), ui.dp(22), ui.dp(24))
            background = ui.shape(ui.surface, 26)
            addView(ui.text("━━━━", 18f, ui.muted).apply {
                gravity = Gravity.CENTER
            })
            addView(ui.space(12))
            addView(ui.text(title, 22f, ui.ink, true))
            addView(ui.space(7))
            addView(ui.text(subtitle, 13f, ui.muted))
            addView(ui.space(18))
        }

    private fun showTrailSheet(content: View): AlertDialog =
        AlertDialog.Builder(this).setView(content).create().apply {
            show()
            window?.setBackgroundDrawableResource(android.R.color.transparent)
            window?.setGravity(Gravity.BOTTOM)
            window?.setLayout(resources.displayMetrics.widthPixels - ui.dp(20), -2)
        }

    private fun showTrailImportPreview(trail: Trail) {
        pendingTrail = trail
        model.tab("Trail")
        rebuildChrome()
        atlasMap.previewTrail(trail)
        var saved = false
        val panel = trailSheet("Import this trail?",
            "Review the route on the map before adding it to your library.")
        panel.addView(ui.row().apply {
            addView(ui.text(trail.name, 17f, ui.ink, true),
                LinearLayout.LayoutParams(0, -2, 1f))
            addView(ui.badge(trail.format))
        })
        panel.addView(ui.space(18))
        panel.addView(ui.row().apply {
            val duration = trail.durationMillis?.let {
                AtlasPages.formatTime(it / 1000.0)
            } ?: "—"
            for ((value, label) in listOf(
                AtlasPages.formatDistance(trail.distanceMeters) to "Distance",
                "+${trail.ascentMeters.toInt()} m" to "Ascent",
                duration to "Duration"
            )) {
                addView(ui.stat(value, label), LinearLayout.LayoutParams(0, -2, 1f))
            }
        })
        panel.addView(ui.space(20))
        val actions = ui.row()
        val cancel = ui.action("Cancel", null, false) { }
        val confirm = ui.action("Save trail", "check") { }
        actions.addView(cancel, LinearLayout.LayoutParams(0, -2, 1f).apply {
            rightMargin = ui.dp(8)
        })
        actions.addView(confirm, LinearLayout.LayoutParams(0, -2, 1.35f))
        panel.addView(actions)
        val dialog = showTrailSheet(panel)
        cancel.setOnClickListener { dialog.dismiss() }
        confirm.setOnClickListener {
            confirm.isEnabled = false
            lifecycleScope.launch {
                try {
                    withContext(Dispatchers.IO) { trails.save(trail) }
                    saved = true
                    pendingTrail = null
                    trailList = trails.all()
                    selectedTrailId = trail.id
                    trailExpanded = false
                    dialog.dismiss()
                    model.status("Imported ${trail.name}")
                    rebuildChrome()
                } catch (e: Exception) {
                    confirm.isEnabled = true
                    model.status(e.message ?: "Could not save trail")
                }
            }
        }
        dialog.setOnDismissListener {
            if (!saved) {
                pendingTrail = null
                atlasMap.previewTrail(trailList.firstOrNull { it.id == selectedTrailId })
                rebuildChrome()
            }
        }
    }

    private val pickTrailCover = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val id=trailCoverTargetId
        trailCoverTargetId=null
        if(uri!=null && id!=null)lifecycleScope.launch{
            try {
                withContext(Dispatchers.IO){contentResolver.openInputStream(uri)!!.use{trails.setCover(id,it)}}
                rebuildChrome()
            }catch(e:Exception){model.status(e.message?:"Could not save cover")}
        }
    }
    private val importTrip = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) lifecycleScope.launch {
            try {
                val text = withContext(Dispatchers.IO) { contentResolver.openInputStream(uri)!!.use { input ->
                    val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
                    while (output.size() <= 10 * 1024 * 1024) { val n = input.read(buffer); if (n < 0) break; output.write(buffer,0,n) }
                    require(output.size() <= 10 * 1024 * 1024) { "This trip file is too large" }
                    output.toString("UTF-8")
                } }
                model.importTrip(text); model.tab("Trip"); openPage("trips")
            } catch (e: Exception) { model.status(e.message ?: "Could not import this trip") }
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = AtlasUi(this, model.dark)
        if(savedInstanceState!=null)lastNotice=model.updates.value.notice
        WindowCompat.setDecorFitsSystemWindows(window,false)
        window.statusBarColor=Color.TRANSPARENT
        window.navigationBarColor=Color.TRANSPARENT
        WindowCompat.getInsetsController(window,window.decorView).apply { isAppearanceLightStatusBars = !ui.dark; isAppearanceLightNavigationBars = !ui.dark }
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        root = FrameLayout(this).apply { setBackgroundColor(ui.canvas) }
        atlasMap = AtlasMap(this,model.regions,ui.dark); atlasMap.onCreate(savedInstanceState?.getBundle("map"))
        root.addView(atlasMap.view,FrameLayout.LayoutParams(-1,-1))
        top = ui.column(); root.addView(top,FrameLayout.LayoutParams(-1,-2,Gravity.TOP))
        bottom = ui.column(); root.addView(bottom,FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM))
        controls = ui.column(); root.addView(controls,FrameLayout.LayoutParams(ui.dp(48),-2,Gravity.END or Gravity.BOTTOM))
        navigation = ui.row(); root.addView(navigation,FrameLayout.LayoutParams(-1,ui.dp(68),Gravity.BOTTOM))
        guidance = ui.column(); root.addView(guidance,FrameLayout.LayoutParams(-1,-2,Gravity.TOP))
        mapSourceBadge = ui.badge("MAP · LOADING").apply {
            contentDescription = "Change map source"
            setOnClickListener { showMapSourceOptions() }
            elevation = ui.dp(3).toFloat()
        }
        root.addView(mapSourceBadge, FrameLayout.LayoutParams(-2,-2,Gravity.BOTTOM or Gravity.START))
        credit = ui.text("© OpenStreetMap · OpenFreeMap",9f,ui.muted).apply { setShadowLayer(2f,0f,0f,Color.WHITE); setOnClickListener { startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://www.openstreetmap.org/copyright"))) } }
        root.addView(credit,FrameLayout.LayoutParams(-2,-2,Gravity.BOTTOM or Gravity.START))
        pageLayer = ui.column().apply { setBackgroundColor(ui.canvas); visibility = View.GONE; elevation = ui.dp(12).toFloat(); isClickable = true }
        root.addView(pageLayer,FrameLayout.LayoutParams(-1,-1))
        // Opt-in IN-APP overlay; no SYSTEM_ALERT_WINDOW permission or
        // screen-over-other-apps behaviour. Touches outside this card remain map touches.
        diagnosticsOverlay=ui.column().apply {
            setPadding(ui.dp(13),ui.dp(12),ui.dp(13),ui.dp(12))
            // Fully transparent diagnostic text overlay: the satellite/map
            // imagery is never darkened, blurred or covered by a solid card.
            setBackgroundColor(Color.TRANSPARENT)
            elevation=0f
            visibility=View.GONE
            addView(ui.row().apply {
                diagnosticsLabel=ui.text("GPS DIAGNOSTICS",12f,Color.WHITE,true).apply {
                    setShadowLayer(ui.dp(3).toFloat(),0f,ui.dp(1).toFloat(),Color.BLACK)
                    setOnClickListener {
                        diagnosticsExpanded=!diagnosticsExpanded
                        updateDiagnostics(model.updates.value)
                    }
                }
                addView(diagnosticsLabel,LinearLayout.LayoutParams(0,ui.dp(35),1f).apply {
                    gravity=Gravity.CENTER_VERTICAL
                })
                addView(ui.text("×",23f,Color.WHITE,true).apply {
                    setShadowLayer(ui.dp(3).toFloat(),0f,ui.dp(1).toFloat(),Color.BLACK)
                    contentDescription="Hide GPS diagnostics"
                    gravity=Gravity.CENTER
                    setOnClickListener { model.diagnosticsEnabled=false }
                },LinearLayout.LayoutParams(ui.dp(38),ui.dp(38)))
            })
            diagnosticsBody=ui.text("",12f,Color.WHITE).apply {
                setShadowLayer(ui.dp(3).toFloat(),0f,ui.dp(1).toFloat(),Color.BLACK)
                setLineSpacing(ui.dp(3).toFloat(),1f)
                setOnClickListener {
                    diagnosticsExpanded=!diagnosticsExpanded
                    updateDiagnostics(model.updates.value)
                }
            }
            addView(diagnosticsBody,linear(4))
        }
        root.addView(diagnosticsOverlay,
            FrameLayout.LayoutParams(ui.dp(258),-2,Gravity.TOP or Gravity.START))
        snackbar = ui.text("",13f,Color.WHITE).apply { background=ui.shape(Color.rgb(24,32,47),16);setPadding(ui.dp(16),ui.dp(13),ui.dp(16),ui.dp(13));elevation=ui.dp(24).toFloat();visibility=View.GONE }
        root.addView(snackbar,FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM))
        trailList=trails.all()
        pages = AtlasPages(this,ui,model,::selectDestination,::openPage,{importTrip.launch(arrayOf("application/json","text/*"))}, { theme -> model.theme=theme; recreate() },::confirm,{atlasMap.center(it)},
            { importBackup.launch(arrayOf("application/json","text/*")) },
            { exportBackup.launch("atlas-backup.json") })
        // A map style callback must not rebuild interactive chrome: doing so
        // can detach a search button between Android touch down and click.
        atlasMap.onMapSourceChanged = { updateMapSourceIndicators() }
        atlasMap.overviewInsets = {
            if(landscape)intArrayOf(
                maxOf(if(guidance.visibility==View.VISIBLE)guidance.right else 0,
                    if(bottom.visibility==View.VISIBLE)bottom.right else 0)+ui.dp(20),
                topInset+ui.dp(24),rightInset+ui.dp(80),bottomInset+ui.dp(24))
            else intArrayOf(leftInset+ui.dp(32),
                maxOf(topInset+ui.dp(if(model.updates.value.navigating)220 else 40),
                    if(guidance.visibility==View.VISIBLE)guidance.bottom+ui.dp(20) else 0),
                rightInset+ui.dp(80),
                maxOf(bottomInset+ui.dp(40),if(bottom.visibility==View.VISIBLE)root.height-bottom.top+ui.dp(24) else 0))
        }
        guidance.addOnLayoutChangeListener { _,_,_,_,_,_,_,_,_ -> atlasMap.onChromeLayout() }
        bottom.addOnLayoutChangeListener { _,_,_,_,_,_,_,_,_ -> atlasMap.onChromeLayout() }
        atlasMap.onPan = { if(model.updates.value.route!=null&&!model.updates.value.navigating){previewCollapsed=true}; rebuildChrome() }
        atlasMap.onPoint = { point ->
            if(pickingOrigin){pickingOrigin=false;model.origin(point);model.status("Starting point set");model.updates.value.destination?.let{model.calculate()}}
            else { selectedPlace=JSONObject().put("id","pin:${point.lat},${point.lon}").put("name","Selected location").put("type","Map pin").put("lat",point.lat).put("lon",point.lon);rebuildChrome() }
        }
        atlasMap.onPlace = { selectedPlace=it;rebuildChrome() }
        atlasMap.onRoute = { model.chooseRoute(it) }
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val system=insets.getInsets(WindowInsetsCompat.Type.systemBars());topInset=system.top;bottomInset=system.bottom;leftInset=system.left;rightInset=system.right
            layoutChrome();insets
        }
        onBackPressedDispatcher.addCallback(this,object:OnBackPressedCallback(true){override fun handleOnBackPressed(){
            when { page!=null -> backPage(); fullMap -> {fullMap=false;rebuildChrome()}; selectedPlace!=null -> {selectedPlace=null;rebuildChrome()}; model.updates.value.navigating -> confirm("End this navigation?"){endNavigation()}; model.updates.value.tab!="Explore" -> model.tab("Explore"); else -> {isEnabled=false;onBackPressedDispatcher.onBackPressed()} }
        }})
        // Guidance TTS is owned by NavigationService, not by an Activity that
        // Android can destroy while the user opens another application.
        page=savedInstanceState?.getString("page")
        selectedPlace=savedInstanceState?.getString("peek")?.let{JSONObject(it)}
        lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.STARTED) { model.updates.collect { render(it) } } }
        val initialPage=page;page=null;if(initialPage!=null)openPage(initialPage)
        rebuildChrome()
        if(savedInstanceState==null && model.canResumePreviousNavigation && !resumeDialogShown) {
            resumeDialogShown=true
            root.post {
                if(!isFinishing && model.canResumePreviousNavigation) {
                    confirm("A previous trip was interrupted. Recalculate and resume from your current GPS location?") {
                        model.resumePreviousNavigation()
                    }
                }
            }
        }
    }
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if(event.actionMasked==MotionEvent.ACTION_DOWN) {
            lastTouch=System.currentTimeMillis()
            navigationTouchGeneration++
            navigationTouch=model.updates.value.navigating && page==null
        }
        val handled=super.dispatchTouchEvent(event)
        if(event.actionMasked==MotionEvent.ACTION_UP || event.actionMasked==MotionEvent.ACTION_CANCEL) {
            // View posts PerformClick from ACTION_UP. Keep the pressed control
            // attached while already-queued GPS/guidance callbacks run before
            // that click; clearing here allowed them to remove its target.
            val generation=navigationTouchGeneration
            root.post {
                if(generation==navigationTouchGeneration) {
                    navigationTouch=false
                    if(deferredChrome) { deferredChrome=false;render(model.updates.value) }
                }
            }
        }
        return handled
    }
    private fun layoutChrome() {
        val pad=ui.dp(16)
        val left=pad+leftInset;val right=pad+rightInset
        (top.layoutParams as FrameLayout.LayoutParams).apply { width=if(landscape)ui.dp(350) else -1;leftMargin=left;rightMargin=right;topMargin=topInset+ui.dp(12) }.also{top.layoutParams=it}
        (bottom.layoutParams as FrameLayout.LayoutParams).apply { width=if(landscape)ui.dp(340) else -1;gravity=Gravity.BOTTOM or if(landscape)Gravity.START else Gravity.CENTER_HORIZONTAL;leftMargin=left;rightMargin=right;bottomMargin=bottomInset+if(landscape||model.updates.value.navigating)ui.dp(16) else ui.dp(100) }.also{bottom.layoutParams=it}
        (navigation.layoutParams as FrameLayout.LayoutParams).apply {width=if(landscape)ui.dp(300) else -1;gravity=Gravity.BOTTOM or if(landscape)Gravity.END else Gravity.CENTER_HORIZONTAL;leftMargin=left;rightMargin=right;bottomMargin=bottomInset+ui.dp(14)}.also{navigation.layoutParams=it}
        (guidance.layoutParams as FrameLayout.LayoutParams).apply{width=if(landscape)ui.dp(360) else -1;leftMargin=left;rightMargin=right;topMargin=topInset+ui.dp(12)}.also{guidance.layoutParams=it}
        (controls.layoutParams as FrameLayout.LayoutParams).apply {
            val state=model.updates.value
            val planning=state.tab=="Navigation"&&!state.navigating&&!fullMap
            // Trail is a bottom sheet, not a surface for map controls.
            // Anchor the map toolbar beside the exposed map, never the sheet.
            val trailMap=state.tab=="Trail"&&!state.navigating&&!landscape&&!fullMap
            val fromTop=(planning||trailMap)&&!landscape
            gravity=Gravity.END or if(fromTop)Gravity.TOP else Gravity.BOTTOM
            rightMargin=right
            topMargin=if(trailMap)topInset+ui.dp(85)
                else if(planning&&!landscape)topInset+ui.dp(165) else 0
            bottomMargin=if(fromTop)0 else bottomInset+
                if(state.navigating)ui.dp(178) else ui.dp(118)
        }.also{controls.layoutParams=it}
        (credit.layoutParams as FrameLayout.LayoutParams).apply{leftMargin=leftInset+ui.dp(22);bottomMargin=bottomInset+if(model.updates.value.navigating)ui.dp(184)else ui.dp(88)}.also{credit.layoutParams=it}
        (mapSourceBadge.layoutParams as FrameLayout.LayoutParams).apply {
            leftMargin=left
            bottomMargin=bottomInset+if(model.updates.value.navigating)ui.dp(215)else ui.dp(116)
        }.also{mapSourceBadge.layoutParams=it}
        (diagnosticsOverlay.layoutParams as FrameLayout.LayoutParams).apply {
            width=ui.dp(if(landscape)232 else 258)
            gravity=Gravity.TOP or if(landscape)Gravity.END else Gravity.START
            leftMargin=if(landscape)0 else left
            rightMargin=if(landscape)right else 0
            topMargin=topInset+ui.dp(if(landscape)14 else if(model.updates.value.navigating)172 else 150)
        }.also{diagnosticsOverlay.layoutParams=it}
        (snackbar.layoutParams as FrameLayout.LayoutParams).apply{leftMargin=leftInset+ui.dp(24);rightMargin=rightInset+ui.dp(24);bottomMargin=bottomInset+if(model.updates.value.navigating)ui.dp(180) else ui.dp(100)}.also{snackbar.layoutParams=it}
        pageLayer.setPadding(leftInset,topInset,rightInset,if(page=="trips")bottomInset+ui.dp(91) else bottomInset)
    }
    private fun linear(top: Int = 0) = LinearLayout.LayoutParams(-1,-2).apply{topMargin=ui.dp(top)}
    private fun rebuildChrome(){lastChrome=null;render(model.updates.value)}
    private fun render(state: AtlasState) {
        syncNavigationService(state.navigating)
        atlasMap.sourceMode = model.mapSourceMode
        atlasMap.visualStyle = model.mapVisualStyle
        atlasMap.render(state)
        updateDiagnostics(state)
        atlasMap.previewTrail(if(state.tab=="Trail") pendingTrail ?: trailList.firstOrNull{it.id==selectedTrailId} else null)
        mapSourceBadge.visibility=if(page==null&&(state.navigating||fullMap))View.VISIBLE else View.GONE
        updateMapSourceIndicators()
        val chrome=listOf(state.tab,state.destination,state.route,state.guidance,state.mode,state.arrived,state.busy,state.navigating,state.routeOptions,state.journeys,state.journeyLeg,state.revision,state.downloading,state.downloadPercent,state.exploreResults,state.searching,state.searchError,selectedPlace,previewCollapsed,trailExpanded,selectedTrailId,pendingTrail?.id,model.mapVisualStyle,fullMap,hasLocation(),atlasMap.follow,atlasMap.headingUp)
        if(chrome!=lastChrome) {
            if(navigationTouch)deferredChrome=true
            else {lastChrome=chrome;renderTop(state);renderControls(state);renderBottom(state);renderTabs(state);renderGuidance(state);layoutChrome()}
        }
        if(state.route!==lastRoute){lastRoute=state.route;if(state.route!=null&&!state.navigating){previewCollapsed=false;handler.postDelayed({if(System.currentTimeMillis()-lastTouch>8000&&page==null&&model.updates.value.route!=null&&!model.updates.value.navigating){previewCollapsed=true;rebuildChrome()}},12000)}}
        if(state.navigating)window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        updatePage(state)
        if(state.notice!=lastNotice){lastNotice=state.notice;if(state.status.isNotBlank()){snackbar.text=state.status;snackbar.visibility=View.VISIBLE;handler.removeCallbacks(hideNotice);handler.postDelayed(hideNotice,4500)}}
    }
    private fun updateDiagnostics(state: AtlasState) {
        val enabled=model.diagnosticsEnabled
        diagnosticsOverlay.visibility=if(enabled&&page==null)View.VISIBLE else View.GONE
        if(!enabled && page!="diagnostics")return
        if(page=="diagnostics") pages.updateDiagnostics(state)
        val snapshot=NavigationDiagnostics.snapshot(state,
            android.os.SystemClock.elapsedRealtimeNanos()/1e9)
        if(enabled) {
            diagnosticsLabel.text=snapshot.headline+
                if(diagnosticsExpanded)"  ▴" else "  ▾"
            diagnosticsBody.text=if(diagnosticsExpanded)
                snapshot.details else snapshot.short
        }
    }
    private val hideNotice=Runnable{snackbar.visibility=View.GONE}
    private fun renderTop(s: AtlasState) {
        top.removeAllViews();topSourceBadge=null;top.visibility=if(s.navigating||fullMap||page!=null)View.GONE else View.VISIBLE
        val header=ui.row()
        val brand=ui.row().apply {
            background=ui.shape(ui.surface,16)
            setPadding(ui.dp(11),ui.dp(9),ui.dp(13),ui.dp(9))
            elevation=ui.dp(2).toFloat()
            addView(ui.icon("explore",ui.blue,19))
            addView(ui.text("ATLAS",13f,bold=true).apply{letterSpacing=.11f},
                LinearLayout.LayoutParams(-2,-2).apply{leftMargin=ui.dp(8)})
            contentDescription="Atlas"
        }
        header.addView(brand)
        header.addView(View(this),LinearLayout.LayoutParams(0,1,1f))
        header.addView(ui.iconButton("download","Offline regions"){openPage("regions")},LinearLayout.LayoutParams(ui.dp(46),ui.dp(46)).apply{rightMargin=ui.dp(9)})
        header.addView(ui.iconButton("menu","Open menu"){showMenu()},LinearLayout.LayoutParams(ui.dp(46),ui.dp(46)))
        top.addView(header)
        val search=ui.row().apply {
            ui.ripple(this,ui.surface,18);setPadding(ui.dp(15),ui.dp(12),ui.dp(13),ui.dp(12));elevation=ui.dp(3).toFloat();contentDescription="Search places"
            addView(ui.icon("search",ui.blue,23));addView(ui.text(if(s.tab=="Navigation")"Where to?" else "Search places or addresses",15f,ui.muted),LinearLayout.LayoutParams(0,-2,1f).apply{leftMargin=ui.dp(12)})
            addView(ui.icon("chevron",ui.muted,18));setOnClickListener{openSearch()}
        }
        if(s.tab!="Trail")top.addView(search,linear(12))
        if(s.tab=="Explore"&&!landscape){
            val categories=HorizontalScrollView(this).apply{isHorizontalScrollBarEnabled=false;clipToPadding=false}
            val row=ui.row()
            listOf(Triple("cafe","Coffee","cafe"),Triple("restaurant","Food","food"),Triple("museum","Culture","explore"),Triple("park","Outdoors","map")).forEach{(category,label,icon)->
                row.addView(ui.chip(label,icon,s.category==category&&s.nearby){selectedPlace=null;model.search("",true,category,atlasMap.centerPoint)},LinearLayout.LayoutParams(-2,-2).apply{rightMargin=ui.dp(8)})
            };categories.addView(row);top.addView(categories,linear(12))
        }
        val info=ui.row().apply{setPadding(ui.dp(2),ui.dp(10),0,0)}
        val region=model.regions.regions.firstOrNull{model.regions.installed(it)&&it.contains(model.anchor)}
        val label=mapSourceLabel() +
            (if(s.downloading!=null)" · Downloading ${s.downloadPercent}%"
             else if(region!=null&&atlasMap.activeMapSource==MapSourcePolicy.ONLINE)" · Offline routes"
             else "")
        val badge=ui.badge(label,atlasMap.activeMapSource==MapSourcePolicy.OFFLINE).apply{
            contentDescription="Change map source"
            setOnClickListener{showMapSourceOptions()}
        }
        topSourceBadge=badge
        info.addView(badge)
        if(!hasLocation())info.addView(ui.chip("Enable location","locate"){enableLocation()},LinearLayout.LayoutParams(-2,-2).apply{leftMargin=ui.dp(9)})
        top.addView(info)
    }
    private fun renderControls(s: AtlasState) {
        controls.removeAllViews()
        // Expanding Trail prioritises the library: map controls remain available
        // again on collapse and cannot overlap the expanded sheet.
        controls.visibility=if(page!=null || (s.tab=="Trail" && trailExpanded && !landscape))
            View.GONE else View.VISIBLE
        fun add(name:String,label:String,selected:Boolean=false,click:()->Unit){controls.addView(ui.iconButton(name,label,selected,click),LinearLayout.LayoutParams(ui.dp(48),ui.dp(48)).apply{topMargin=ui.dp(10)})}
        add("compass",if(atlasMap.headingUp)"Switch to north up" else "Switch to heading up"){atlasMap.compass();rebuildChrome()}
        add("layers","Map layers: ${mapVisualLabel()}"){showMapLayersOptions()}
        add("locate","Recenter on my location",atlasMap.follow){if(hasLocation()){atlasMap.recenter();rebuildChrome()}else enableLocation()}
        if (s.navigating) {
            // The main Atlas menu disappears during live navigation. Give
            // telemetry its own always-accessible on-map control without
            // stopping navigation or hiding the guidance banner.
            val gpsButton = ui.iconButton("diagnostics",
                if (model.diagnosticsEnabled) "Hide GPS diagnostics" else "Show GPS diagnostics",
                model.diagnosticsEnabled) {
                model.diagnosticsEnabled = !model.diagnosticsEnabled
                diagnosticsExpanded = false
                rebuildChrome()
            }
            gpsButton.setOnLongClickListener { openPage("diagnostics"); true }
            controls.addView(gpsButton,LinearLayout.LayoutParams(ui.dp(48),ui.dp(48))
                .apply { topMargin = ui.dp(10) })
        }
        if(!s.navigating)add("expand",if(fullMap)"Show controls" else "Full map"){fullMap=!fullMap;rebuildChrome()}
    }
    private fun renderTabs(s: AtlasState) {
        navigation.removeAllViews();navigation.visibility=if(s.navigating||fullMap||(page!=null&&page!="trips"))View.GONE else View.VISIBLE
        navigation.background=ui.shape(ui.surface,25);navigation.elevation=ui.dp(if(page=="trips")20 else 8).toFloat();navigation.setPadding(ui.dp(7),ui.dp(6),ui.dp(7),ui.dp(6))
        listOf(Triple("Explore","explore","Explore"),Triple("Trail","trail","Trail"),Triple("Navigation","navigate","Navigate")).forEach{(tab,icon,label)->
            val active=s.tab==tab;val item=ui.column().apply{
                gravity=Gravity.CENTER;ui.ripple(this,if(active)ui.soft else ui.surface,19);contentDescription="$label tab"
                addView(ui.icon(icon,if(active)ui.blue else ui.muted,22));addView(ui.space(4));addView(ui.text(label,11f,if(active)ui.blue else ui.muted,active).apply{gravity=Gravity.CENTER},LinearLayout.LayoutParams(-1,-2))
                setOnClickListener{fullMap=false;selectedPlace=null;model.tab(tab);if(page!=null)closePage();rebuildChrome()}
            };navigation.addView(item,LinearLayout.LayoutParams(0,-1,1f).apply{leftMargin=ui.dp(2);rightMargin=ui.dp(2)})
        }
    }
    private fun renderBottom(s: AtlasState) {
        bottom.visibility=if((page!=null&&page!="trips")||fullMap||page=="trips")View.GONE else View.VISIBLE
        if(s.navigating) {
            val existing = navigationSummaryCard
            if(existing == null || existing.parent !== bottom) {
                bottom.removeAllViews()
                bottom.addView(journeySummary(s))
            }
            updateJourneySummary(s)
            return
        }
        // Only rebuild the bottom panel on navigation-mode changes, never for
        // a GPS tick. The cached card cannot outlive an active route.
        navigationSummaryCard = null
        navigationArrival = null
        navigationRemaining = null
        navigationDistance = null
        navigationVoiceIcon = null
        bottom.removeAllViews()
        selectedPlace?.let{place->bottom.addView(placePeek(place));return}
        if(s.tab=="Navigation"){bottom.addView(planner(s));return}
        if(s.tab=="Trail"){bottom.addView(trailPanel());return}
        if(s.tab=="Explore"&&s.exploreResults.isNotEmpty()){
            val card=ui.card(14,true)
            card.addView(ui.row().apply{addView(ui.text("Nearby ${s.category.ifBlank{"places"}}",16f,bold=true),LinearLayout.LayoutParams(0,-2,1f));addView(ui.text("See all",12f,ui.blue,true).apply{setPadding(ui.dp(12),ui.dp(8),0,ui.dp(8));setOnClickListener{openPage("nearby")}})})
            s.exploreResults.take(if(landscape)1 else 2).forEach{place->card.addView(pages.placeRow(place),linear(4))}
            bottom.addView(card)
        }else if(pickingOrigin){bottom.addView(ui.card(16,true).apply{addView(ui.text("Choose your starting point",17f,bold=true));addView(ui.space(6));addView(ui.text("Press and hold a point on the map",13f,ui.muted))})}
        else if(s.tab=="Explore"&&s.searching){bottom.addView(ui.card(15,true).apply{addView(ui.row().apply{addView(ProgressBar(this@MainActivity),LinearLayout.LayoutParams(ui.dp(22),ui.dp(22)));addView(ui.text("Finding nearby places…",13f,ui.muted),LinearLayout.LayoutParams(-2,-2).apply{leftMargin=ui.dp(13)})})})}
        else if(s.tab=="Explore"&&s.searchError!=null&&s.nearby){bottom.addView(ui.card(16,true).apply{addView(ui.text("Explore offline",17f,bold=true));addView(ui.space(7));addView(ui.text("Download a region to discover nearby places.",13f,ui.muted));addView(ui.action("Browse regions","download",false){openPage("regions")},linear(12))})}
    }
    private fun trailPanel(): View {
        val panel = ui.card(18, true)
        val grip = ui.text("━━━━", 18f, ui.muted, true).apply {
            gravity = Gravity.CENTER
            contentDescription = if (trailExpanded) "Collapse trails" else "Expand trails"
            setPadding(0, 0, 0, ui.dp(12))
            setOnClickListener { trailExpanded = !trailExpanded; rebuildChrome() }
            var touchY = 0f
            setOnTouchListener { _, event ->
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> { touchY = event.rawY; true }
                    MotionEvent.ACTION_UP -> {
                        trailExpanded = if (kotlin.math.abs(event.rawY - touchY) > ui.dp(26))
                            event.rawY < touchY else !trailExpanded
                        rebuildChrome()
                        true
                    }
                    else -> true
                }
            }
        }
        panel.addView(grip)
        panel.addView(ui.row().apply {
            addView(ui.column().apply {
                addView(ui.text("Your Trails", 20f, ui.ink, true))
                addView(ui.space(5))
                addView(ui.text("${trailList.size} saved · On this device", 12f, ui.muted))
            }, LinearLayout.LayoutParams(0, -2, 1f))
            addView(ui.iconButton("plus", "Import GPX KML KMZ or GeoJSON") {
                openTrailImportSheet()
            }, LinearLayout.LayoutParams(ui.dp(48), ui.dp(48)))
        })
        if (trailList.isEmpty()) {
            panel.addView(ui.text("GPX · KML · KMZ · GeoJSON", 12f, ui.muted), linear(13))
            panel.addView(ui.action("Import a trail", "upload") {
                openTrailImportSheet()
            }, linear(12))
        } else {
            val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false }
            val list = ui.column()
            trailList.take(if (trailExpanded) 40 else 2).forEach { trail ->
                list.addView(trailCard(trail), linear(8))
            }
            if (!trailExpanded && trailList.size > 2) {
                list.addView(ui.action("Show all ${trailList.size} trails", "down", false) {
                    trailExpanded = true
                    rebuildChrome()
                }, linear(10))
            }
            scroll.addView(list)
            panel.addView(scroll, LinearLayout.LayoutParams(-1,
                if (trailExpanded) (resources.displayMetrics.heightPixels * .53).toInt() else -2
            ).apply { topMargin = ui.dp(12) })
            trailList.firstOrNull { it.id == selectedTrailId }?.let { trail ->
                panel.addView(ui.rule().apply {
                    layoutParams = linear(12)
                })
                panel.addView(ui.row().apply {
                    addView(ui.text("${AtlasPages.formatDistance(trail.distanceMeters)} · +${trail.ascentMeters.toInt()} m",
                        13f, ui.muted, true), LinearLayout.LayoutParams(0, -2, 1f))
                    addView(ui.text("Details", 13f, ui.blue, true).apply {
                        contentDescription = "Trail details and actions"
                        setPadding(ui.dp(12), ui.dp(8), 0, ui.dp(8))
                        setOnClickListener { showTrailDetails(trail) }
                    })
                })
            }
        }
        return panel
    }

    private fun trailCard(trail: Trail): View = ui.row().apply {
        ui.ripple(this, if (selectedTrailId == trail.id) ui.soft else ui.surface, 17)
        setPadding(ui.dp(9), ui.dp(9), ui.dp(9), ui.dp(9))
        val photo = ImageView(this@MainActivity).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP
            setImageBitmap(trails.thumbnail(trail))
            background = ui.shape(ui.soft, 13)
            clipToOutline = true
            contentDescription = "Trail photo or route thumbnail"
        }
        addView(photo, LinearLayout.LayoutParams(ui.dp(92), ui.dp(78)))
        addView(ui.column().apply {
            addView(ui.text(trail.name, 15f, ui.ink, true).apply {
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
            })
            addView(ui.space(7))
            addView(ui.text("${AtlasPages.formatDistance(trail.distanceMeters)} · ↗ ${trail.ascentMeters.toInt()} m",
                12f, ui.muted))
            addView(ui.space(7))
            addView(ui.row().apply {
                addView(ui.badge(trail.format))
                trail.durationMillis?.let {
                    addView(ui.text(AtlasPages.formatTime(it / 1000.0),
                        11f, ui.muted).apply {
                        setPadding(ui.dp(9), ui.dp(5), 0, 0)
                    })
                }
            })
        }, LinearLayout.LayoutParams(0, -2, 1f).apply {
            leftMargin = ui.dp(12)
        })
        addView(ui.icon("chevron", ui.muted, 16))
        contentDescription = "Preview trail ${trail.name}"
        setOnClickListener {
            selectedTrailId = trail.id
            trailExpanded = false
            atlasMap.previewTrail(trail)
            rebuildChrome()
        }
    }

    private fun showTrailDetails(trail: Trail) {
        val panel = trailSheet(trail.name, "${trail.format} · Stored privately on your device")
        panel.addView(ui.row().apply {
            for ((value, label) in listOf(
                AtlasPages.formatDistance(trail.distanceMeters) to "Distance",
                "+${trail.ascentMeters.toInt()} m" to "Ascent",
                "-${trail.descentMeters.toInt()} m" to "Descent"
            )) addView(ui.stat(value, label), LinearLayout.LayoutParams(0, -2, 1f))
        })
        panel.addView(ui.space(18))
        val photo = ui.action("Change cover photo", "upload", false) { }
        val remove = ui.action("Remove from library", "trash", false) { }
        val close = ui.action("Back to map", "map") { }
        panel.addView(photo, linear(6))
        panel.addView(remove, linear(8))
        panel.addView(close, linear(12))
        val dialog = showTrailSheet(panel)
        photo.setOnClickListener {
            dialog.dismiss()
            trailCoverTargetId = trail.id
            pickTrailCover.launch(arrayOf("image/*"))
        }
        remove.setOnClickListener {
            dialog.dismiss()
            AlertDialog.Builder(this)
                .setTitle("Remove trail?")
                .setMessage("Remove ${trail.name} from this device? This cannot be undone.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Remove") { _, _ ->
                    trails.remove(trail.id)
                    trailList = trails.all()
                    if (selectedTrailId == trail.id) selectedTrailId = null
                    atlasMap.previewTrail(trailList.firstOrNull { it.id == selectedTrailId })
                    rebuildChrome()
                }
                .show()
        }
        close.setOnClickListener { dialog.dismiss() }
    }

    private fun placePeek(place: JSONObject): View = ui.card(18,true).apply {
        addView(ui.row().apply{
            addView(ui.tileIcon("pin"),LinearLayout.LayoutParams(ui.dp(42),ui.dp(42)))
            addView(ui.column().apply{addView(ui.text(place.optString("name"),18f,bold=true).apply{maxLines=2});addView(ui.space(5));addView(ui.text(place.optString("type","Selected place"),12f,ui.muted))},LinearLayout.LayoutParams(0,-2,1f).apply{leftMargin=ui.dp(12)})
            addView(ui.iconButton("close","Close place"){selectedPlace=null;rebuildChrome()},LinearLayout.LayoutParams(ui.dp(40),ui.dp(40)))
        })
        addView(ui.row().apply{
            addView(ui.action("Navigate","navigate"){selectDestination(place)},LinearLayout.LayoutParams(0,-2,1f))
            addView(ui.iconButton(if(model.isSaved(place))"check" else "bookmark","Save place",model.isSaved(place)){model.bookmark(place)},LinearLayout.LayoutParams(ui.dp(48),ui.dp(48)).apply{leftMargin=ui.dp(9)})
            addView(ui.iconButton("explore","Explore nearby"){selectedPlace=null;model.tab("Explore");model.search("",true,anchor=place.coordinate())},LinearLayout.LayoutParams(ui.dp(48),ui.dp(48)).apply{leftMargin=ui.dp(9)})
        },linear(17))
    }
    private fun planner(s: AtlasState): View {
        val card=ui.card(if(landscape)14 else 18,true)
        if(s.destination==null){
            card.setPadding(ui.dp(13),ui.dp(13),ui.dp(13),ui.dp(13))
            card.addView(ui.row().apply {
                addView(ui.tileIcon("pin"),LinearLayout.LayoutParams(ui.dp(38),ui.dp(38)))
                addView(ui.column().apply {
                    addView(ui.text("Where are you heading?",16f,bold=true))
                    addView(ui.space(4))
                    addView(ui.text("Search a destination",12f,ui.muted))
                },LinearLayout.LayoutParams(0,-2,1f).apply{leftMargin=ui.dp(11)})
                addView(ui.iconButton("search","Choose destination"){openSearch()},
                    LinearLayout.LayoutParams(ui.dp(44),ui.dp(44)))
            })
            return card
        }
        val compact=(previewCollapsed||landscape)&&s.route!=null
        val title=ui.row().apply{
            addView(ui.tileIcon(if(s.arrived)"check" else "pin",if(s.arrived)ui.green else ui.blue),LinearLayout.LayoutParams(ui.dp(38),ui.dp(38)))
            addView(ui.column().apply{
                addView(ui.text(if(s.arrived)"You have arrived" else s.destination.optString("name"),if(compact)16f else 18f,bold=true).apply{maxLines=1;ellipsize=android.text.TextUtils.TruncateAt.END})
                addView(ui.space(5));addView(ui.text(if(s.origin==null)"From your location" else "From selected start",12f,ui.muted))
            },LinearLayout.LayoutParams(0,-2,1f).apply{leftMargin=ui.dp(11)})
            addView(ui.iconButton(if(compact)"plus" else "close",if(compact)"Expand route" else "Change destination"){if(compact){previewCollapsed=false;rebuildChrome()}else openSearch()},LinearLayout.LayoutParams(ui.dp(38),ui.dp(38)))
        };card.addView(title)
        if(s.arrived){
            model.nextTripStop()?.let{next->card.addView(ui.action("Next stop","navigate"){selectDestination(next)},linear(16))}
            card.addView(ui.action("Back to exploring","explore",false){model.clearDestination();model.tab("Explore")},linear(10));return card
        }
        if(!compact){
            val modes=ui.row();listOf(Triple("drive","Drive","car"),Triple("walk","Walk","walk"),Triple("transit","Transit","transit")).forEach{(mode,label,icon)->
                modes.addView(ui.chip(label,icon,s.mode==mode){model.mode(mode);model.calculate()},LinearLayout.LayoutParams(0,ui.dp(39),1f).apply{rightMargin=ui.dp(5)})
            };card.addView(modes,linear(15))
            card.addView(ui.row().apply{
                addView(ui.text("Starting point",12f,ui.muted).apply{setPadding(0,ui.dp(9),0,ui.dp(9));setOnClickListener{originOptions()}},LinearLayout.LayoutParams(0,-2,1f))
                if(s.mode=="drive")addView(ui.text(if(s.avoidTolls)"Avoid tolls ✓" else "Toll options",12f,ui.blue,true).apply{setPadding(ui.dp(10),ui.dp(9),0,ui.dp(9));setOnClickListener{model.avoidTolls(!s.avoidTolls);model.calculate()}})
            },linear(3))
        }
        if(s.busy){
            card.addView(ui.row().apply{addView(ProgressBar(this@MainActivity),LinearLayout.LayoutParams(ui.dp(22),ui.dp(22)));addView(ui.text("Finding your route…",13f,ui.muted),LinearLayout.LayoutParams(-2,-2).apply{leftMargin=ui.dp(12)})},linear(17));return card
        }
        if(s.mode=="transit"){
            if(s.journeys.isNotEmpty()){card.addView(ui.text(TransitProvider().summary(s.journeys.first()),16f,bold=true),linear(12));card.addView(ui.action("View journeys","transit"){openPage("journeys")},linear(14))}
            else{card.addView(ui.text("Public transport is available in London.",12f,ui.muted),linear(10));card.addView(ui.action("Find journeys","transit"){model.calculate()},linear(13))};return card
        }
        val route=s.route
        if(route!=null){
            val stats="${AtlasPages.formatTime(route.getDouble("durationSeconds"))}  ·  ${AtlasPages.formatDistance(route.getDouble("distanceMeters"))}"
            card.addView(ui.row().apply{
                addView(ui.column().apply{addView(ui.text(stats,if(compact)15f else 18f,ui.green,true));if(!compact){addView(ui.space(5));addView(ui.text(if(s.walking)"Walking route" else if(route.optDouble("tollEuros")>0)"Estimated tolls €${"%.2f".format(route.optDouble("tollEuros"))}" else "No tolls on this route",12f,ui.muted))}},LinearLayout.LayoutParams(0,-2,1f))
                if(compact)addView(ui.action("Start","navigate"){startNavigation()},LinearLayout.LayoutParams(ui.dp(112),ui.dp(48)))
            },linear(15))
            RoadsideArrivalNotice.text(route.optDouble("destinationAccessMeters",0.0))?.let { note ->
                card.addView(ui.text(note,12f,ui.muted).apply{maxLines=3},linear(10))
            }
            if(!compact){
                if(s.routeOptions.size>1)card.addView(ui.row().apply{s.routeOptions.forEach{choice->addView(ui.chip(choice.optString("label"),selected=choice===route){model.chooseRoute(choice)},LinearLayout.LayoutParams(0,-2,1f).apply{rightMargin=ui.dp(6)})}},linear(13))
                card.addView(ui.action(if(s.origin==null)"Start navigation" else "View route","navigate"){if(s.origin==null)startNavigation()else atlasMap.overview()},linear(15))
            }
        }else{
            val installed=model.regions.regions.any{it.contains(model.anchor)&&model.regions.installed(it)}
            if(!installed){card.addView(ui.text("Download this region for offline directions.",12f,ui.muted),linear(10));card.addView(ui.action("Get offline directions","download"){openPage("regions")},linear(14))}
            else card.addView(ui.action("Calculate route","route"){model.calculate()},linear(15))
        }
        return card
    }
    private fun updateJourneySummary(s: AtlasState) {
        val seconds=s.guidance?.optDouble("seconds")?:s.route?.optDouble("durationSeconds")?:0.0
        val meters=s.guidance?.optDouble("remaining")?:s.route?.optDouble("distanceMeters")?:0.0
        val eta=SimpleDateFormat("HH:mm",Locale.getDefault()).format(Date(System.currentTimeMillis()+(seconds*1000).toLong()))
        navigationArrival?.text=eta
        navigationRemaining?.text=AtlasPages.formatTime(seconds)
        navigationDistance?.text=AtlasPages.formatDistance(meters)
        navigationVoiceIcon?.let { icon ->
            val required = if(model.voice)"volume" else "mute"
            if(icon.name!=required) { icon.name=required;icon.invalidate() }
        }
    }
    private fun journeySummary(s: AtlasState): View {
        navigationSummaryCard?.let { return it }
        val card=ui.card(16,true)
        val stats=ui.row()
        val arrival=ui.stat("","ARRIVAL")
        val time=ui.stat("","REMAINING")
        val distance=ui.stat("","DISTANCE")
        navigationArrival=arrival.getChildAt(0) as TextView
        navigationRemaining=time.getChildAt(0) as TextView
        navigationDistance=distance.getChildAt(0) as TextView
        stats.addView(arrival,LinearLayout.LayoutParams(0,-2,1f))
        stats.addView(time,LinearLayout.LayoutParams(0,-2,1f))
        stats.addView(distance,LinearLayout.LayoutParams(0,-2,1f))
        card.addView(stats)
        val actions=ui.row()
        actions.addView(ui.chip("Overview","route"){
            atlasMap.overview()
            // Never detach Overview just after its click while another
            // guidance/StateFlow emission is queued.
            rebuildChrome()
        },LinearLayout.LayoutParams(0,-2,1f))
        val voice=ui.iconButton(if(model.voice)"volume" else "mute","Toggle voice guidance"){
            model.voice=!model.voice
            navigationVoiceIcon?.let { icon ->
                icon.name=if(model.voice)"volume" else "mute"
                icon.invalidate()
            }
        }
        navigationVoiceIcon=voice.getChildAt(0) as AtlasIcon
        actions.addView(voice,LinearLayout.LayoutParams(ui.dp(42),ui.dp(42)).apply{leftMargin=ui.dp(7)})
        actions.addView(ui.text("End",13f,ui.red,true).apply{
            gravity=Gravity.CENTER
            setPadding(ui.dp(18),ui.dp(12),ui.dp(5),ui.dp(12))
            contentDescription="End navigation"
            setOnClickListener{confirm("End this navigation?"){endNavigation()}}
        })
        card.addView(actions,linear(14))
        navigationSummaryCard=card
        updateJourneySummary(s)
        return card
    }
    private fun renderGuidance(s: AtlasState) {
        guidance.removeAllViews();guidance.visibility=if(s.navigating&&page==null)View.VISIBLE else View.GONE
        if(!s.navigating)return
        val index=s.guidance?.optInt("maneuver")?:0
        val maneuver=s.route?.optJSONArray("maneuvers")?.optJSONObject(index)
        val distance=s.guidance?.optDouble("toManeuver")?:0.0
        val type=maneuver?.optString("type").orEmpty()
        val instruction=GuidanceInstructionPresentation.format(
            maneuver?.optString("instruction"))
        val icon=when{type.contains("roundabout")->"roundabout";type.contains("left")->"arrow-left";type.contains("right")->"arrow-right";type=="arrive"->"flag";else->"arrow"}
        val banner=ui.row().apply{
            background=ui.shape(Color.rgb(24,42,66),24);elevation=ui.dp(7).toFloat();setPadding(ui.dp(20),ui.dp(20),ui.dp(18),ui.dp(20))
            addView(ui.icon(icon,Color.WHITE,44),LinearLayout.LayoutParams(ui.dp(44),ui.dp(52)))
            addView(ui.column().apply{
                addView(ui.text(if(distance<=20)"Now" else AtlasPages.formatDistance(distance),30f,Color.WHITE,true))
                addView(ui.space(9))
                // Action first, destination/road references beneath it. Never
                // display raw semicolon-delimited OSM destination tags.
                addView(ui.text(instruction.action,17f,Color.WHITE,true).apply{maxLines=2})
                instruction.destination?.let { destination ->
                    addView(ui.space(6))
                    addView(ui.text(destination,13f,Color.rgb(226,235,248)).apply {
                        maxLines=3
                        ellipsize=android.text.TextUtils.TruncateAt.END
                    })
                }
                val lanes=maneuver?.optString("turnLanes").orEmpty().split('|')
                if(distance<=350&&lanes.size>1){addView(ui.space(12));addView(ui.text(lanes.joinToString("    "){when{it.contains("left")->"←";it.contains("right")->"→";else->"↑"}},23f,Color.WHITE))}
            },LinearLayout.LayoutParams(0,-2,1f).apply{leftMargin=ui.dp(18)})
        };guidance.addView(banner)
        val accessGap=s.route?.optDouble("destinationAccessMeters",0.0)?:0.0
        val remaining=s.guidance?.optDouble("remaining",Double.POSITIVE_INFINITY)
            ?:Double.POSITIVE_INFINITY
        if(remaining<=350.0)RoadsideArrivalNotice.text(accessGap)?.let { notice ->
            guidance.addView(ui.text(notice,12f,ui.ink,true).apply{
                background=ui.shape(ui.surface,14)
                setPadding(ui.dp(12),ui.dp(9),ui.dp(12),ui.dp(9))
            },linear(9))
        }
        val confidence=s.guidance?.optString("state")
        if(confidence=="reduced"||confidence=="checking")guidance.addView(ui.text(if(confidence=="reduced")"GPS accuracy reduced · Keeping your route" else "Checking your route…",12f,ui.ink,true).apply{background=ui.shape(ui.surface,14);setPadding(ui.dp(14),ui.dp(11),ui.dp(14),ui.dp(11))},linear(9))
    }
    private fun endNavigation() {
        selectedPlace = null
        previewCollapsed = false
        fullMap = false
        model.endNavigation()
        // Restore normal exploration framing and prevent stale navigation
        // camera state from persisting after leaving turn-by-turn guidance.
        atlasMap.endNavigation()
        rebuildChrome()
    }
    private fun startNavigation(){
        if (!hasLocation()) { enableLocation(); return }
        atlasMap.follow=true;previewCollapsed=false;selectedPlace=null;model.start()
    }
    private fun selectDestination(place:JSONObject){
        if(searchTarget=="origin"){searchTarget="destination";model.origin(place.coordinate());closePage();model.updates.value.destination?.let{model.calculate()};return}
        selectedPlace=null;previewCollapsed=false;model.select(place);closePage();atlasMap.center(place.coordinate())
        if(model.updates.value.fix!=null||model.updates.value.origin!=null)model.calculate()
    }
    private fun originOptions(){
        showChoices("Starting point",listOf("My location" to "locate","Search for a place" to "search","Choose on the map" to "map")){index->when(index){
            0->{model.origin(null);model.calculate()};1->{searchTarget="origin";openPage("search")};2->{pickingOrigin=true;model.tab("Explore");closePage();model.status("Press and hold the starting point on the map")}
        }}
    }
    /** Passive refresh on MapLibre callbacks: preserve views being touched. */
    private fun updateMapSourceIndicators() {
        if (!::mapSourceBadge.isInitialized) return
        mapSourceBadge.text=when(atlasMap.activeMapSource) {
            MapSourcePolicy.OFFLINE -> "OFFLINE · STREETS"
            MapSourcePolicy.ONLINE -> when(atlasMap.activeVisualStyle) {
                MapVisualStyle.SATELLITE -> "SATELLITE · ONLINE"
                MapVisualStyle.HYBRID -> "HYBRID · ONLINE"
                else -> "STREETS · ONLINE"
            }
            MapSourcePolicy.UNAVAILABLE -> "OFFLINE MAP UNAVAILABLE"
            else -> "MAP · LOADING"
        }
        val imagery=atlasMap.activeVisualStyle!=MapVisualStyle.STREETS
        credit.text=if(imagery)"© Esri · Imagery contributors"
            else "© OpenStreetMap · OpenFreeMap"
        credit.setOnClickListener {
            startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(
                if(imagery)"https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9"
                else "https://www.openstreetmap.org/copyright"
            )))
        }
        val state=model.updates.value
        val region=model.regions.regions.firstOrNull {
            model.regions.installed(it)&&it.contains(model.anchor)
        }
        topSourceBadge?.text=mapSourceLabel() +
            (if(state.downloading!=null)" · Downloading ${state.downloadPercent}%"
             else if(region!=null&&atlasMap.activeMapSource==MapSourcePolicy.ONLINE)" · Offline routes"
             else "")
    }
    private fun mapSourceLabel(): String = when(atlasMap.activeMapSource) {
        MapSourcePolicy.OFFLINE -> "Offline streets"
        MapSourcePolicy.ONLINE -> when(atlasMap.activeVisualStyle) {
            MapVisualStyle.SATELLITE -> "Satellite · Online"
            MapVisualStyle.HYBRID -> "Hybrid · Online"
            else -> "Streets · Online"
        }
        MapSourcePolicy.UNAVAILABLE -> "Offline map unavailable"
        else -> "Loading map"
    }
    private fun mapVisualLabel():String = when(atlasMap.activeVisualStyle) {
        MapVisualStyle.SATELLITE -> "Satellite"
        MapVisualStyle.HYBRID -> "Hybrid"
        else -> "Streets"
    }
    private fun showMapLayersOptions() {
        val choices=listOf(
            Triple("Streets · Atlas cartography",MapVisualStyle.STREETS,"map"),
            Triple("Satellite · aerial imagery (online)",MapVisualStyle.SATELLITE,"layers"),
            Triple("Hybrid · aerial imagery with labels (online)",MapVisualStyle.HYBRID,"layers")
        )
        showChoices("Map layers",choices.map{(label,style,icon)->
            (if(model.mapVisualStyle==style)"✓  " else "")+label to icon
        }) { selected ->
            val chosen=choices[selected].second
            if(chosen!=MapVisualStyle.STREETS && model.mapSourceMode==MapSourcePolicy.OFFLINE) {
                model.status("Satellite needs internet. Switch the map source to Auto or Online.")
                return@showChoices
            }
            model.mapVisualStyle=chosen
            rebuildChrome()
        }
    }
    private fun showMapSourceOptions() {
        val choices=listOf(
            Triple("Automatic · prefer downloaded map",MapSourcePolicy.AUTO,"map"),
            Triple("Online · use internet maps",MapSourcePolicy.ONLINE,"map"),
            Triple("Offline · downloaded maps only",MapSourcePolicy.OFFLINE,"download")
        )
        showChoices("Map source",choices.map { (title, mode, icon) ->
            (if(model.mapSourceMode==mode)"✓  " else "")+title to icon
        }) { selected ->
            val mode=choices[selected].second
            val state=model.updates.value
            val point=if(state.navigating&&state.fix!=null)state.fix.point else atlasMap.centerPoint
            if(mode==MapSourcePolicy.OFFLINE&&model.regions.map(point)==null) {
                model.status("No offline map here. Download this region first.")
                openPage("regions")
            } else {
                model.mapSourceMode=mode
                rebuildChrome()
            }
        }
    }
    private fun openSearch(){searchTarget="destination";model.clearSearch();openPage("search")}
    private fun openPage(name:String){
        if(name=="mapSource"){showMapSourceOptions();return}
        if(name=="mapLayers"){showMapLayersOptions();return}
        if(name=="map"){closePage();return}
        if(name=="trips")model.tab("Trip")
        page=name;pageKey=null;pageLayer.removeAllViews();pageLayer.visibility=View.VISIBLE
        val header=ui.row().apply{setPadding(ui.dp(16),ui.dp(14),ui.dp(20),ui.dp(14));setBackgroundColor(ui.canvas)}
        header.addView(ui.iconButton("back","Back"){backPage()},LinearLayout.LayoutParams(ui.dp(42),ui.dp(42)))
        val title=when(name){"diagnostics"->"Diagnostics";"search"->if(searchTarget=="origin")"Starting point" else "Find a place";"regions"->"Offline regions";"trips"->"Your trips";"bookmarks"->"Saved places";"nearby"->"Around you";"journeys"->"Public transport";"journey"->"Your journey";"appearance"->"Appearance";"vehicle"->"Vehicle class";else->"Settings"}
        header.addView(ui.text(title,21f,bold=true),LinearLayout.LayoutParams(0,-2,1f).apply{leftMargin=ui.dp(14)})
        if(name=="trips")header.addView(ui.iconButton("upload","Import trip"){importTrip.launch(arrayOf("application/json","text/*"))},LinearLayout.LayoutParams(ui.dp(42),ui.dp(42)))
        pageLayer.addView(header)
        if(name=="search"){
            val field=ui.row().apply{background=ui.shape(ui.surface,18);setPadding(ui.dp(14),0,ui.dp(10),0)}
            field.addView(ui.icon("search",ui.blue,22))
            searchInput=EditText(this).apply{
                hint="Search places or addresses";textSize=15f;setTextColor(ui.ink);setHintTextColor(ui.muted);setSingleLine(true);background=null;setPadding(ui.dp(10),ui.dp(14),ui.dp(5),ui.dp(14));imeOptions=android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH
                setText(model.updates.value.searchQuery)
                addTextChangedListener(object:TextWatcher{override fun beforeTextChanged(s:CharSequence?,start:Int,count:Int,after:Int){};override fun onTextChanged(s:CharSequence?,start:Int,before:Int,count:Int){model.search(s.toString())};override fun afterTextChanged(s:Editable?){} })
                setOnEditorActionListener{_,_,_->hideKeyboard();true}
            };field.addView(searchInput,LinearLayout.LayoutParams(0,ui.dp(52),1f))
            field.addView(ui.iconButton("close","Clear search"){searchInput?.setText("")},LinearLayout.LayoutParams(ui.dp(38),ui.dp(38)))
            pageLayer.addView(field,LinearLayout.LayoutParams(-1,-2).apply{leftMargin=ui.dp(20);rightMargin=ui.dp(20);bottomMargin=ui.dp(8)})
        }else searchInput=null
        pageBody=FrameLayout(this);pageLayer.addView(pageBody,LinearLayout.LayoutParams(-1,0,1f))
        rebuildChrome();updatePage(model.updates.value)
    }
    private fun backPage(){when(page){
        "diagnostics" -> if(model.updates.value.navigating) closePage() else openPage("settings")
        "appearance","vehicle" -> openPage("settings")
        "journey" -> openPage("journeys")
        else -> closePage()
    }}
    private fun closePage(){hideKeyboard();val was=page;page=null;searchInput=null;pageKey=null;pageLayer.visibility=View.GONE;if(was=="trips"&&model.updates.value.tab=="Trip")model.tab("Explore");rebuildChrome()}
    private fun updatePage(s:AtlasState){
        val currentPage=page?:return
        val key=listOf(currentPage,model.diagnosticsEnabled,s.results,s.exploreResults,s.searching,s.searchQuery,s.searchError,s.revision,s.downloading,s.downloadPercent,s.downloadError,s.journeys,s.journey,s.journeyLeg,s.journeyPhase,model.voice,model.vehicleClass,model.mapSourceMode)
        if(key==pageKey)return;pageKey=key
        val content=when(currentPage){"diagnostics"->pages.diagnostics(s);"search"->pages.search(s);"nearby"->pages.nearby(s);"regions"->pages.regions(s);"bookmarks"->pages.bookmarks();"trips"->pages.trips();"journeys"->pages.journeys(s);"journey"->pages.journey(s);"appearance"->pages.appearance();"vehicle"->pages.vehicle();else->pages.settings()}
        val oldScroll=if(currentPage!="search")pageBody.getChildAt(0)?.scrollY?:0 else 0
        pageBody.removeAllViews();pageBody.addView(content,FrameLayout.LayoutParams(-1,-1))
        if(oldScroll>0)content.post{content.scrollTo(0,oldScroll)}
        layoutChrome()
        if(currentPage=="trips"){navigation.bringToFront();snackbar.bringToFront()}
    }
    private fun showMenu(){showChoices("Atlas",listOf("Saved places" to "bookmark","Offline regions" to "download","Your trips" to "trip","Diagnostics" to "compass","Settings" to "sun")){index->openPage(listOf("bookmarks","regions","trips","diagnostics","settings")[index])}}
    private fun showChoices(title:String,options:List<Pair<String,String>>,select:(Int)->Unit){
        val card=ui.card(22);card.addView(ui.text(title,23f,bold=true));card.addView(ui.space(16))
        val dialog=AlertDialog.Builder(this).setView(card).create()
        options.forEachIndexed{index,(label,icon)->card.addView(ui.action(label,icon,false){dialog.dismiss();select(index)},linear(9))}
        dialog.setOnShowListener{dialog.window?.setBackgroundDrawableResource(android.R.color.transparent);dialog.window?.setLayout((resources.displayMetrics.widthPixels-ui.dp(40)).coerceAtMost(ui.dp(400)),-2)};dialog.show()
    }
    private fun confirm(message:String,action:()->Unit){
        val card=ui.card(23);card.addView(ui.text(message,21f,bold=true));card.addView(ui.space(18))
        val dialog=AlertDialog.Builder(this).setView(card).create()
        card.addView(ui.action("Confirm",primary=true){dialog.dismiss();action()});card.addView(ui.action("Cancel",primary=false){dialog.dismiss()},linear(10))
        dialog.setOnShowListener{dialog.window?.setBackgroundDrawableResource(android.R.color.transparent);dialog.window?.setLayout((resources.displayMetrics.widthPixels-ui.dp(40)).coerceAtMost(ui.dp(400)),-2)};dialog.show()
    }
    private fun hideKeyboard(){(getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(root.windowToken,0);searchInput?.clearFocus()}
    private fun syncNavigationService(navigating: Boolean) {
        if (navigating == foregroundNavigationRunning) return
        foregroundNavigationRunning = navigating
        val intent = Intent(this, NavigationService::class.java)
        if (navigating) {
            if (!hasLocation()) {
                model.status("Enable location to keep guidance running in the background.")
                return
            }
            manager.removeUpdates(this)
            try {
                ContextCompat.startForegroundService(this, intent.setAction(NavigationService.ACTION_START))
            } catch (e: RuntimeException) {
                model.status("Could not start background navigation: ${e.message ?: "Android restriction"}")
            }
        } else {
            stopService(intent)
            if (activityStarted) startGps()
        }
    }
    private fun hasLocation()=checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED
    private fun enableLocation(){
        val prefs=getSharedPreferences("atlas-ui",0)
        if(prefs.getBoolean("locationAsked",false)&&!shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION)&&!hasLocation()){
            confirm("Enable location for Atlas in Android settings?"){startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName")))}
        }else{prefs.edit().putBoolean("locationAsked",true).apply();requestPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION))}
    }
    private fun startGps(){if(!hasLocation()||foregroundNavigationRunning)return;try{
        for(provider in listOf(LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER))if(manager.isProviderEnabled(provider))manager.requestLocationUpdates(provider,1000L,0f,this)
    }catch(_:SecurityException){rebuildChrome()}}
    override fun onLocationChanged(location:Location){
        val time = location.elapsedRealtimeNanos / 1e9
        val accuracy = if (location.hasAccuracy())
            location.accuracy.toDouble().coerceAtLeast(0.0) else 100.0
        if (location.provider == LocationManager.GPS_PROVIDER && accuracy <= 45.0) {
            lastReliableGpsTime = time
        }
        // A less accurate network fix must not displace recent GPS guidance.
        if (location.provider == LocationManager.NETWORK_PROVIDER &&
            time - lastReliableGpsTime in 0.0..7.0) return
        model.fix(Fix(Coordinate(location.latitude, location.longitude), accuracy,
            if (location.hasSpeed()) location.speed.toDouble().coerceAtLeast(0.0) else -1.0,
            if (location.hasBearing()) location.bearing.toDouble() else null, time,
            if (location.hasBearing() && location.hasBearingAccuracy())
                location.bearingAccuracyDegrees.toDouble() else null,
            if (location.hasBearing()) location.bearing.toDouble() else null,
            provider=location.provider))
    }
    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ROTATION_VECTOR) return
        SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
        SensorManager.getOrientation(rotationMatrix, sensorAngles)
        // Orientation is relative to true device top; compensate screen rotation.
        // Activity.getDisplay() requires API 30; Atlas supports API 26.
        // WindowManager's legacy display rotation is supported on API 26+
        // and remains sufficient for orientation compensation.
        @Suppress("DEPRECATION")
        val rotation = windowManager.defaultDisplay.rotation
        val screenOffset = when (rotation) {
            Surface.ROTATION_90 -> 90.0
            Surface.ROTATION_180 -> 180.0
            Surface.ROTATION_270 -> 270.0
            else -> 0.0
        }
        atlasMap.setDeviceHeading(Math.toDegrees(sensorAngles[0].toDouble()) + screenOffset)
    }
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    override fun onProviderEnabled(provider:String){}
    override fun onProviderDisabled(provider:String){}
    @Deprecated("Deprecated in Android") override fun onStatusChanged(provider:String?,status:Int,extras:Bundle?){}
    override fun onStart(){
        super.onStart()
        activityStarted=true
        model.refreshRegionCatalog()
        atlasMap.onStart()
        startGps()
        rotationSensor?.let { sensors.registerListener(this, it, SensorManager.SENSOR_DELAY_UI) }
        handler.post(gapTick)
    }
    override fun onResume(){super.onResume();atlasMap.onResume();rebuildChrome()}
    override fun onPause(){atlasMap.onPause();super.onPause()}
    override fun onStop(){
        activityStarted=false
        handler.removeCallbacks(gapTick)
        sensors.unregisterListener(this)
        manager.removeUpdates(this)
        atlasMap.onStop()
        super.onStop()
    }
    override fun onLowMemory(){super.onLowMemory();atlasMap.onLowMemory()}
    override fun onSaveInstanceState(outState:Bundle){super.onSaveInstanceState(outState);val map=Bundle();atlasMap.onSaveInstanceState(map);outState.putBundle("map",map);outState.putString("page",page);outState.putString("peek",selectedPlace?.toString())}
    override fun onDestroy(){
        handler.removeCallbacksAndMessages(null)
        atlasMap.onDestroy()
        super.onDestroy()
    }
}
