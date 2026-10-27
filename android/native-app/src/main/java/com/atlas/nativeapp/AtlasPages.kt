package com.atlas.nativeapp

import android.content.Context
import android.graphics.Color
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.util.Locale
import kotlin.math.roundToInt

class AtlasPages(
    private val context: Context,
    private val ui: AtlasUi,
    private val model: AtlasModel,
    val select: (JSONObject) -> Unit,
    val open: (String) -> Unit,
    val importTrip: () -> Unit,
    val changeTheme: (String) -> Unit,
    val confirm: (String, () -> Unit) -> Unit,
    val center: (Coordinate) -> Unit,
    val importBackup: () -> Unit,
    val exportBackup: () -> Unit
) {
    internal var diagnosticsLiveText: TextView? = null
        private set
    fun updateDiagnostics(state: AtlasState) {
        diagnosticsLiveText?.text=NavigationDiagnostics.snapshot(
            state,android.os.SystemClock.elapsedRealtimeNanos()/1e9).details
    }
    private fun lp(top: Int = 0) = LinearLayout.LayoutParams(-1, -2).apply { topMargin = ui.dp(top) }
    private fun scroll(content: View) = ScrollView(context).apply { isFillViewport = false; clipToPadding = false; setPadding(ui.dp(20), ui.dp(8), ui.dp(20), ui.dp(28)); addView(content) }
    private fun paragraph(text: String) = ui.text(text, 14f, ui.muted).apply { setLineSpacing(ui.dp(4).toFloat(), 1f) }
    private fun empty(icon: String, title: String, description: String, action: String? = null, click: (() -> Unit)? = null): View = ui.column().apply {
        gravity = Gravity.CENTER_HORIZONTAL; setPadding(ui.dp(18), ui.dp(50), ui.dp(18), ui.dp(24))
        addView(ui.tileIcon(icon), LinearLayout.LayoutParams(ui.dp(68), ui.dp(68)))
        addView(ui.space(23)); addView(ui.text(title, 21f, bold = true).apply { gravity = Gravity.CENTER })
        addView(ui.space(11)); addView(paragraph(description).apply { gravity = Gravity.CENTER })
        if (action != null && click != null) addView(ui.action(action, primary = true, click = click), lp(24))
    }
    private fun rowAction(icon: String, title: String, subtitle: String, action: () -> Unit): View = ui.row().apply {
        ui.ripple(this, ui.surface, 18); setPadding(ui.dp(13),ui.dp(13),ui.dp(13),ui.dp(13))
        addView(ui.tileIcon(icon), LinearLayout.LayoutParams(ui.dp(44),ui.dp(44)))
        addView(ui.column().apply { addView(ui.text(title,15f,bold=true)); addView(ui.space(5)); addView(ui.text(subtitle,12f,ui.muted)) }, LinearLayout.LayoutParams(0,-2,1f).apply { leftMargin=ui.dp(13) })
        addView(ui.icon("chevron",ui.muted,18)); setOnClickListener { action() }
    }
    fun placeRow(place: JSONObject, visited: Boolean = false, trailing: (() -> Unit)? = null): View = ui.row().apply {
        ui.ripple(this,ui.surface,18); setPadding(ui.dp(14),ui.dp(13),ui.dp(14),ui.dp(13))
        val type=place.optString("type").ifBlank { "Place" }
        val icon=when { type.contains("cafe") -> "cafe"; type.contains("food")||type.contains("restaurant") -> "food"; visited -> "check"; else -> "pin" }
        val tile=ui.tileIcon(icon,if(visited)ui.green else ui.blue).apply{clipToOutline=true}
        val image=place.optString("image")
        val imageOwner=this@AtlasPages.context as? androidx.lifecycle.LifecycleOwner
        if(image.isNotBlank()&&imageOwner!=null){
            val photo=android.widget.ImageView(context).apply{scaleType=android.widget.ImageView.ScaleType.CENTER_CROP;background=null}
            tile.addView(photo,android.widget.FrameLayout.LayoutParams(-1,-1))
            PlaceImages.load(imageOwner,image,photo)
        }
        addView(tile,LinearLayout.LayoutParams(ui.dp(44),ui.dp(44)))
        val details=ui.column();details.addView(ui.text(place.optString("name","Selected location"),15f,bold=true).apply { maxLines=2 })
        details.addView(ui.space(5))
        val distance=place.optDouble("distanceMeters",Double.NaN).takeIf { it.isFinite() }?.let { formatDistance(it)+" · " }.orEmpty()
        val location=PlaceLocationPresentation.subtitle(place)
        if(location.isNotBlank()) {
            details.addView(ui.text(location,12f,ui.muted).apply { maxLines=2 })
            details.addView(ui.space(4))
        }
        details.addView(ui.text(distance+type.replaceFirstChar { it.titlecase(Locale.getDefault()) },12f,ui.muted))
        addView(details,LinearLayout.LayoutParams(0,-2,1f).apply{leftMargin=ui.dp(13);rightMargin=ui.dp(8)})
        if(trailing!=null)addView(ui.iconButton(if(visited)"check" else "plus",if(visited)"Mark unvisited" else "Mark visited",false,trailing),LinearLayout.LayoutParams(ui.dp(44),ui.dp(44)))
        else addView(ui.icon("chevron",ui.muted,18))
        setOnClickListener { select(place) }
    }
    fun search(state: AtlasState): View {
        val body=ui.column()
        if(state.searching) {
            val row=ui.row().apply{gravity=Gravity.CENTER;setPadding(0,ui.dp(40),0,ui.dp(20));addView(ProgressBar(context),LinearLayout.LayoutParams(ui.dp(26),ui.dp(26)));addView(ui.text("Searching your offline places…",13f,ui.muted),LinearLayout.LayoutParams(-2,-2).apply{leftMargin=ui.dp(12)})};body.addView(row)
        } else if(state.searchError!=null) body.addView(empty("download","Your places, even offline","Download a region to search places and addresses without a connection.","Browse offline regions"){open("regions")})
        else if(state.searchQuery.length>=2) {
            body.addView(ui.text("${state.results.size} RESULTS",11f,ui.muted,true),lp(14))
            if(state.results.isEmpty())body.addView(empty("search","No places found","Try another name, address or postcode."))
            state.results.forEach{body.addView(placeRow(it),lp(9))}
        } else {
            val recent=model.recents()
            body.addView(ui.text("RECENT DESTINATIONS",11f,ui.muted,true),lp(16))
            if(recent.isEmpty())body.addView(empty("search","Find your next stop","Search cafés, museums, addresses or a place you want to explore."))
            else recent.forEach{body.addView(placeRow(it),lp(9))}
        }
        return scroll(body)
    }
    fun nearby(state: AtlasState): View {
        val body=ui.column()
        body.addView(paragraph(if(state.category.isBlank())"Places within 3 km of your map location." else "${state.category.replaceFirstChar{it.titlecase()}} near your map location."),lp(8))
        if(state.searching)body.addView(ProgressBar(context),LinearLayout.LayoutParams(ui.dp(28),ui.dp(28)).apply{gravity=Gravity.CENTER;topMargin=ui.dp(30)})
        if(state.exploreResults.isEmpty()&&!state.searching)body.addView(empty("pin","Nothing nearby yet","Download the region for this area, then choose a category.","Offline regions"){open("regions")})
        state.exploreResults.forEach{body.addView(placeRow(it),lp(10))}
        return scroll(body)
    }
    fun bookmarks(): View {
        val body=ui.column();val saved=model.bookmarks()
        if(saved.isEmpty())body.addView(empty("bookmark","Keep your favourite places","Tap a place on the map, then Save. Your collection stays on this device.","Explore the map"){open("map")})
        else {
            body.addView(paragraph("${saved.size} saved places · Available on this device"),lp(8))
            saved.forEach { place -> body.addView(ui.column().apply {
                addView(placeRow(place));addView(ui.text("Remove from saved",12f,ui.muted).apply {setPadding(ui.dp(72),0,ui.dp(12),ui.dp(14));setOnClickListener {model.bookmark(place)}})
            }.apply{background=ui.shape()},lp(12)) }
        }
        return scroll(body)
    }
    fun regions(state: AtlasState): View {
        val body=ui.column()
        body.addView(ui.card().apply {
            addView(ui.badge("READY WHEN YOU ARE",true));addView(ui.space(12))
            addView(ui.text("Download once.\nExplore anywhere.",24f,bold=true));addView(ui.space(10))
            addView(paragraph("Your places and routes stay with you, even without a connection."))
        },lp(10))
        state.downloadError?.let { body.addView(ui.card().apply{addView(ui.text("Download interrupted",15f,ui.red,true));addView(ui.space(7));addView(paragraph(it))},lp(14)) }
        body.addView(ui.text("AVAILABLE REGIONS",11f,ui.muted,true),lp(26))
        var stored=0L
        for(region in model.regions.regions){
            val version=model.regions.installedVersion(region);if(version!=null)stored+=region.bytes
            val downloading=state.downloading==region.id
            val card=ui.card()
            card.addView(ui.row().apply{
                addView(ui.tileIcon("map",if(version!=null)ui.green else ui.blue),LinearLayout.LayoutParams(ui.dp(48),ui.dp(48)))
                addView(ui.column().apply{addView(ui.text(region.name,19f,bold=true));addView(ui.space(5));addView(ui.text(region.json.optString("country"),12f,ui.muted))},LinearLayout.LayoutParams(0,-2,1f).apply{leftMargin=ui.dp(13)})
                addView(ui.badge(if(downloading)"${state.downloadPercent}%" else if(version==region.version)"Ready" else if(version!=null)"Update" else "Offline",version==region.version))
            })
            card.addView(ui.space(17));card.addView(ui.text("${region.bytes/1024/1024} MB   ·   Places & navigation",12f,ui.muted))
            if(!region.assets.has("map")){card.addView(ui.space(6));card.addView(ui.text("Basemap requires a connection in this region",11f,ui.muted))}else{card.addView(ui.space(6));card.addView(ui.text(if(version==region.version)"Vector map available offline" else "Vector map included after download or update",11f,ui.muted))}
            card.addView(ui.space(16))
            if(downloading){
                card.addView(ProgressBar(context,null,android.R.attr.progressBarStyleHorizontal).apply{max=100;progress=state.downloadPercent;progressTintList=android.content.res.ColorStateList.valueOf(ui.blue)},LinearLayout.LayoutParams(-1,ui.dp(5)))
                card.addView(ui.action("Cancel download",primary=false){model.cancelDownload()},lp(12))
            }else if(version==region.version){
                card.addView(ui.row().apply{
                    addView(ui.action("Ready offline","check",false){model.status("${region.name} is ready offline")},LinearLayout.LayoutParams(0,-2,1f))
                    addView(ui.iconButton("trash","Remove ${region.name}"){confirm("Remove ${region.name} offline data?"){model.remove(region)}},LinearLayout.LayoutParams(ui.dp(48),ui.dp(48)).apply{leftMargin=ui.dp(10)})
                })
            }else card.addView(ui.action(if(version==null)"Download region" else "Update region","download",true){model.download(region)}.apply{isEnabled=state.downloading==null;alpha=if(isEnabled)1f else .45f})
            body.addView(card,lp(13))
        }
        body.addView(ui.action("Check for region updates","download",false) {
            model.refreshRegionCatalog(true)
        },lp(17))
        body.addView(ui.text("${stored/1024/1024} MB of offline data on this device",12f,ui.muted).apply{gravity=Gravity.CENTER},lp(24))
        return scroll(body)
    }
    fun trips(): View {
        val body=ui.column();val trips=model.trips()
        if(trips.isEmpty()){
            body.addView(empty("trip","Every trip starts somewhere","Bring your itinerary into Atlas. Import a trip to see each day, save your progress and navigate between stops.","Import a trip"){importTrip()})
            body.addView(ui.card().apply{addView(ui.text("Your itinerary, on your map",16f,bold=true));addView(ui.space(9));addView(paragraph("Import an Atlas trip JSON file from your device. Your trips stay private on this phone."))},lp(24))
            return scroll(body)
        }
        val current=trips.firstOrNull{model.tripId(it.getJSONObject("trip"))==model.activeTrip}?:trips.first()
        val trip=current.getJSONObject("trip");val tripId=model.tripId(trip);val days=trip.getJSONObject("days");val keys=days.keys().asSequence().toList()
        val day=model.activeDay.takeIf{days.has(it)}?:keys.firstOrNull().orEmpty()
        if(trips.size>1){
            body.addView(ui.text("YOUR TRIPS",11f,ui.muted,true),lp(10))
            for(item in trips){val t=item.getJSONObject("trip");val id=model.tripId(t);body.addView(ui.chip(t.optString("name","Trip"),"trip",id==tripId){model.activeTrip=id;model.activeDay=t.getJSONObject("days").keys().asSequence().firstOrNull().orEmpty()},lp(8))}
        }
        body.addView(ui.card().apply{
            addView(ui.badge("YOUR ITINERARY",true));addView(ui.space(12));addView(ui.text(trip.optString("name","Your trip"),25f,bold=true));addView(ui.space(8))
            addView(paragraph("${keys.size} days · Your places, all together"))
        },lp(14))
        val dayScroll=android.widget.HorizontalScrollView(context).apply{isHorizontalScrollBarEnabled=false}
        val chips=ui.row();keys.forEach{key->chips.addView(ui.chip("Day $key",selected=key==day){model.activeDay=key},LinearLayout.LayoutParams(-2,-2).apply{rightMargin=ui.dp(9)})};dayScroll.addView(chips);body.addView(dayScroll,lp(20))
        val stops=days.optJSONArray(day)?.objects().orEmpty().mapIndexed{i,p->JSONObject(p.toString()).put("id","trip:$tripId:$day:$i")}
        val done=stops.count{model.visited(it.getString("id"))}
        body.addView(ui.row().apply{addView(ui.text("DAY $day",12f,ui.ink,true),LinearLayout.LayoutParams(0,-2,1f));addView(ui.text("$done / ${stops.size} visited",12f,ui.muted))},lp(24))
        stops.forEachIndexed{index,place->
            val id=place.getString("id");val visited=model.visited(id)
            body.addView(ui.card(padding=0).apply{
                addView(placeRow(place,visited){model.visited(id,!visited)})
                val note=place.optString("note");if(note.isNotBlank())addView(ui.text(note,12f,ui.muted).apply{setPadding(ui.dp(71),0,ui.dp(16),ui.dp(14));setLineSpacing(ui.dp(3).toFloat(),1f)})
                contentDescription="Stop ${index+1}: ${place.optString("name")}";setOnLongClickListener{center(place.coordinate());open("map");true}
            },lp(11))
        }
        stops.firstOrNull{!model.visited(it.getString("id"))}?.let{next->body.addView(ui.action("Navigate to next stop","navigate"){select(next)},lp(20))}
        body.addView(ui.action("Import another trip","upload",false){importTrip()},lp(12))
        body.addView(ui.text("Remove this trip",12f,ui.muted).apply{gravity=Gravity.CENTER;setPadding(0,ui.dp(18),0,ui.dp(8));setOnClickListener{confirm("Remove this trip from your device?"){model.removeTrip(tripId)}}},lp(5))
        return scroll(body)
    }
    fun journeys(state: AtlasState): View {
        val body=ui.column();val provider=TransitProvider()
        if(state.journeys.isEmpty())body.addView(empty("transit","Plan a journey","Choose a destination and calculate public transport routes. London is currently supported."))
        for(journey in state.journeys){
            body.addView(ui.card().apply{
                addView(ui.badge(if(journey.optBoolean("isRecommended"))"RECOMMENDED" else if(journey.optBoolean("isFastest"))"EARLIEST ARRIVAL" else "PUBLIC TRANSPORT",journey.optBoolean("isRecommended")));addView(ui.space(12));addView(ui.text(provider.summary(journey),19f,bold=true));addView(ui.space(14))
                provider.instructions(journey).forEachIndexed{i,step->addView(ui.text("${i+1}. $step",13f,ui.muted).apply{setLineSpacing(ui.dp(4).toFloat(),1f)},lp(12))}
                addView(ui.action("Follow this journey","transit"){model.startJourney(journey);open("journey")},lp(18))
            },lp(14))
        }
        return scroll(body)
    }
    fun journey(state: AtlasState): View {
        val body=ui.column();val journey=state.journey?:return journeys(state)
        val legs=TransitPolicy.sequence(journey);val provider=TransitProvider();val instructions=provider.instructions(journey)
        body.addView(ui.heading("Your journey",provider.summary(journey)),lp(12))
        legs.forEachIndexed{i,leg->body.addView(ui.card().apply{
            addView(ui.badge(if(i<state.journeyLeg)"Completed" else if(i==state.journeyLeg)"Current leg" else "Leg ${i+1}",i<=state.journeyLeg))
            addView(ui.space(13));addView(ui.text(instructions[i],15f,bold=i==state.journeyLeg).apply{setLineSpacing(ui.dp(5).toFloat(),1f)})
            val disruptions=leg.optJSONArray("disruptions")?.objects().orEmpty();for(d in disruptions)addView(ui.text(d.optString("description",d.optString("summary")),12f,ui.red),lp(12))
            if(i==state.journeyLeg){
                val action=when(state.journeyPhase){"ready_to_board"->"boarded";"riding"->"get_off";else->"arrived"}
                val label=when(state.journeyPhase){"ready_to_board"->"I have boarded";"riding"->"I have got off";else->"Arrived at this stop"}
                addView(ui.action(label,"check"){model.journeyAction(action)},lp(18))
                if(state.journeyPhase=="ready_to_board")addView(ui.action("Refresh live departures","transit",false){model.enrichJourney()},lp(9))
            }
        },lp(14))}
        if(state.journeyLeg>=legs.size)body.addView(empty("check","You have arrived","Your public transport journey is complete."))
        return scroll(body)
    }
    fun settings(): View {
        val body=ui.column();body.addView(ui.text("MAKE ATLAS YOURS",11f,ui.muted,true),lp(16))
        body.addView(ui.card(padding=5).apply{
            addView(rowAction("volume","Voice guidance",if(model.voice)"On · Speak upcoming turns" else "Off · Quiet navigation"){model.voice=!model.voice})
            addView(ui.rule());addView(rowAction("compass","Diagnostics",if(model.diagnosticsEnabled)"GPS overlay enabled" else "Inspect GPS, heading and positioning"){open("diagnostics")})
            addView(ui.rule());addView(rowAction("sun","Appearance",model.theme.replaceFirstChar{it.titlecase()}){open("appearance")})
            addView(ui.rule());addView(rowAction("car","Vehicle class","Class ${model.vehicleClass} · Country tariff table"){open("vehicle")})
            addView(ui.rule());addView(rowAction("car","Published plaza tariffs",
                "Official charges per crossing · Current route country"){open("tollcharges")})
            addView(ui.rule());addView(rowAction("download","Update toll tariffs",
                model.tollCountry?.let { "$it · Optional data download" } ?: "Calculate a route to select its country"){model.updateTollTariffs()})
            addView(ui.rule());addView(rowAction("download","Update entry/exit tariffs",
                model.tollCountry?.let { "$it · Published entry/exit prices" } ?: "Calculate a route to select its country"){
                model.updateTollTariffs(kind=TollCatalogKind.ENTRY_EXIT)})
            if(model.canRollbackEntryExitTolls){addView(ui.rule());addView(rowAction("download","Previous entry/exit tariffs",
                "Restore the previous valid local table"){model.updateTollTariffs(true,TollCatalogKind.ENTRY_EXIT)})}
            if(model.canRollbackTolls){addView(ui.rule());addView(rowAction("download","Previous toll tariffs",
                "Restore the previous valid local table"){model.updateTollTariffs(true)})}
            addView(ui.rule());addView(rowAction("layers","Map appearance",when(model.mapVisualStyle){
                MapVisualStyle.SATELLITE -> "Satellite · Online imagery"
                MapVisualStyle.HYBRID -> "Hybrid · Imagery with labels"
                else -> "Streets · Atlas cartography"
            }){open("mapLayers")})
            addView(ui.rule());addView(rowAction("map","Map connection",when(model.mapSourceMode){
                MapSourcePolicy.ONLINE -> "Online · internet maps"
                MapSourcePolicy.OFFLINE -> "Offline · downloaded maps only"
                else -> "Automatic · prefer downloaded maps"
            }){open("mapSource")})
        },lp(12))
        body.addView(ui.card(padding=5).apply{
            addView(rowAction("download","Offline regions","Manage downloads and storage"){open("regions")})
            addView(ui.rule());addView(rowAction("bookmark","Saved places","Your favourite places"){open("bookmarks")})
            addView(ui.rule());addView(rowAction("trip","Your trips","Import and organise itineraries"){open("trips")})
            if (model.canResumePreviousNavigation) {
                addView(ui.rule());addView(rowAction("navigate","Resume interrupted trip",
                    "Recalculate the route from current GPS"){model.resumePreviousNavigation()})
            }
        },lp(16))
        body.addView(ui.card(padding=5).apply {
            addView(rowAction("download","Import Atlas backup",
                "Merge saved places, trips and preferences from a JSON export"){importBackup()})
            addView(ui.rule())
            addView(rowAction("upload","Export Atlas backup",
                "Save a private JSON copy of your Atlas data"){exportBackup()})
        },lp(16))
        body.addView(ui.text("ATLAS",14f,ui.muted,true).apply{letterSpacing=.18f;gravity=Gravity.CENTER},lp(40))
        body.addView(ui.text("Explore with a little more freedom.",12f,ui.muted).apply{gravity=Gravity.CENTER},lp(8))
        return scroll(body)
    }
    fun diagnostics(state: AtlasState): View=scroll(ui.column().apply {
        addView(ui.heading("Navigation diagnostics",
            "Inspect actual GNSS measurements independently of filtered route tracking."),lp(8))
        addView(ui.card(padding=5).apply {
            addView(rowAction("compass","Show on-map overlay",
                if(model.diagnosticsEnabled)"Enabled · tap to disable" else "Disabled · tap to enable") {
                model.diagnosticsEnabled=!model.diagnosticsEnabled
            })
        },lp(18))
        addView(paragraph("When enabled, a small on-map panel shows live GPS fix rate, reported precision, heading, speed, movement evidence, and off-route status. Tap its header for more details or × to hide it."),lp(16))
        val telemetry=NavigationDiagnostics.snapshot(
            state,android.os.SystemClock.elapsedRealtimeNanos()/1e9)
        addView(ui.card().apply {
            addView(ui.text(telemetry.headline,15f,ui.blue,true))
            addView(ui.space(12))
            diagnosticsLiveText=ui.text(telemetry.details,13f,ui.ink).apply {
                setLineSpacing(ui.dp(4).toFloat(),1f)
            }
            addView(diagnosticsLiveText)
        },lp(16))
        addView(paragraph("Accuracy is the value reported by Android, not a guarantee of physical position. GPS rate counts accepted real location fixes, never interpolated rendering frames. The overlay stays within Atlas and is off by default."),lp(18))
    })
    fun appearance(): View=scroll(ui.column().apply{
        addView(paragraph("Choose how Atlas looks on your device."),lp(12))
        listOf("system" to "Use device setting","light" to "Light","dark" to "Dark").forEach{(key,label)->addView(ui.card(padding=5).apply{addView(rowAction(if(key=="dark")"compass" else "sun",label,if(model.theme==key)"Selected" else "Tap to apply"){changeTheme(key)})},lp(12))}
    })
    fun tollCharges():View {
        val catalog=model.fixedTollCatalog()
        return scroll(ui.column().apply {
            if(catalog==null) {
                addView(paragraph("Calculate a route to select its country. Published plaza tariffs are shown when a matching country catalog is available."))
            } else {
                addView(paragraph("${catalog.country} · ${catalog.year} · Class ${model.vehicleClass} · ${catalog.currency}"))
                addView(paragraph("Each amount is the published base charge for one crossing. The plazas crossed by your route have not yet been verified; this list is not a trip total."),lp(12))
                val formatter=java.text.NumberFormat.getNumberInstance(Locale.forLanguageTag("pt-PT")).apply {
                    minimumFractionDigits=catalog.fractionDigits;maximumFractionDigits=catalog.fractionDigits
                }
                for(charge in catalog.fixedCharges) {
                    val price=charge.amounts[model.vehicleClass]
                    val label=price?.let { catalog.currency+" "+formatter.format(it) } ?: "Price unavailable for this class"
                    addView(ui.card(padding=14).apply {
                        addView(ui.column().apply {
                            addView(ui.text(charge.road+" · "+charge.name,15f,bold=true))
                            addView(ui.text(label,14f,ui.muted))
                            addView(ui.text(charge.id,11f,ui.muted))
                        })
                    },lp(10))
                }
                addView(paragraph("Source: ${catalog.source}"),lp(14))
                addView(ui.action("Update plaza tariffs",primary=false) {
                    model.updateTollTariffs(kind=TollCatalogKind.FIXED_CROSSING)
                },lp(14))
                if(model.canRollbackFixedTolls)addView(ui.action("Restore previous plaza tariffs",primary=false) {
                    model.updateTollTariffs(rollback=true,kind=TollCatalogKind.FIXED_CROSSING)
                },lp(10))
            }
        })
    }
    fun vehicle(): View=scroll(ui.column().apply{
        addView(paragraph("Vehicle class sets toll estimates from the current offline region's country tariff table. Tariffs are derived from official sections; they are not exact entrance/exit charges. Missing roads show Price unavailable."),lp(12))
        for(n in model.tollVehicleClasses)addView(ui.card(padding=5).apply{addView(rowAction("car","Class $n",if(model.vehicleClass==n)"Selected" else "Tap to select"){model.vehicleClass=n})},lp(12))
    })
    companion object {
        fun formatDistance(meters: Double): String = if(meters<1000)"${(meters/10).roundToInt()*10} m" else String.format(Locale.getDefault(),"%.1f km",meters/1000)
        fun formatTime(seconds: Double): String {val minutes=kotlin.math.ceil(seconds/60).toInt().coerceAtLeast(1);return if(minutes<60)"$minutes min" else "${minutes/60} h ${minutes%60} min"}
    }
}


