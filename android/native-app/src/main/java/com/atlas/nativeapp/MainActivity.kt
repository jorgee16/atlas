package com.atlas.nativeapp

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.tts.TextToSpeech
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
import androidx.activity.viewModels
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

class MainActivity : ComponentActivity(), LocationListener {
    private val model: AtlasModel by viewModels()
    private lateinit var ui: AtlasUi
    private lateinit var atlasMap: AtlasMap
    private lateinit var pages: AtlasPages
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
    private var lastRoute: JSONObject? = null
    private val handler = Handler(Looper.getMainLooper())
    private var voice: TextToSpeech? = null
    private var voiceReady = false
    private val landscape get() = resources.configuration.screenWidthDp > resources.configuration.screenHeightDp
    private val manager by lazy { getSystemService(LOCATION_SERVICE) as LocationManager }
    private val requestPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { startGps(); rebuildChrome() }
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
        credit = ui.text("© OpenStreetMap · OpenFreeMap",9f,ui.muted).apply { setShadowLayer(2f,0f,0f,Color.WHITE); setOnClickListener { startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://www.openstreetmap.org/copyright"))) } }
        root.addView(credit,FrameLayout.LayoutParams(-2,-2,Gravity.BOTTOM or Gravity.START))
        pageLayer = ui.column().apply { setBackgroundColor(ui.canvas); visibility = View.GONE; elevation = ui.dp(12).toFloat(); isClickable = true }
        root.addView(pageLayer,FrameLayout.LayoutParams(-1,-1))
        snackbar = ui.text("",13f,Color.WHITE).apply { background=ui.shape(Color.rgb(24,32,47),16);setPadding(ui.dp(16),ui.dp(13),ui.dp(16),ui.dp(13));elevation=ui.dp(24).toFloat();visibility=View.GONE }
        root.addView(snackbar,FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM))
        pages = AtlasPages(this,ui,model,::selectDestination,::openPage,{importTrip.launch(arrayOf("application/json","text/*"))}, { theme -> model.theme=theme; recreate() },::confirm,{atlasMap.center(it)})
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
            when { page!=null -> backPage(); fullMap -> {fullMap=false;rebuildChrome()}; selectedPlace!=null -> {selectedPlace=null;rebuildChrome()}; model.updates.value.navigating -> confirm("End this navigation?"){model.stop()}; model.updates.value.tab!="Explore" -> model.tab("Explore"); else -> {isEnabled=false;onBackPressedDispatcher.onBackPressed()} }
        }})
        voice = TextToSpeech(this){code->voiceReady=code==TextToSpeech.SUCCESS;if(voiceReady)voice?.language=Locale.UK}
        model.speak={text->if(voiceReady)voice?.speak(text,TextToSpeech.QUEUE_FLUSH,null,"atlas-turn")}
        page=savedInstanceState?.getString("page")
        selectedPlace=savedInstanceState?.getString("peek")?.let{JSONObject(it)}
        lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.STARTED) { model.updates.collect { render(it) } } }
        val initialPage=page;page=null;if(initialPage!=null)openPage(initialPage)
        rebuildChrome()
    }
    override fun dispatchTouchEvent(event: MotionEvent): Boolean { if(event.actionMasked==MotionEvent.ACTION_DOWN)lastTouch=System.currentTimeMillis();return super.dispatchTouchEvent(event) }
    private fun layoutChrome() {
        val pad=ui.dp(16)
        val left=pad+leftInset;val right=pad+rightInset
        (top.layoutParams as FrameLayout.LayoutParams).apply { width=if(landscape)ui.dp(350) else -1;leftMargin=left;rightMargin=right;topMargin=topInset+ui.dp(12) }.also{top.layoutParams=it}
        (bottom.layoutParams as FrameLayout.LayoutParams).apply { width=if(landscape)ui.dp(340) else -1;gravity=Gravity.BOTTOM or if(landscape)Gravity.START else Gravity.CENTER_HORIZONTAL;leftMargin=left;rightMargin=right;bottomMargin=bottomInset+if(landscape||model.updates.value.navigating)ui.dp(16) else ui.dp(100) }.also{bottom.layoutParams=it}
        (navigation.layoutParams as FrameLayout.LayoutParams).apply {width=if(landscape)ui.dp(300) else -1;gravity=Gravity.BOTTOM or if(landscape)Gravity.END else Gravity.CENTER_HORIZONTAL;leftMargin=left;rightMargin=right;bottomMargin=bottomInset+ui.dp(14)}.also{navigation.layoutParams=it}
        (guidance.layoutParams as FrameLayout.LayoutParams).apply{width=if(landscape)ui.dp(360) else -1;leftMargin=left;rightMargin=right;topMargin=topInset+ui.dp(12)}.also{guidance.layoutParams=it}
        (controls.layoutParams as FrameLayout.LayoutParams).apply {
            val planning=model.updates.value.tab=="Navigation"&&!model.updates.value.navigating&&!fullMap
            gravity=Gravity.END or if(planning&&!landscape)Gravity.TOP else Gravity.BOTTOM
            rightMargin=right;topMargin=if(planning&&!landscape)topInset+ui.dp(165) else 0
            bottomMargin=if(planning&&!landscape)0 else bottomInset+if(model.updates.value.navigating)ui.dp(178) else ui.dp(118)
        }.also{controls.layoutParams=it}
        (credit.layoutParams as FrameLayout.LayoutParams).apply{leftMargin=leftInset+ui.dp(22);bottomMargin=bottomInset+if(model.updates.value.navigating)ui.dp(184)else ui.dp(88)}.also{credit.layoutParams=it}
        (snackbar.layoutParams as FrameLayout.LayoutParams).apply{leftMargin=leftInset+ui.dp(24);rightMargin=rightInset+ui.dp(24);bottomMargin=bottomInset+if(model.updates.value.navigating)ui.dp(180) else ui.dp(100)}.also{snackbar.layoutParams=it}
        pageLayer.setPadding(leftInset,topInset,rightInset,if(page=="trips")bottomInset+ui.dp(91) else bottomInset)
    }
    private fun linear(top: Int = 0) = LinearLayout.LayoutParams(-1,-2).apply{topMargin=ui.dp(top)}
    private fun rebuildChrome(){lastChrome=null;render(model.updates.value)}
    private fun render(state: AtlasState) {
        atlasMap.render(state)
        val chrome=listOf(state.tab,state.destination,state.route,state.guidance,state.mode,state.arrived,state.busy,state.navigating,state.routeOptions,state.journeys,state.journeyLeg,state.revision,state.downloading,state.downloadPercent,state.exploreResults,state.searching,state.searchError,selectedPlace,previewCollapsed,fullMap,hasLocation(),atlasMap.follow,atlasMap.headingUp)
        if(chrome!=lastChrome){lastChrome=chrome;renderTop(state);renderControls(state);renderBottom(state);renderTabs(state);renderGuidance(state);layoutChrome()}
        if(state.route!==lastRoute){lastRoute=state.route;if(state.route!=null&&!state.navigating){previewCollapsed=false;handler.postDelayed({if(System.currentTimeMillis()-lastTouch>8000&&page==null&&model.updates.value.route!=null&&!model.updates.value.navigating){previewCollapsed=true;rebuildChrome()}},12000)}}
        if(state.navigating)window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        updatePage(state)
        if(state.notice!=lastNotice){lastNotice=state.notice;if(state.status.isNotBlank()){snackbar.text=state.status;snackbar.visibility=View.VISIBLE;handler.removeCallbacks(hideNotice);handler.postDelayed(hideNotice,4500)}}
    }
    private val hideNotice=Runnable{snackbar.visibility=View.GONE}
    private fun renderTop(s: AtlasState) {
        top.removeAllViews();top.visibility=if(s.navigating||fullMap||page!=null)View.GONE else View.VISIBLE
        val header=ui.row()
        val brand=ui.row().apply {background=ui.shape(ui.surface,17);setPadding(ui.dp(13),ui.dp(11),ui.dp(14),ui.dp(11));elevation=ui.dp(3).toFloat();addView(ui.icon("explore",ui.blue,23));addView(ui.text("ATLAS",16f,bold=true).apply{letterSpacing=.14f},LinearLayout.LayoutParams(-2,-2).apply{leftMargin=ui.dp(9)});contentDescription="Atlas"}
        header.addView(brand)
        header.addView(View(this),LinearLayout.LayoutParams(0,1,1f))
        header.addView(ui.iconButton("download","Offline regions"){openPage("regions")},LinearLayout.LayoutParams(ui.dp(46),ui.dp(46)).apply{rightMargin=ui.dp(9)})
        header.addView(ui.iconButton("menu","Open menu"){showMenu()},LinearLayout.LayoutParams(ui.dp(46),ui.dp(46)))
        top.addView(header)
        val search=ui.row().apply {
            ui.ripple(this,ui.surface,20);setPadding(ui.dp(17),ui.dp(15),ui.dp(15),ui.dp(15));elevation=ui.dp(5).toFloat();contentDescription="Search places"
            addView(ui.icon("search",ui.blue,23));addView(ui.text(if(s.tab=="Navigation")"Where to?" else "Search places or addresses",15f,ui.muted),LinearLayout.LayoutParams(0,-2,1f).apply{leftMargin=ui.dp(12)})
            addView(ui.icon("chevron",ui.muted,18));setOnClickListener{openSearch()}
        }
        top.addView(search,linear(12))
        if(s.tab=="Explore"&&!landscape){
            val categories=HorizontalScrollView(this).apply{isHorizontalScrollBarEnabled=false;clipToPadding=false}
            val row=ui.row()
            listOf(Triple("cafe","Coffee","cafe"),Triple("restaurant","Food","food"),Triple("museum","Culture","explore"),Triple("park","Outdoors","map")).forEach{(category,label,icon)->
                row.addView(ui.chip(label,icon,s.category==category&&s.nearby){selectedPlace=null;model.search("",true,category,atlasMap.centerPoint)},LinearLayout.LayoutParams(-2,-2).apply{rightMargin=ui.dp(8)})
            };categories.addView(row);top.addView(categories,linear(12))
        }
        val info=ui.row().apply{setPadding(ui.dp(2),ui.dp(10),0,0)}
        val region=model.regions.regions.firstOrNull{model.regions.installed(it)&&it.contains(model.anchor)}
        val label=when{ s.downloading!=null -> "Downloading ${s.downloadPercent}%";region!=null&&region.assets.has("map")->"Offline map ready";region!=null->"Offline routes ready";else->"Online map" }
        info.addView(ui.badge(label,region!=null).apply{setOnClickListener{openPage("regions")}})
        if(!hasLocation())info.addView(ui.chip("Enable location","locate"){enableLocation()},LinearLayout.LayoutParams(-2,-2).apply{leftMargin=ui.dp(9)})
        top.addView(info)
    }
    private fun renderControls(s: AtlasState) {
        controls.removeAllViews();controls.visibility=if(page!=null)View.GONE else View.VISIBLE
        fun add(name:String,label:String,selected:Boolean=false,click:()->Unit){controls.addView(ui.iconButton(name,label,selected,click),LinearLayout.LayoutParams(ui.dp(48),ui.dp(48)).apply{topMargin=ui.dp(10)})}
        add("compass",if(atlasMap.headingUp)"Switch to north up" else "Switch to heading up"){atlasMap.compass();rebuildChrome()}
        add("locate","Recenter on my location",atlasMap.follow){if(hasLocation()){atlasMap.recenter();rebuildChrome()}else enableLocation()}
        if(!s.navigating)add("map",if(fullMap)"Show controls" else "Full map"){fullMap=!fullMap;rebuildChrome()}
    }
    private fun renderTabs(s: AtlasState) {
        navigation.removeAllViews();navigation.visibility=if(s.navigating||fullMap||(page!=null&&page!="trips"))View.GONE else View.VISIBLE
        navigation.background=ui.shape(ui.surface,25);navigation.elevation=ui.dp(if(page=="trips")20 else 8).toFloat();navigation.setPadding(ui.dp(7),ui.dp(6),ui.dp(7),ui.dp(6))
        listOf(Triple("Explore","explore","Explore"),Triple("Trip","trip","Trip"),Triple("Navigation","navigate","Navigate")).forEach{(tab,icon,label)->
            val active=s.tab==tab;val item=ui.column().apply{
                gravity=Gravity.CENTER;ui.ripple(this,if(active)ui.soft else ui.surface,19);contentDescription="$label tab"
                addView(ui.icon(icon,if(active)ui.blue else ui.muted,22));addView(ui.space(4));addView(ui.text(label,11f,if(active)ui.blue else ui.muted,active).apply{gravity=Gravity.CENTER},LinearLayout.LayoutParams(-1,-2))
                setOnClickListener{fullMap=false;selectedPlace=null;model.tab(tab);if(tab=="Trip")openPage("trips")else closePage();rebuildChrome()}
            };navigation.addView(item,LinearLayout.LayoutParams(0,-1,1f).apply{leftMargin=ui.dp(2);rightMargin=ui.dp(2)})
        }
    }
    private fun renderBottom(s: AtlasState) {
        bottom.removeAllViews();bottom.visibility=if((page!=null&&page!="trips")||fullMap||page=="trips")View.GONE else View.VISIBLE
        if(s.navigating){bottom.addView(journeySummary(s));return}
        selectedPlace?.let{place->bottom.addView(placePeek(place));return}
        if(s.tab=="Navigation"){bottom.addView(planner(s));return}
        if(s.tab=="Explore"&&s.exploreResults.isNotEmpty()){
            val card=ui.card(14,true)
            card.addView(ui.row().apply{addView(ui.text("Nearby ${s.category.ifBlank{"places"}}",16f,bold=true),LinearLayout.LayoutParams(0,-2,1f));addView(ui.text("See all",12f,ui.blue,true).apply{setPadding(ui.dp(12),ui.dp(8),0,ui.dp(8));setOnClickListener{openPage("nearby")}})})
            s.exploreResults.take(if(landscape)1 else 2).forEach{place->card.addView(pages.placeRow(place),linear(4))}
            bottom.addView(card)
        }else if(pickingOrigin){bottom.addView(ui.card(16,true).apply{addView(ui.text("Choose your starting point",17f,bold=true));addView(ui.space(6));addView(ui.text("Press and hold a point on the map",13f,ui.muted))})}
        else if(s.tab=="Explore"&&s.searching){bottom.addView(ui.card(15,true).apply{addView(ui.row().apply{addView(ProgressBar(this@MainActivity),LinearLayout.LayoutParams(ui.dp(22),ui.dp(22)));addView(ui.text("Finding nearby places…",13f,ui.muted),LinearLayout.LayoutParams(-2,-2).apply{leftMargin=ui.dp(13)})})})}
        else if(s.tab=="Explore"&&s.searchError!=null&&s.nearby){bottom.addView(ui.card(16,true).apply{addView(ui.text("Explore offline",17f,bold=true));addView(ui.space(7));addView(ui.text("Download a region to discover nearby places.",13f,ui.muted));addView(ui.action("Browse regions","download",false){openPage("regions")},linear(12))})}
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
            card.addView(ui.text("Where are you heading?",21f,bold=true));card.addView(ui.space(8));card.addView(ui.text("Find a place. Let Atlas take you there.",13f,ui.muted))
            card.addView(ui.action("Choose destination","search"){openSearch()},linear(17));return card
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
    private fun journeySummary(s: AtlasState): View = ui.card(16,true).apply {
        val seconds=s.guidance?.optDouble("seconds")?:s.route?.optDouble("durationSeconds")?:0.0
        val meters=s.guidance?.optDouble("remaining")?:s.route?.optDouble("distanceMeters")?:0.0
        val eta=SimpleDateFormat("HH:mm",Locale.getDefault()).format(Date(System.currentTimeMillis()+(seconds*1000).toLong()))
        addView(ui.row().apply{
            addView(ui.stat(eta,"ARRIVAL"),LinearLayout.LayoutParams(0,-2,1f))
            addView(ui.stat(AtlasPages.formatTime(seconds),"REMAINING"),LinearLayout.LayoutParams(0,-2,1f))
            addView(ui.stat(AtlasPages.formatDistance(meters),"DISTANCE"),LinearLayout.LayoutParams(0,-2,1f))
        })
        addView(ui.row().apply{
            addView(ui.chip("Overview","route"){atlasMap.overview()},LinearLayout.LayoutParams(0,-2,1f))
            addView(ui.iconButton(if(model.voice)"volume" else "mute","Toggle voice guidance"){model.voice=!model.voice},LinearLayout.LayoutParams(ui.dp(42),ui.dp(42)).apply{leftMargin=ui.dp(7)})
            addView(ui.text("End",13f,ui.red,true).apply{gravity=Gravity.CENTER;setPadding(ui.dp(18),ui.dp(12),ui.dp(5),ui.dp(12));contentDescription="End navigation";setOnClickListener{confirm("End this navigation?"){model.stop()}}})
        },linear(14))
    }
    private fun renderGuidance(s: AtlasState) {
        guidance.removeAllViews();guidance.visibility=if(s.navigating&&page==null)View.VISIBLE else View.GONE
        if(!s.navigating)return
        val index=s.guidance?.optInt("maneuver")?:0
        val maneuver=s.route?.optJSONArray("maneuvers")?.optJSONObject(index)
        val distance=s.guidance?.optDouble("toManeuver")?:0.0
        val type=maneuver?.optString("type").orEmpty()
        val icon=when{type.contains("roundabout")->"roundabout";type.contains("left")->"arrow-left";type.contains("right")->"arrow-right";type=="arrive"->"flag";else->"arrow"}
        val banner=ui.row().apply{
            background=ui.shape(Color.rgb(24,42,66),24);elevation=ui.dp(7).toFloat();setPadding(ui.dp(20),ui.dp(20),ui.dp(18),ui.dp(20))
            addView(ui.icon(icon,Color.WHITE,44),LinearLayout.LayoutParams(ui.dp(44),ui.dp(52)))
            addView(ui.column().apply{
                addView(ui.text(if(distance<=20)"Now" else AtlasPages.formatDistance(distance),30f,Color.WHITE,true));addView(ui.space(7))
                addView(ui.text(maneuver?.optString("instruction")?:"Continue on your route",15f,Color.WHITE,true).apply{maxLines=2})
                val lanes=maneuver?.optString("turnLanes").orEmpty().split('|')
                if(distance<=350&&lanes.size>1){addView(ui.space(12));addView(ui.text(lanes.joinToString("    "){when{it.contains("left")->"←";it.contains("right")->"→";else->"↑"}},23f,Color.WHITE))}
            },LinearLayout.LayoutParams(0,-2,1f).apply{leftMargin=ui.dp(18)})
        };guidance.addView(banner)
        val confidence=s.guidance?.optString("state")
        if(confidence=="reduced"||confidence=="checking")guidance.addView(ui.text(if(confidence=="reduced")"GPS accuracy reduced · Keeping your route" else "Checking your route…",12f,ui.ink,true).apply{background=ui.shape(ui.surface,14);setPadding(ui.dp(14),ui.dp(11),ui.dp(14),ui.dp(11))},linear(9))
    }
    private fun startNavigation(){atlasMap.follow=true;previewCollapsed=false;selectedPlace=null;model.start()}
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
    private fun openSearch(){searchTarget="destination";model.clearSearch();openPage("search")}
    private fun openPage(name:String){
        if(name=="map"){closePage();return}
        if(name=="trips")model.tab("Trip")
        page=name;pageKey=null;pageLayer.removeAllViews();pageLayer.visibility=View.VISIBLE
        val header=ui.row().apply{setPadding(ui.dp(16),ui.dp(14),ui.dp(20),ui.dp(14));setBackgroundColor(ui.canvas)}
        header.addView(ui.iconButton("back","Back"){backPage()},LinearLayout.LayoutParams(ui.dp(42),ui.dp(42)))
        val title=when(name){"search"->if(searchTarget=="origin")"Starting point" else "Find a place";"regions"->"Offline regions";"trips"->"Your trips";"bookmarks"->"Saved places";"nearby"->"Around you";"journeys"->"Public transport";"journey"->"Your journey";"appearance"->"Appearance";"vehicle"->"Vehicle class";else->"Settings"}
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
    private fun backPage(){when(page){"appearance","vehicle"->openPage("settings");"journey"->openPage("journeys");else->closePage()}}
    private fun closePage(){hideKeyboard();val was=page;page=null;searchInput=null;pageKey=null;pageLayer.visibility=View.GONE;if(was=="trips"&&model.updates.value.tab=="Trip")model.tab("Explore");rebuildChrome()}
    private fun updatePage(s:AtlasState){
        val currentPage=page?:return
        val key=listOf(currentPage,s.results,s.exploreResults,s.searching,s.searchQuery,s.searchError,s.revision,s.downloading,s.downloadPercent,s.downloadError,s.journeys,s.journeyLeg,model.voice,model.vehicleClass)
        if(key==pageKey)return;pageKey=key
        val content=when(currentPage){"search"->pages.search(s);"nearby"->pages.nearby(s);"regions"->pages.regions(s);"bookmarks"->pages.bookmarks();"trips"->pages.trips();"journeys"->pages.journeys(s);"journey"->pages.journey(s);"appearance"->pages.appearance();"vehicle"->pages.vehicle();else->pages.settings()}
        val oldScroll=if(currentPage!="search")pageBody.getChildAt(0)?.scrollY?:0 else 0
        pageBody.removeAllViews();pageBody.addView(content,FrameLayout.LayoutParams(-1,-1))
        if(oldScroll>0)content.post{content.scrollTo(0,oldScroll)}
        layoutChrome()
        if(currentPage=="trips"){navigation.bringToFront();snackbar.bringToFront()}
    }
    private fun showMenu(){showChoices("Atlas",listOf("Saved places" to "bookmark","Offline regions" to "download","Your trips" to "trip","Settings" to "sun")){index->openPage(listOf("bookmarks","regions","trips","settings")[index])}}
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
    private fun hasLocation()=checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED
    private fun enableLocation(){
        val prefs=getSharedPreferences("atlas-ui",0)
        if(prefs.getBoolean("locationAsked",false)&&!shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION)&&!hasLocation()){
            confirm("Enable location for Atlas in Android settings?"){startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:$packageName")))}
        }else{prefs.edit().putBoolean("locationAsked",true).apply();requestPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION))}
    }
    private fun startGps(){if(!hasLocation())return;try{
        for(provider in listOf(LocationManager.GPS_PROVIDER,LocationManager.NETWORK_PROVIDER))if(manager.isProviderEnabled(provider))manager.requestLocationUpdates(provider,1000L,0f,this)
    }catch(_:SecurityException){rebuildChrome()}}
    override fun onLocationChanged(location:Location){
        val time=location.elapsedRealtimeNanos/1e9;val previous=model.updates.value.fix
        if(previous!=null&&time<=previous.time)return
        model.fix(Fix(Coordinate(location.latitude,location.longitude),if(location.hasAccuracy())location.accuracy.toDouble().coerceAtLeast(0.0)else 100.0,
            if(location.hasSpeed())location.speed.toDouble().coerceAtLeast(0.0)else 0.0,if(location.hasBearing())location.bearing.toDouble()else null,time))
    }
    override fun onProviderEnabled(provider:String){}
    override fun onProviderDisabled(provider:String){}
    @Deprecated("Deprecated in Android") override fun onStatusChanged(provider:String?,status:Int,extras:Bundle?){}
    override fun onStart(){super.onStart();atlasMap.onStart();startGps()}
    override fun onResume(){super.onResume();atlasMap.onResume();rebuildChrome()}
    override fun onPause(){atlasMap.onPause();super.onPause()}
    override fun onStop(){manager.removeUpdates(this);atlasMap.onStop();super.onStop()}
    override fun onLowMemory(){super.onLowMemory();atlasMap.onLowMemory()}
    override fun onSaveInstanceState(outState:Bundle){super.onSaveInstanceState(outState);val map=Bundle();atlasMap.onSaveInstanceState(map);outState.putBundle("map",map);outState.putString("page",page);outState.putString("peek",selectedPlace?.toString())}
    override fun onDestroy(){handler.removeCallbacksAndMessages(null);model.speak=null;voice?.stop();voice?.shutdown();atlasMap.onDestroy();super.onDestroy()}
}
