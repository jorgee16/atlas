package com.atlas.nativeapp

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.File
import java.io.InputStream
import java.time.Instant
import java.util.UUID
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

data class TrailPoint(val point: Coordinate, val elevation: Double?, val time: Long?)
data class Trail(
    val id: String, val name: String, val points: List<TrailPoint>,
    val distanceMeters: Double, val ascentMeters: Double, val descentMeters: Double,
    val durationMillis: Long?, val importedAt: Long, val format: String = "GPX"
) {
    val polyline: List<Coordinate> get() {
        if (points.size <= 3500) return points.map { it.point }
        val stride=ceil(points.size/3500.0).toInt()
        return points.indices.step(stride).map { points[it].point } + points.last().point
    }
}

/** On-device GPX library ported from the legacy tracks-store.js. */
class TrailStore(context: Context) {
    private val root=File(context.filesDir,"trails").apply{mkdirs()}
    fun all(): List<Trail> = root.listFiles()?.asSequence()
        ?.filter { it.extension == "json" }
        ?.mapNotNull { runCatching { deserialize(it.readText()) }.getOrNull() }
        ?.sortedByDescending { it.importedAt }?.toList().orEmpty()

    /** Parsing is deliberately separate from saving: users review a trail first. */
    fun preview(input: InputStream, fileName: String): Trail {
        val format = TrailFileParser.formatOf(fileName)
        val output = java.io.ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        val maxBytes = if (format == "KMZ") 20 * 1024 * 1024 else 10 * 1024 * 1024
        input.use { stream ->
            while (true) {
                val count = stream.read(buffer)
                if (count < 0) break
                require(output.size() + count <= maxBytes) { "Trail file is too large" }
                output.write(buffer, 0, count)
            }
        }
        val bytes = output.toByteArray()
        if (format == "GPX") {
            val xml = bytes.toString(Charsets.UTF_8)
            require(!xml.contains("<!DOCTYPE", true) && !xml.contains("<!ENTITY", true)) {
                "External XML entities are not supported"
            }
            return parse(xml, fileName)
        }
        val parsed = TrailFileParser.parse(bytes, fileName, format)
        return build(parsed)
    }

    fun save(track: Trail): Trail {
        require(track.id.matches(Regex("[0-9a-f-]{36}")))
        val temporary = File(root, "${track.id}.tmp")
        val destination = File(root, "${track.id}.json")
        require(!destination.exists()) { "Trail is already saved" }
        try {
            temporary.writeText(serialize(track))
            check(temporary.renameTo(destination)) { "Unable to save trail" }
        } finally { temporary.delete() }
        return track
    }

    /** Kept for any existing call sites importing GPX directly. */
    fun importGpx(input: InputStream, fileName: String): Trail {
        require(TrailFileParser.formatOf(fileName) == "GPX")
        return save(preview(input, fileName))
    }

    fun importFile(input: InputStream, fileName: String): Trail = save(preview(input, fileName))

    private fun build(file: ParsedTrailFile): Trail {
        val points = file.points
        require(points.size in 2..100_000) { "No usable trail points" }
        var distance = 0.0
        var ascent = 0.0
        var descent = 0.0
        points.zipWithNext().forEach { (a, b) ->
            distance += meters(a.point, b.point)
            if (a.elevation != null && b.elevation != null) {
                val delta = b.elevation - a.elevation
                if (delta >= 0) ascent += delta else descent -= delta
            }
        }
        val timestamps = points.mapNotNull { it.time }
        val duration = if (timestamps.size >= 2)
            (timestamps.last() - timestamps.first()).coerceAtLeast(0L) else null
        return Trail(UUID.randomUUID().toString(), file.name.take(120),
            points, distance, ascent, descent, duration,
            System.currentTimeMillis(), file.format)
    }

    fun setCover(id:String,input:InputStream) {
        require(id.matches(Regex("[0-9a-f-]{36}")) && File(root,"$id.json").isFile)
        val out=java.io.ByteArrayOutputStream()
        val block=ByteArray(8192)
        input.use { stream -> while(true) {
            val n=stream.read(block);if(n<0)break
            require(out.size()+n<=8*1024*1024){"Image exceeds 8 MB"}
            out.write(block,0,n)
        }}
        val bytes=out.toByteArray()
        val size=BitmapFactory.Options().apply{inJustDecodeBounds=true}
        BitmapFactory.decodeByteArray(bytes,0,bytes.size,size)
        require(size.outWidth in 1..12000 && size.outHeight in 1..12000){"Invalid image"}
        val opts=BitmapFactory.Options().apply{
            inSampleSize=max(1,max(size.outWidth,size.outHeight)/640)
        }
        val image=BitmapFactory.decodeByteArray(bytes,0,bytes.size,opts)
            ?:error("Could not decode image")
        val temp=File(root,"$id.jpg.tmp")
        try{
            temp.outputStream().use{
                check(image.compress(Bitmap.CompressFormat.JPEG,85,it)){"Could not encode image"}
            }
            check(temp.renameTo(File(root,"$id.jpg"))){"Could not save cover"}
        }finally{image.recycle();temp.delete()}
    }

    fun thumbnail(trail:Trail): Bitmap {
        val file=File(root,"${trail.id}.jpg")
        if(file.isFile){
            val options=BitmapFactory.Options().apply{inSampleSize=2}
            BitmapFactory.decodeFile(file.absolutePath,options)?.let{return it}
        }
        val bitmap=Bitmap.createBitmap(192,144,Bitmap.Config.ARGB_8888)
        val canvas=Canvas(bitmap)
        canvas.drawColor(Color.rgb(27,47,60))
        val p=Paint(Paint.ANTI_ALIAS_FLAG).apply{
            style=Paint.Style.STROKE;strokeWidth=2f;color=Color.rgb(60,80,96)
        }
        for(i in 0..8) {
            canvas.drawLine((i*27).toFloat(),0f,(i*18).toFloat(),144f,p)
            canvas.drawLine(0f,(i*20).toFloat(),192f,(i*15).toFloat(),p)
        }
        val coords=trail.polyline
        val minLat=coords.minOf{it.lat};val maxLat=coords.maxOf{it.lat}
        val minLon=coords.minOf{it.lon};val maxLon=coords.maxOf{it.lon}
        val scale=min(156.0/max(1e-6,maxLon-minLon),108.0/max(1e-6,maxLat-minLat))
        val midLat=(minLat+maxLat)/2;val midLon=(minLon+maxLon)/2
        val path=Path()
        coords.forEachIndexed{index,pos->
            val x=(96+(pos.lon-midLon)*scale).toFloat()
            val y=(72-(pos.lat-midLat)*scale).toFloat()
            if(index==0)path.moveTo(x,y)else path.lineTo(x,y)
        }
        p.strokeWidth=7f;p.color=Color.rgb(16,30,43);canvas.drawPath(path,p)
        p.strokeWidth=4f;p.color=Color.rgb(49,94,251);canvas.drawPath(path,p)
        return bitmap
    }
    fun remove(id:String){
        require(id.matches(Regex("[0-9a-f-]{36}")))
        File(root,"$id.json").delete();File(root,"$id.jpg").delete()
    }

    private fun parse(xml:String, fileName:String): Trail {
        val reader=XmlPullParserFactory.newInstance().newPullParser()
        reader.setInput(xml.reader())
        val trk=mutableListOf<TrailPoint>();val rte=mutableListOf<TrailPoint>()
        var name:String?=null;var kind:String?=null
        var lat:Double?=null;var lon:Double?=null
        var elevation:Double?=null;var time:Long?=null
        while(reader.eventType!=XmlPullParser.END_DOCUMENT) {
            when(reader.eventType) {
                XmlPullParser.START_TAG -> when(reader.name.substringAfter(':')) {
                    "trkpt","rtept" -> {
                        kind=reader.name.substringAfter(':')
                        lat=reader.getAttributeValue(null,"lat")?.toDoubleOrNull()
                        lon=reader.getAttributeValue(null,"lon")?.toDoubleOrNull()
                        elevation=null;time=null
                    }
                    "ele" -> if(kind!=null)elevation=reader.nextText().toDoubleOrNull()
                    "time" -> if(kind!=null)time=runCatching{
                        Instant.parse(reader.nextText()).toEpochMilli()
                    }.getOrNull()
                    "name" -> if(kind==null&&name==null)name=reader.nextText().trim().takeIf{it.isNotBlank()}
                }
                XmlPullParser.END_TAG -> when(reader.name.substringAfter(':')) {
                    "trkpt","rtept" -> {
                        val a=lat;val o=lon
                        if(a!=null&&o!=null&&a in -90.0..90.0&&o in -180.0..180.0) {
                            val list=if(kind=="trkpt")trk else rte
                            require(list.size<100000){"GPX too many points"}
                            list.add(TrailPoint(Coordinate(a,o),elevation,time))
                        }
                        kind=null
                    }
                }
            }
            reader.next()
        }
        val points=(if(trk.size>=2)trk else rte).toList()
        require(points.size>=2){"GPX has no usable track"}
        var distance=0.0;var ascent=0.0;var descent=0.0
        points.zipWithNext().forEach{(a,b)->
            distance+=meters(a.point,b.point)
            val e1=a.elevation;val e2=b.elevation
            if(e1!=null&&e2!=null){
                val d=e2-e1;if(d>=0)ascent+=d else descent-=d
            }
        }
        val stamps=points.mapNotNull{it.time}
        return Trail(UUID.randomUUID().toString(),
            name?.take(120)?:fileName.removeSuffix(".gpx").take(120).ifBlank{"Imported trail"},
            points,distance,ascent,descent,
            if(stamps.size>=2)(stamps.last()-stamps.first()).coerceAtLeast(0L)else null,
            System.currentTimeMillis())
    }

    private fun serialize(t:Trail)=JSONObject()
        .put("id",t.id).put("name",t.name)
        .put("distance",t.distanceMeters).put("ascent",t.ascentMeters)
        .put("descent",t.descentMeters).put("duration",t.durationMillis)
        .put("format",t.format)
        .put("imported",t.importedAt)
        .put("points",JSONArray().apply { t.points.forEach{p->
            put(JSONArray().put(p.point.lon).put(p.point.lat).put(p.elevation).put(p.time))
        }}).toString()

    private fun deserialize(text:String):Trail {
        val o=JSONObject(text);val id=o.getString("id")
        require(id.matches(Regex("[0-9a-f-]{36}")))
        val arr=o.getJSONArray("points")
        require(arr.length() in 2..100000)
        val points=(0 until arr.length()).map { index ->
            val p=arr.getJSONArray(index)
            TrailPoint(Coordinate(p.getDouble(1),p.getDouble(0)),
                if(p.isNull(2))null else p.getDouble(2),
                if(p.isNull(3))null else p.getLong(3))
        }
        return Trail(id,o.getString("name"),points,o.getDouble("distance"),
            o.optDouble("ascent"),o.optDouble("descent"),
            if(o.isNull("duration"))null else o.getLong("duration"),
            o.getLong("imported"),o.optString("format","GPX"))
    }
    private fun meters(a:Coordinate,b:Coordinate):Double {
        val x=Math.toRadians(b.lat-a.lat)
        val y=Math.toRadians(b.lon-a.lon)
        val c=sin(x/2).pow(2)+cos(Math.toRadians(a.lat))*
            cos(Math.toRadians(b.lat))*sin(y/2).pow(2)
        return 6371000.0*2*atan2(sqrt(c.coerceIn(0.0,1.0)),sqrt((1-c).coerceAtLeast(0.0)))
    }
}
