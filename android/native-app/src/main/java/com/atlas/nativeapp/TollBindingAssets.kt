package com.atlas.nativeapp

import android.content.Context
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest

internal data class TollBindingInput(val csv:ByteArray,val actualHashes:Array<String>)

/** Trusted APK evidence is graph-specific. Price updates do not replace this geometry.
 * Missing/mismatched evidence retains the road-average/unavailable fallback. */
internal object TollBindingAssets {
    private val graphFiles=listOf("nodes.bin","edges.bin","geometry.bin","roads.bin","strings.bin","restrictions.bin","spatial-index.bin")
    private data class Cached(val signature:List<Pair<Long,Long>>,val input:TollBindingInput)
    private val cache=linkedMapOf<String,Cached>()
    @Synchronized fun loadForRoute(context:Context,country:String,directory:File,route:org.json.JSONObject):TollBindingInput? {
        if(!TollTableAssets.safeCountry(country)||!directory.name.matches(Regex("[a-z0-9-]{1,64}")))return null
        return try {
            val bytes=context.assets.open("toll-bindings/$country/${directory.name}.csv").use { input ->
                input.readBytes().also { require(it.size in 1..2*1024*1024) }
            }
            val edges=route.optJSONArray("edgeIndexes") ?: return null
            if(edges.length()==0 || !route.optBoolean("hasTolls"))return null
            val coverage=bytes.toString(Charsets.UTF_8).lineSequence().filter { it.startsWith("coverage;") }
                .mapNotNull { it.split(';').getOrNull(1)?.toIntOrNull() }.toHashSet()
            // This is only a cheap negative prefilter. JNI verifies all graph
            // hashes, topology, direction, clipping and review before repricing.
            if((0 until edges.length()).any { edges.optInt(it,-1) !in coverage })return null
            val files=graphFiles.map { File(directory,it) }
            require(files.all { it.isFile && it.length()>0 })
            val signature=files.map { it.length() to it.lastModified() }
            val key=country+"|"+directory.canonicalPath
            cache[key]?.takeIf { it.signature==signature }?.let { return it.input }
            val hashes=files.map { file ->
                val digest=MessageDigest.getInstance("SHA-256")
                file.inputStream().use { input ->
                    val buffer=ByteArray(65536)
                    while(true) { val count=input.read(buffer);if(count<0)break;digest.update(buffer,0,count) }
                }
                digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
            }.toTypedArray()
            TollBindingInput(bytes,hashes).also {
                if(cache.size>=8)cache.remove(cache.keys.first())
                cache[key]=Cached(signature,it)
            }
        } catch(_:FileNotFoundException) { null }
          catch(_:IllegalArgumentException) { null }
          catch(_:java.io.IOException) { null }
    }
}
