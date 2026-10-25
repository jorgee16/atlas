package com.atlas.nativeapp

import android.content.Context
import java.io.FileNotFoundException

/**
 * Country is resolved from the installed offline region, not from a global
 * Portugal-specific constant. To add a country, provide exactly one matching
 * APK asset: src/main/assets/tolls/<region.country>.csv.
 *
 * Tariffs are small text tables shipped separately from the road graph, so
 * they can change without repackaging Portugal routing or modifying C++.
 */
internal object TollTableAssets {
    fun safeCountry(country: String): Boolean =
        country.matches(Regex("[A-Za-z][A-Za-z -]{1,64}"))

    @Volatile private var instance:TollCatalogRepository?=null
    @Synchronized fun repository(context:Context):TollCatalogRepository {
        instance?.let { return it }
        val app=context.applicationContext
        return TollCatalogRepository(java.io.File(app.filesDir,"toll-tariffs"), { country ->
            try { app.assets.open("tolls/$country.csv").use { input ->
                val bytes=input.readBytes()
                require(bytes.size in 1..TollCatalog.MAX_BYTES)
                bytes
            } } catch(_:FileNotFoundException) { null }
        }, { country,bytes -> NativeCore().use { it.tariffs(country,bytes) } }).also { instance=it }
    }
    fun read(context:Context,country:String):ByteArray?=repository(context).load(country)?.csv
}
