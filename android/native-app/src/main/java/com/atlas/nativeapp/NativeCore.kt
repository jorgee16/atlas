package com.atlas.nativeapp

/** A single worker owns this handle; JNI catches C++ exceptions before crossing into Kotlin. */
class NativeCore : AutoCloseable {
    companion object { init { System.loadLibrary("atlas_jni") } }
    private var handle = create()
    private external fun remember(handle: Long, key: Int)
    private external fun activate(handle: Long, key: Int)
    private external fun create(): Long
    external fun cancel()
    private external fun destroy(handle: Long)
    private external fun openGraph(handle: Long, directory: String)
    private external fun openSearch(handle: Long, directory: String)
    private external fun find(handle: Long, query: ByteArray, lat: Double, lon: Double, nearby: Boolean, category: String): ByteArray
    private external fun calculate(handle: Long, a: Double, b: Double, c: Double, d: Double, walk: Boolean, avoid: Boolean, penalty: Double, vehicle: Int, heading: Double): ByteArray
    private external fun filter(handle: Long, lat: Double, lon: Double, accuracy: Double, speed: Double, heading: Double, time: Double): ByteArray
    private external fun update(handle: Long, lat: Double, lon: Double, accuracy: Double, speed: Double, time: Double): ByteArray
    fun remember(key: Int) = remember(handle, key)
    fun activate(key: Int) = activate(handle, key)
    fun graph(directory: String) = openGraph(handle, directory)
    fun search(directory: String) = openSearch(handle, directory)
    fun find(query: String, anchor: Coordinate, nearby: Boolean = false, category: String = "") =
        find(handle, query.toByteArray(Charsets.UTF_8), anchor.lat, anchor.lon, nearby, category).toString(Charsets.UTF_8)
    fun route(from: Coordinate, to: Coordinate, walking: Boolean, avoid: Boolean, penalty: Double, vehicle: Int,
              heading: Double? = null) =
        calculate(handle, from.lat, from.lon, to.lat, to.lon, walking, avoid, penalty, vehicle,
                  heading?.takeIf { it.isFinite() && it >= 0.0 } ?: -1.0).toString(Charsets.UTF_8)
    fun filter(fix: Fix): Fix {
        val result = org.json.JSONObject(filter(handle, fix.point.lat, fix.point.lon, fix.accuracy, fix.speed, fix.bearing ?: -1.0, fix.time).toString(Charsets.UTF_8))
        return fix.copy(speed = result.getDouble("speed"), bearing = if (result.isNull("heading")) null else result.getDouble("heading"),
            providerSpeed = fix.providerSpeed ?: fix.speed,
            motionConfirmed = result.getBoolean("moving"))
    }
    fun update(fix: Fix) = update(handle, fix.point.lat, fix.point.lon, fix.accuracy, fix.speed, fix.time).toString(Charsets.UTF_8)
    override fun close() { if (handle != 0L) { destroy(handle); handle = 0 } }
}
data class Coordinate(val lat: Double, val lon: Double) {
    init { require(lat.isFinite() && lon.isFinite() && lat in -90.0..90.0 && lon in -180.0..180.0) }
}
data class Fix(val point: Coordinate, val accuracy: Double, val speed: Double, val bearing: Double?, val time: Double, val bearingAccuracy: Double? = null, val providerBearing: Double? = null, val providerSpeed: Double? = null,
               val motionConfirmed: Boolean? = null, val provider: String? = null)

