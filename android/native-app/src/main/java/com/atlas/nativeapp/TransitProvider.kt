package com.atlas.nativeapp

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.math.abs

/** Native TfL adapter; route discovery remains with the provider, policy stays in Atlas. */
class TransitProvider(private val baseUrl:String="https://api.tfl.gov.uk") {
    private suspend fun get(path: String): Any = withContext(Dispatchers.IO) {
        val connection = URL(baseUrl+path).openConnection() as HttpURLConnection
        connection.connectTimeout = 15000; connection.readTimeout = 20000
        try {
            check(connection.responseCode in 200..299) { "Transit provider returned HTTP ${connection.responseCode}" }
            connection.inputStream.bufferedReader().use { JSONTokener(it.readText()).nextValue() }
        } finally { connection.disconnect() }
    }
    private fun encode(value:String)=URLEncoder.encode(value,"UTF-8")
    private suspend fun candidates(from:Coordinate,to:Coordinate,mode:String,least:Boolean=false,alternative:Boolean=true):List<JSONObject> {
        val query="mode=${encode(mode)}&timeIs=departing&useRealTimeLiveArrivals=true&walkingSpeed=fast&alternativeRoutes=$alternative"+
            if(least)"&journeyPreference=leastinterchange" else ""
        val response=get("/Journey/JourneyResults/${from.lat},${from.lon}/to/${to.lat},${to.lon}?$query") as JSONObject
        return response.optJSONArray("journeys")?.objects().orEmpty().mapIndexed{index,row->normalize(row,index)
            .put("candidatePool",if(least)"$mode:leastinterchange" else mode)
            .put("origin",JSONObject().put("lat",from.lat).put("lon",from.lon))
            .put("destination",JSONObject().put("lat",to.lat).put("lon",to.lon))}
    }
    suspend fun journeys(from: Coordinate, to: Coordinate): List<JSONObject> = coroutineScope {
        require(from.lat in 51.2..51.8 && from.lon in -0.6..0.4 && to.lat in 51.2..51.8 && to.lon in -0.6..0.4) { "Transit is currently available in London" }
        val groups=listOf(Triple("bus,tube,dlr,overground,tram,elizabeth-line",false,true),Triple("tube",false,true),Triple("tube",true,true),Triple("elizabeth-line",false,false))
            .map{(mode,least,alternative)->async{try{Result.success(candidates(from,to,mode,least,alternative))}catch(e:CancellationException){throw e}catch(e:Exception){Result.failure<List<JSONObject>>(e)}}}.awaitAll()
        check(groups.any{it.isSuccess}){groups.firstNotNullOfOrNull{it.exceptionOrNull()?.message}?:"Transit provider unavailable"}
        TransitPolicy.alternatives(groups.flatMap{it.getOrDefault(emptyList())})
    }
    private fun clean(value:String)=value.replace(Regex("\\s*\\(([^)]+)\\)\\s*Underground Station$",RegexOption.IGNORE_CASE),"")
        .replace(Regex("\\s*(Underground Station|DLR Station|Rail Station|Station)$",RegexOption.IGNORE_CASE),"").trim()
    fun normalize(row:JSONObject,index:Int):JSONObject {
        val sequence=row.optJSONArray("legs")?.objects().orEmpty().mapIndexed{legIndex,raw->
            val departure=raw.optJSONObject("departurePoint")?:JSONObject();val arrival=raw.optJSONObject("arrivalPoint")?:JSONObject()
            val instruction=raw.optJSONObject("instruction")?:JSONObject();val route=raw.optJSONArray("routeOptions")?.optJSONObject(0)?:JSONObject()
            val mode=raw.optJSONObject("mode")?.let{it.optString("id",it.optString("name","unknown"))}?:"unknown"
            val detailed=instruction.optString("detailed");val bound=Regex("\\b(north|south|east|west)bound\\b",RegexOption.IGNORE_CASE).find(detailed)?.value
            val platform=departure.optString("platformName").ifBlank{Regex("\\bplatform\\s+([A-Z]?\\d+[A-Z]?|[A-Z])\\b",RegexOption.IGNORE_CASE).find(detailed)?.groupValues?.get(1).orEmpty()}
            val path=raw.optJSONObject("path")?:JSONObject();val points=geometry(path.opt("lineString"))
            require(points.length()>0){"Transit provider returned unsupported geometry"}
            val stops=path.optJSONArray("stopPoints")?.objects().orEmpty().map{clean(it.optString("name",it.optString("commonName")))}.filter{it.isNotBlank()}
            JSONObject().put("id","leg-$legIndex").put("index",legIndex).put("kind",if(mode=="walking")"walk" else "transit").put("mode",mode)
                .put("line",route.optString("name")).put("fromName",departure.optString("commonName")).put("toName",arrival.optString("commonName"))
                .put("durationMinutes",raw.optDouble("duration",0.0)).put("departureTime",raw.optString("departureTime")).put("arrivalTime",raw.optString("arrivalTime"))
                .put("instruction",instruction.optString("summary",detailed)).put("instructionDetailed",detailed)
                .put("direction",clean(route.optJSONArray("directions")?.optString(0).orEmpty())).put("boundDirection",bound.orEmpty().replaceFirstChar{it.titlecase()})
                .put("distanceMeters",raw.opt("distance")).put("departureStopId",departure.optString("naptanId",departure.optString("id")))
                .put("arrivalStopId",arrival.optString("naptanId",arrival.optString("id")))
                .put("departurePlatform",if(platform.isBlank()||platform.startsWith("Platform",true))platform else "Platform $platform")
                .put("departureIndicator",departure.optString("indicator")).put("departureStopLetter",departure.optString("stopLetter"))
                .put("arrivalPlatform",arrival.optString("platformName")).put("arrivalIndicator",arrival.optString("indicator")).put("arrivalStopLetter",arrival.optString("stopLetter"))
                .put("intermediateStops",JSONArray(stops)).put("stopCount",if(stops.isEmpty())JSONObject.NULL else stops.size)
                .put("points",points).put("start",points.getJSONObject(0)).put("end",points.getJSONObject(points.length()-1))
                .put("navigation",if(mode=="walking")"atlas-offline" else "provider-guidance").put("disruptions",raw.optJSONArray("disruptions")?:JSONArray())
        }
        return JSONObject(row.toString()).put("id","tfl-$index-${row.optString("startDateTime","now")}")
            .put("provider","tfl").put("durationMinutes",row.optDouble("duration",sequence.sumOf{it.optDouble("durationMinutes",0.0)}))
            .put("startTime",row.optString("startDateTime")).put("arrivalTime",row.optString("arrivalDateTime")).put("sequence",JSONArray(sequence))
    }
    fun geometry(value:Any?):JSONArray {
        val points=JSONArray()
        fun add(lat:Double,lon:Double){if(lat.isFinite()&&lon.isFinite()&&lat in -90.0..90.0&&lon in -180.0..180.0)points.put(JSONObject().put("lat",lat).put("lon",lon))}
        val raw=if(value is String){try{JSONArray(value)}catch(_:Exception){null}}else value as? JSONArray
        if(raw!=null){for(i in 0 until raw.length()){val pair=raw.optJSONArray(i)?:continue;if(pair.length()>=2)add(pair.optDouble(0),pair.optDouble(1))}}
        else if(value is String){Regex("^LINESTRING\\s*\\((.*)\\)$",RegexOption.IGNORE_CASE).matchEntire(value.trim())?.groupValues?.get(1)?.split(',')?.forEach{pair->val numbers=pair.trim().split(Regex("\\s+")).mapNotNull{it.toDoubleOrNull()};if(numbers.size==2)add(numbers[1],numbers[0])}}
        return points
    }
    private fun normalizeLine(value:String)=value.lowercase().replace(Regex("\\s+line$"),"").replace(Regex("[^a-z0-9]+"),"-").trim('-')
    suspend fun arrivals(id:String,line:String=""):List<JSONObject> = coroutineScope {
        if(id.isBlank())return@coroutineScope emptyList()
        val wanted=normalizeLine(line)
        suspend fun predictions(stop:String):List<JSONObject> = try {
            (get("/StopPoint/${encode(stop)}/Arrivals") as? JSONArray)?.objects().orEmpty().filter{p->wanted.isBlank()||listOf(p.optString("lineId"),p.optString("lineName")).map(::normalizeLine).any{it.isNotBlank()&&(it==wanted||it.contains(wanted)||wanted.contains(it))}}
                .map{JSONObject(it.toString()).put("atlasArrivalStopId",stop)}
        }catch(e:CancellationException){throw e}catch(_:Exception){emptyList()}
        val direct=predictions(id)
        if(direct.isNotEmpty()||wanted.isBlank())return@coroutineScope direct
        val station=try{get("/StopPoint/${encode(id)}") as? JSONObject}catch(e:CancellationException){throw e}catch(_:Exception){null}
        val siblings=station?.optJSONArray("children")?.objects().orEmpty().filter{it.optString("stopType").equals("NaptanMetroStation",true)}
            .map{it.optString("naptanId",it.optString("id"))}.filter{it.isNotBlank()&&it!=id}.distinct()
        siblings.map{async{predictions(it)}}.awaitAll().flatten()
    }
    suspend fun enrich(journey:JSONObject):JSONObject = coroutineScope {
        val sequence=TransitPolicy.sequence(journey).map{step->async{
            if(step.optString("kind")!="transit"||step.optString("departureStopId").isBlank())return@async step
            val predictions=arrivals(step.optString("departureStopId"),step.optString("line"))
            matchPrediction(step,predictions)
        }}.awaitAll()
        JSONObject(journey.toString()).put("sequence",JSONArray(sequence))
    }
    fun matchPrediction(step:JSONObject,predictions:List<JSONObject>):JSONObject {
        fun text(value:String)=value.lowercase().replace("underground station","").replace("station","").replace(Regex("[^a-z0-9]+")," ").trim()
        fun compatible(a:String,b:String)=a.isNotBlank()&&b.isNotBlank()&&(a.contains(b)||b.contains(a))
        val towards=text(step.optString("direction"));val end=text(step.optString("toName"));val departure=TransitPolicy.instant(step.optString("departureTime"))
        fun penalty(p:JSONObject):Int{val d=text(p.optString("destinationName",p.optString("towards")));return if(compatible(d,towards)||compatible(d,end))0 else 1}
        fun delta(p:JSONObject):Double{val expected=TransitPolicy.instant(p.optString("expectedArrival"));return if(departure!=null&&expected!=null)abs((expected-departure).toDouble())else p.optDouble("timeToStation",Double.POSITIVE_INFINITY)*1000}
        val prediction=predictions.minWithOrNull(compareBy<JSONObject>{penalty(it)}.thenBy{delta(it)})?:return step
        val raw=prediction.optString("platformName").trim()
        val bound=Regex("\\b(northbound|southbound|eastbound|westbound)\\b",RegexOption.IGNORE_CASE).find(raw)?.value
            ?:prediction.optString("direction").takeIf{it.matches(Regex("^(north|south|east|west)bound$",RegexOption.IGNORE_CASE))}
        val platform=Regex("\\bplatform\\s*([A-Za-z0-9]+)\\b",RegexOption.IGNORE_CASE).find(raw)?.groupValues?.get(1)
            ?:raw.takeIf{it.isNotBlank()&&bound==null}
        return JSONObject(step.toString()).put("departurePlatform",platform?:step.optString("departurePlatform"))
            .put("boundDirection",bound?:step.optString("boundDirection"))
            .put("operationalDestination",prediction.optString("destinationName",prediction.optString("towards")).ifBlank{step.optString("direction")})
            .put("expectedDepartureTime",prediction.optString("expectedArrival"))
    }
    fun summary(journey: JSONObject): String = "${journey.optDouble("durationMinutes",journey.optDouble("duration",0.0)).toInt()} min · "+
        TransitPolicy.sequence(journey).joinToString(" → "){it.optString("line").ifBlank{it.optString("mode").replaceFirstChar{c->c.titlecase()}}}
    fun instructions(journey: JSONObject): List<String> = TransitPolicy.sequence(journey).map { leg ->
        val detail=listOf(leg.optString("boundDirection"),leg.optString("departurePlatform"),leg.optString("departureStopLetter").takeIf{it.isNotBlank()}?.let{"Stop $it"}.orEmpty()).filter{it.isNotBlank()}.joinToString(" · ")
        val live=leg.optString("expectedDepartureTime").ifBlank{leg.optString("departureTime")}.substringAfter('T').take(5)
        listOf(leg.optString("instruction"),"${leg.optString("fromName")} → ${leg.optString("toName")}",detail,"$live – ${leg.optString("arrivalTime").substringAfter('T').take(5)}",leg.optString("operationalDestination").takeIf{it.isNotBlank()}?.let{"Towards $it"}.orEmpty()).filter{it.isNotBlank()}.joinToString("\n")
    }
}
