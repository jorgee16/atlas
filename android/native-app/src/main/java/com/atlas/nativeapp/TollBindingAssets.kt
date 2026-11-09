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
        if((route.optJSONArray("edgeIndexes")?.length()?:0)==0)return null
        return loadForGraph(context,country,directory)
    }
    @Synchronized fun loadForGraph(context:Context,country:String,directory:File):TollBindingInput? {
        if(!TollTableAssets.safeCountry(country)||!directory.name.matches(Regex("[a-z0-9-]{1,64}")))return null
        return try {
            val bytes=context.assets.open("toll-bindings/$country/${directory.name}.csv").use { input ->
                input.readBytes().also { require(it.size in 1..2*1024*1024) }
            }
            // Loading authentic graph evidence is not a price decision. The
            // native matcher retains uncovered intervals and rejects exact
            // pricing while still detecting known physical collection points.
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
