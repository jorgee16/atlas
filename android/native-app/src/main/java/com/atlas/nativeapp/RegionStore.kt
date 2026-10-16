package com.atlas.nativeapp

import android.content.Context
import android.os.StatFs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.net.URL

fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
fun JSONObject.coordinate() = Coordinate(getDouble("lat"), getDouble("lon"))
fun inBounds(point: Coordinate, bounds: JSONArray): Boolean = bounds.length() == 4 &&
    point.lon >= bounds.getDouble(0) && point.lat >= bounds.getDouble(1) && point.lon <= bounds.getDouble(2) && point.lat <= bounds.getDouble(3)

data class Region(val json: JSONObject) {
    val id: String = json.getString("id")
    val name: String = json.getString("name")
    val version: Int = json.getInt("version")
    val bytes: Long = json.optLong("sizeBytes")
    val assets: JSONObject = json.getJSONObject("assets")
    val files: List<JSONObject> = json.getJSONObject("package").getJSONArray("files").objects()
    fun contains(p: Coordinate): Boolean = (json.optJSONArray("areas") ?: JSONArray().put(json.getJSONArray("bounds"))).let { areas ->
        (0 until areas.length()).any { inBounds(p, areas.getJSONArray(it)) }
    }
}

/** Versioned staging + atomic marker commit: failed updates never replace the installed version. */
class RegionStore(context: Context) {
    companion object { const val ORIGIN = "https://pub-75539028275a4826aa383fdb89292ed7.r2.dev" }
    private val root = File(context.filesDir, "offline").apply { mkdirs() }
    private val mutex = Mutex()
    val regions = JSONObject(context.assets.open("regions.json").bufferedReader().use { it.readText() })
        .getJSONArray("regions").objects().map(::Region)
    private fun marker(region: Region) = File(root, "${region.id}.installed")
    fun installedVersion(region: Region): Int? = marker(region).takeIf { it.isFile }?.readText()?.trim()?.toIntOrNull()
    fun installed(region: Region) = installedVersion(region) != null
    fun directory(region: Region): File = File(root, "${region.id}/${installedVersion(region) ?: error("Download ${region.name} first")}")
    private fun asset(root: File, path: String): File {
        val uri = URI(path)
        require(!uri.isAbsolute && !path.startsWith("//") && uri.query == null && uri.fragment == null) { "Invalid package asset path" }
        val file = File(root, path.trimStart('/')).canonicalFile
        require(file.path.startsWith(root.canonicalPath + File.separator)) { "Unsafe package asset path" }
        return file
    }
    fun asset(region: Region, path: String): File = asset(directory(region), path)
    fun forPosition(p: Coordinate): Region = regions.firstOrNull { it.contains(p) && installed(it) }
        ?: error("Download the region covering this location")
    fun graph(from: Coordinate, to: Coordinate): File {
        val region = forPosition(from)
        require(region.contains(to)) { "Endpoints must be in the same offline region" }
        val routing = region.assets.getJSONObject("routing")
        val partitions = routing.optJSONArray("partitions")
        val selected = if (partitions == null) routing else partitions.objects().firstOrNull {
            inBounds(from, it.getJSONArray("bounds")) && inBounds(to, it.getJSONArray("bounds"))
        } ?: error("Endpoints must be in the same routing partition")
        return asset(region, selected.getString("nodes")).parentFile!!
    }
    fun search(p: Coordinate): File = asset(forPosition(p), forPosition(p).assets.getString("searchRecords")).parentFile!!
    fun map(p: Coordinate): File? {
        val region = regions.firstOrNull { installed(it) && it.contains(p) } ?: return null
        return region.assets.optString("map").takeIf { it.isNotBlank() }?.let { asset(region, it) }?.takeIf { it.isFile }
    }
    suspend fun install(region: Region, progress: (Long, Long) -> Unit) = mutex.withLock {
        withContext(Dispatchers.IO) {
            if (installedVersion(region) == region.version) return@withContext
            // Do not delete the staging directory on retry/cancellation: a 960 MB
            // region must continue from verified partial files after interruption.
            val staging = File(root, "${region.id}/staging-${region.version}").apply { mkdirs() }
            val stagedBytes = region.files.sumOf { entry ->
                val partial = asset(staging, entry.getString("url"))
                partial.length().coerceAtMost(entry.getLong("sizeBytes")).coerceAtLeast(0L)
            }
            val remainingBytes = (region.bytes - stagedBytes).coerceAtLeast(0L)
            require(StatFs(root.path).availableBytes > remainingBytes + 32L * 1024 * 1024) {
                "Not enough storage for ${region.name}"
            }
            var downloaded = 0L
            for (entry in region.files) {
                currentCoroutineContext().ensureActive()
                val path = entry.getString("url")
                val target = asset(staging, path).apply { parentFile!!.mkdirs() }
                RegionFileTransfer.fetch(
                    URL(ORIGIN + "/" + path.trimStart('/')),
                    target,
                    entry.getLong("sizeBytes"),
                    entry.getString("sha256")
                ) { delta ->
                    downloaded += delta
                    progress(downloaded.coerceIn(0L, region.bytes), region.bytes)
                }
            }
            val dest = File(root, "${region.id}/${region.version}")
            // The old installed marker stays untouched until every file checks out.
            dest.deleteRecursively()
            check(staging.renameTo(dest)) { "Could not commit downloaded package" }
            val next = File(root, "${region.id}.next")
            next.outputStream().use { it.write(region.version.toString().toByteArray()); it.fd.sync() }
            check(next.renameTo(marker(region))) { "Could not activate downloaded package" }
            File(root, region.id).listFiles()?.filter { it != dest }?.forEach { it.deleteRecursively() }
        }
    }
    suspend fun remove(region: Region) = mutex.withLock { withContext(Dispatchers.IO) {
        check(!marker(region).exists() || marker(region).delete()) { "Could not remove installed marker" }
        check(File(root, region.id).deleteRecursively()) { "Could not remove downloaded data" }
    } }
}
