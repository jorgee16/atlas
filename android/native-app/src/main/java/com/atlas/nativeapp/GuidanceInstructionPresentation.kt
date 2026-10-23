package com.atlas.nativeapp

/**
 * Human-readable, compact navigation banner presentation.
 *
 * Native routing preserves the original maneuvers for spoken guidance and
 * routing decisions. Raw OSM destination refs (semicolon-delimited) are only
 * normalized in the visible UI.
 */
internal object GuidanceInstructionPresentation {
    data class Text(val action: String, val destination: String?)

    fun roundaboutDestination(rawInstruction: String?, road: String?): String {
        val instruction=rawInstruction.orEmpty().trim()
        val connector=Regex("\\s+(?:onto|toward)\\s+",RegexOption.IGNORE_CASE)
            .find(instruction)
        val destination=(connector?.let { instruction.substring(it.range.last+1) }
            ?: road.orEmpty()).trim()
            .replace(Regex("\\s*;\\s*")," · ")
            .replace(Regex("\\s+")," ")
        return destination.ifBlank { "Follow the signed exit" }
    }

    fun format(rawInstruction: String?): Text {
        val cleaned = rawInstruction.orEmpty().trim()
            .replace(Regex("\\s*;\\s*"), " · ")
            .replace(Regex("\\s+"), " ")
        if (cleaned.isBlank()) return Text("Continue on your route", null)
        // The first matching connective separates the driving action from
        // the verbose list of destination signs and route designations.
        val connectives = listOf(" toward " to "Toward ", " onto " to "Onto ")
        val split = connectives.mapNotNull { (separator, prefix) ->
            cleaned.indexOf(separator, ignoreCase = true).takeIf { it > 0 }
                ?.let { Triple(it, separator, prefix) }
        }.minByOrNull { it.first }
        if (split == null) return Text(cleaned, null)
        val action = cleaned.substring(0, split.first).trim()
        val destination = cleaned.substring(split.first + split.second.length).trim()
        return if (action.isNotBlank() && destination.isNotBlank())
            Text(action, split.third + destination)
        else Text(cleaned, null)
    }
}
