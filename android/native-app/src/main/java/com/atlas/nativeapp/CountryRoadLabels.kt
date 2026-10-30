package com.atlas.nativeapp

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/** Presentation-only country data. Never modifies native roads, prices or matching. */
internal class CountryRoadLabels private constructor(private val aliases:Map<String,String>) {
    fun resolve(refs:JSONArray?):List<String> = if(refs==null) emptyList() else
        (0 until refs.length()).map { compact(refs.optString(it)) }
            .filter { it.isNotBlank() }.map { aliases[it] ?: it }.distinct()

    companion object {
        private val spaces=Regex("\\s+")
        private fun compact(value:String)=value.replace(spaces,"").uppercase(Locale.ROOT)
        fun parse(country:String,json:String?):CountryRoadLabels {
            if(json==null)return CountryRoadLabels(emptyMap())
            val data=JSONObject(json)
            require(data.getString("country")==country) { "Road label country mismatch" }
            val values=data.getJSONObject("aliases")
            require(values.length()<=256)
            val aliases=values.keys().asSequence().associate { key ->
                val from=compact(key);val canonical=compact(values.getString(key))
                require(from.matches(Regex("[A-Z]+[0-9]+(?:-[0-9]+)*")) &&
                    canonical.matches(Regex("[A-Z]+[0-9]+(?:-[0-9]+)*")))
                from to canonical
            }
            require(aliases.values.none { it in aliases }) { "Road aliases must not chain" }
            return CountryRoadLabels(aliases)
        }
        fun read(context:Context,country:String):CountryRoadLabels {
            if(!country.matches(Regex("[A-Za-z][A-Za-z -]{1,64}")))return parse(country,null)
            return try {
                context.assets.open("road-labels/$country.json").bufferedReader().use { input ->
                    parse(country,input.readText())
                }
            } catch(_:java.io.IOException) { parse(country,null) }
              catch(_:org.json.JSONException) { parse(country,null) }
              catch(_:IllegalArgumentException) { parse(country,null) }
        }
    }
}
