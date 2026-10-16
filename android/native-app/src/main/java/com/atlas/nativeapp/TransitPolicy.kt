package com.atlas.nativeapp

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.math.max

/** The Atlas policy port: provider duration is not a substitute for arrival ETA. */
object TransitPolicy {
    fun instant(value: String): Long? = try { Instant.parse(value).toEpochMilli() }
        catch (_: Exception) { try { LocalDateTime.parse(value).atZone(ZoneId.of("Europe/London")).toInstant().toEpochMilli() } catch (_: Exception) { null } }
    private fun minutes(value: Double, fallback: Double = 0.0) = if(value.isFinite() && value>=0) value else fallback
    fun sequence(journey: JSONObject) = (journey.optJSONArray("sequence") ?: journey.optJSONArray("legs") ?: JSONArray()).objects()
    fun metrics(journey: JSONObject): JSONObject {
        val legs=sequence(journey)
        fun walking(leg:JSONObject)=leg.optString("kind",if(leg.optString("mode")=="walking")"walk" else "transit")=="walk"
        val walk=legs.filter(::walking);val transit=legs.filterNot(::walking)
        fun duration(leg:JSONObject)=minutes(leg.optDouble("durationMinutes",0.0))
        val legMinutes=legs.sumOf(::duration)
        val duration=minutes(journey.optDouble("durationMinutes",Double.NaN),legMinutes)
        return JSONObject().put("durationMinutes",duration).put("walkingMinutes",walk.sumOf(::duration))
            .put("transitMinutes",transit.sumOf(::duration)).put("waitingMinutes",max(0.0,duration-legMinutes))
            .put("transferCount",max(0,transit.size-1)).put("transitLegCount",transit.size).put("walkingLegCount",walk.size)
            .put("disruptionCount",legs.sumOf{it.optJSONArray("disruptions")?.length()?:0})
    }
    fun score(metrics:JSONObject):Double = metrics.getDouble("durationMinutes") + metrics.getInt("transferCount")*8 +
        metrics.getDouble("walkingMinutes")*.2 + max(0.0,metrics.getDouble("walkingMinutes")-15)*.4 + metrics.getInt("disruptionCount")*6
    fun rank(journeys:List<JSONObject>):List<JSONObject> {
        if(journeys.isEmpty())return emptyList()
        val reference=journeys.mapNotNull{instant(it.optString("startTime"))}.minOrNull()
        val prepared=journeys.mapIndexed { index,journey ->
            val m=metrics(journey);val arrival=instant(journey.optString("arrivalTime"))
            val effective=if(reference!=null&&arrival!=null)max(0.0,(arrival-reference)/60000.0) else m.getDouble("durationMinutes")
            m.put("effectiveArrivalMinutes",effective)
            JSONObject(journey.toString()).put("metrics",m).put("providerIndex",index)
                .put("score",effective+score(m)-m.getDouble("durationMinutes"))
        }
        val fastest=prepared.minOf{it.getJSONObject("metrics").getDouble("effectiveArrivalMinutes")}
        val ordered=prepared.sortedWith(compareBy<JSONObject>{it.getDouble("score")}
            .thenBy{it.getJSONObject("metrics").getDouble("effectiveArrivalMinutes")}
            .thenBy{it.getJSONObject("metrics").getInt("transferCount")}
            .thenBy{it.getJSONObject("metrics").getDouble("walkingMinutes")}.thenBy{it.getInt("providerIndex")})
        return ordered.mapIndexed { index,journey ->
            val effective=journey.getJSONObject("metrics").getDouble("effectiveArrivalMinutes")
            journey.put("rank",index).put("isRecommended",index==0).put("isFastest",effective==fastest)
                .put("durationAboveFastestMinutes",effective-fastest).put("fastestDurationMinutes",fastest)
                .put("recommendedScore",ordered.first().getDouble("score"))
        }
    }
    fun alternatives(journeys:List<JSONObject>):List<JSONObject> {
        val unique=rank(journeys).distinctBy { journey ->
            val steps=sequence(journey);val transit=steps.filter{it.optString("kind")=="transit"}
            (transit.ifEmpty{steps}).joinToString("|"){step->
                (if(transit.isEmpty())listOf("kind","fromName","toName") else listOf("mode","line","fromName","toName")).joinToString(":"){step.optString(it)}
            }
        }
        val fastest=unique.minOfOrNull{it.getJSONObject("metrics").getDouble("durationMinutes")}?:return emptyList()
        val cutoff=max(fastest*1.75,fastest+30)
        return rank(unique.filter{it.getJSONObject("metrics").getDouble("durationMinutes")<=cutoff})
    }
}

/** Explicit walk / board / ride / alight state machine, matching the original app. */
class TransitExecution(val journey:JSONObject, private val now:()->Long=System::currentTimeMillis) {
    var legIndex=0;private set
    var phase:String;private set
    val startedAt=now()
    var completedAt:Long?=null;private set
    val history=JSONArray()
    private val legs=TransitPolicy.sequence(journey)
    init { require(legs.isNotEmpty()){ "A journey needs at least one leg" };phase=initial(legs[0]);history.put(JSONObject().put("type","journey-started").put("legIndex",0).put("phase",phase).put("at",startedAt)) }
    private fun initial(leg:JSONObject)=when(leg.optString("kind")){"walk"->"walking";"transit"->"ready_to_board";else->error("Unsupported journey leg")}
    private fun record(type:String,phase:String){history.put(JSONObject().put("type",type).put("legIndex",legIndex).put("phase",phase).put("at",now()))}
    fun transition(action:String):Boolean {
        if(phase=="complete")return false
        when {
            legs[legIndex].optString("kind")=="walk"&&phase=="walking"&&action=="arrived"->{record("arrived","arrived");advance()}
            legs[legIndex].optString("kind")=="transit"&&phase=="ready_to_board"&&action=="boarded"->{phase="riding";record("boarded",phase)}
            legs[legIndex].optString("kind")=="transit"&&phase=="riding"&&action=="get_off"->{record("alighted","alighted");advance()}
            else->return false
        };return true
    }
    private fun advance(){if(legIndex+1>=legs.size){phase="complete";completedAt=now();record("journey-complete",phase)}else{legIndex++;phase=initial(legs[legIndex]);record("leg-started",phase)}}
}
