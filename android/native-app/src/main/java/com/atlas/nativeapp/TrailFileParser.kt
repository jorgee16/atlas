package com.atlas.nativeapp

import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.zip.ZipInputStream

/** Each imported format is converted to the existing on-device Trail model. */
internal data class ParsedTrailFile(val name: String, val points: List<TrailPoint>, val format: String)

internal object TrailFileParser {
    private const val MAX_POINTS = 100_000
    private const val MAX_KML_BYTES = 10 * 1024 * 1024
    private const val MAX_ZIP_EXPANDED_BYTES = 40 * 1024 * 1024

    fun formatOf(fileName: String): String = when (fileName.substringAfterLast('.', "").lowercase()) {
        "gpx" -> "GPX"
        "kml" -> "KML"
        "kmz" -> "KMZ"
        "geojson", "json" -> "GeoJSON"
        else -> throw IllegalArgumentException("Choose a GPX, KML, KMZ or GeoJSON file")
    }

    fun parse(bytes: ByteArray, fileName: String, format: String): ParsedTrailFile = when (format) {
        "KML" -> fromKml(bytes.toString(Charsets.UTF_8), fileName, format)
        "KMZ" -> fromKml(extractKml(bytes), fileName, format)
        "GeoJSON" -> fromGeoJson(bytes.toString(Charsets.UTF_8), fileName)
        else -> throw IllegalArgumentException("Unsupported trail format")
    }

    private fun baseName(fileName: String): String =
        fileName.substringBeforeLast('.', fileName).trim().take(120).ifBlank { "Imported trail" }

    private fun point(lat: Double?, lon: Double?, elevation: Double? = null, time: Long? = null): TrailPoint? {
        if (lat == null || lon == null || !lat.isFinite() || !lon.isFinite() ||
            lat !in -90.0..90.0 || lon !in -180.0..180.0) return null
        return TrailPoint(Coordinate(lat, lon), elevation?.takeIf { it.isFinite() }, time)
    }

    private fun checked(points: List<TrailPoint>): List<TrailPoint> {
        require(points.size <= MAX_POINTS) { "Trail contains too many points" }
        return points
    }

    /** Read ZIP entries into bounded memory, never extracting arbitrary KMZ paths. */
    private fun extractKml(bytes: ByteArray): String {
        var selected: ByteArray? = null
        var expanded = 0L
        var entries = 0
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                entries++
                require(entries <= 80) { "KMZ contains too many entries" }
                val name = entry.name.replace('\\', '/')
                val isKml = !entry.isDirectory && name.endsWith(".kml", true) &&
                    !name.startsWith("/") && name.split('/').none { it == ".." }
                val output = if (isKml) ByteArrayOutputStream() else null
                val block = ByteArray(8192)
                while (true) {
                    val n = zip.read(block)
                    if (n < 0) break
                    expanded += n
                    require(expanded <= MAX_ZIP_EXPANDED_BYTES) { "KMZ expands beyond 40 MB" }
                    if (output != null) {
                        require(output.size() + n <= MAX_KML_BYTES) { "KMZ KML exceeds 10 MB" }
                        output.write(block, 0, n)
                    }
                }
                if (output != null && (selected == null || name.substringAfterLast('/').equals("doc.kml", true))) {
                    selected = output.toByteArray()
                }
                zip.closeEntry()
            }
        }
        return (selected ?: throw IllegalArgumentException("KMZ has no KML route")).toString(Charsets.UTF_8)
    }

    private data class Candidate(val title: String?, val positions: List<TrailPoint>)

    private fun fromKml(xml: String, filename: String, format: String): ParsedTrailFile {
        require(!xml.contains("<!DOCTYPE", true) && !xml.contains("<!ENTITY", true)) {
            "External XML entities are not supported"
        }
        val reader = XmlPullParserFactory.newInstance().newPullParser()
        reader.setInput(xml.reader())
        val routes = mutableListOf<Candidate>()
        var inPlacemark = false
        var inLine = false
        var inTrack = false
        var title: String? = null
        var line = emptyList<TrailPoint>()
        val coords = mutableListOf<TrailPoint>()
        val times = mutableListOf<Long?>()
        while (reader.eventType != XmlPullParser.END_DOCUMENT) {
            val tag = reader.name?.substringAfter(':')
            when (reader.eventType) {
                XmlPullParser.START_TAG -> when (tag) {
                    "Placemark" -> { inPlacemark = true; title = null }
                    "name" -> if (inPlacemark && title == null)
                        title = reader.nextText().trim().take(120).takeIf { it.isNotBlank() }
                    "LineString" -> { inLine = true; line = emptyList() }
                    "coordinates" -> if (inLine) line = kmlCoordinates(reader.nextText())
                    "Track" -> { inTrack = true; coords.clear(); times.clear() }
                    "coord" -> if (inTrack) {
                        val parts = reader.nextText().trim().split(Regex("\\s+"))
                        if (parts.size >= 2) {
                            point(parts[1].toDoubleOrNull(), parts[0].toDoubleOrNull(),
                                parts.getOrNull(2)?.toDoubleOrNull())?.let { coords.add(it) }
                            require(coords.size <= MAX_POINTS) { "Track contains too many points" }
                        }
                    }
                    "when" -> if (inTrack) {
                        times.add(runCatching { Instant.parse(reader.nextText()).toEpochMilli() }.getOrNull())
                    }
                }
                XmlPullParser.END_TAG -> when (tag) {
                    "LineString" -> {
                        if (line.size >= 2) routes.add(Candidate(title, checked(line)))
                        inLine = false
                    }
                    "Track" -> {
                        if (coords.size >= 2) routes.add(Candidate(title,
                            checked(coords.mapIndexed { i, p -> p.copy(time = times.getOrNull(i)) })))
                        inTrack = false
                    }
                    "Placemark" -> { inPlacemark = false; title = null }
                }
            }
            reader.next()
        }
        val best = routes.maxByOrNull { it.positions.size }
            ?: throw IllegalArgumentException("KML has no usable LineString or gx:Track")
        return ParsedTrailFile(best.title ?: baseName(filename), best.positions, format)
    }

    private fun kmlCoordinates(text: String): List<TrailPoint> {
        val points = ArrayList<TrailPoint>()
        for (token in text.trim().split(Regex("\\s+"))) {
            if (token.isBlank()) continue
            val xyz = token.split(',')
            if (xyz.size >= 2) {
                point(xyz[1].toDoubleOrNull(), xyz[0].toDoubleOrNull(),
                    xyz.getOrNull(2)?.toDoubleOrNull())?.let { points.add(it) }
                require(points.size <= MAX_POINTS) { "Track contains too many points" }
            }
        }
        return points
    }

    private fun fromGeoJson(json: String, filename: String): ParsedTrailFile {
        val root = JSONObject(json)
        val routes = mutableListOf<Candidate>()
        fun addGeometry(geometry: JSONObject?, name: String?) {
            if (geometry == null) return
            when (geometry.optString("type")) {
                "LineString" -> {
                    val coords = geometry.optJSONArray("coordinates") ?: return
                    val points = geoLine(coords)
                    if (points.size >= 2) routes.add(Candidate(name, points))
                }
                "MultiLineString" -> {
                    val lines = geometry.optJSONArray("coordinates") ?: return
                    require(lines.length() <= MAX_POINTS) { "Too many line segments" }
                    for (i in 0 until lines.length()) {
                        val points = geoLine(lines.optJSONArray(i) ?: continue)
                        if (points.size >= 2) routes.add(Candidate(name, points))
                    }
                }
            }
        }
        when (root.optString("type")) {
            "FeatureCollection" -> {
                val features = root.optJSONArray("features") ?: JSONArray()
                require(features.length() <= MAX_POINTS) { "Too many GeoJSON features" }
                for (i in 0 until features.length()) {
                    val feature = features.optJSONObject(i) ?: continue
                    addGeometry(feature.optJSONObject("geometry"),
                        feature.optJSONObject("properties")?.optString("name")?.takeIf { it.isNotBlank() })
                }
            }
            "Feature" -> addGeometry(root.optJSONObject("geometry"),
                root.optJSONObject("properties")?.optString("name")?.takeIf { it.isNotBlank() })
            else -> addGeometry(root, null)
        }
        val best = routes.maxByOrNull { it.positions.size }
            ?: throw IllegalArgumentException("GeoJSON has no usable LineString")
        return ParsedTrailFile(best.title?.take(120) ?: baseName(filename), best.positions, "GeoJSON")
    }

    private fun geoLine(coords: JSONArray): List<TrailPoint> {
        require(coords.length() <= MAX_POINTS) { "Track contains too many points" }
        val positions = ArrayList<TrailPoint>(coords.length())
        for (i in 0 until coords.length()) {
            val p = coords.optJSONArray(i) ?: continue
            if (p.length() < 2) continue
            point(p.optDouble(1), p.optDouble(0),
                if (p.length() >= 3) p.optDouble(2) else null)?.let { positions.add(it) }
        }
        return positions
    }
}
