package com.atlas.nativeapp

/**
 * Lane guidance derived conservatively from OpenStreetMap turn:lanes.
 * Never suggest a lane without a complete, explicit matching turn marking.
 */
internal object LaneGuidance {
    data class Lane(val symbols:String,val description:String,val recommended:Boolean)
    data class Result(val lanes:List<Lane>,val hasRecommendation:Boolean)

    private val symbols=mapOf(
        "left" to "←", "slight_left" to "↖", "sharp_left" to "↰",
        "through" to "↑", "right" to "→", "slight_right" to "↗",
        "sharp_right" to "↱", "reverse" to "↶",
        "merge_to_left" to "↖", "merge_to_right" to "↗"
    )
    private fun maneuverDirection(type:String):String? = when(type) {
        "turn-left" -> "left"
        "slight-left" -> "slight_left"
        "sharp-left" -> "sharp_left"
        "continue" -> "through"
        "turn-right" -> "right"
        "slight-right" -> "slight_right"
        "sharp-right" -> "sharp_right"
        else -> null
    }
    fun parse(raw:String, maneuverType:String):Result? {
        if(raw.isBlank())return null
        val lanes=raw.split('|')
        if(lanes.size !in 2..8)return null
        val parsed=lanes.map { value ->
            value.split(';').map { it.trim().lowercase().replace('-', '_') }
                .filter { it.isNotBlank() && it!="none" }
        }
        if(parsed.all { lane -> lane.none { it in symbols } })return null
        val reliable=parsed.all { it.isNotEmpty() && it.all(symbols::containsKey) }
        val expected=maneuverDirection(maneuverType)
        val matches=parsed.map { expected!=null && expected in it }
        val hasRecommendation=reliable && expected!=null &&
            matches.any { it } && matches.any { !it }
        return Result(parsed.mapIndexed { index, directions ->
            val icons=directions.mapNotNull(symbols::get).distinct()
            Lane(if(icons.isEmpty())"·" else icons.joinToString(""),
                if(directions.isEmpty())"unspecified" else directions.joinToString(" and ")
                    { it.replace('_',' ') },
                hasRecommendation && matches[index])
        }, hasRecommendation)
    }
}
