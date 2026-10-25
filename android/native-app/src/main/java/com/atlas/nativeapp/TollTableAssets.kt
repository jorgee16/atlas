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

    fun read(context: Context, country: String): ByteArray? {
        if (!safeCountry(country)) return null
        return try {
            context.assets.open("tolls/$country.csv").use { input ->
                val bytes = input.readBytes()
                check(bytes.size in 1..(2 * 1024 * 1024)) { "Invalid toll catalog length" }
                bytes
            }
        } catch (_: FileNotFoundException) {
            null // No table for this country: prices unavailable, NEVER free.
        }
    }
}
