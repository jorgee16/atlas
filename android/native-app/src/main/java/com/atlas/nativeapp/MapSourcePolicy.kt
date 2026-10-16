package com.atlas.nativeapp

/** Cartographic tile source selection; routing/search offline regions are independent. */
internal object MapSourcePolicy {
    const val AUTO = "auto"
    const val ONLINE = "online"
    const val OFFLINE = "offline"
    const val UNAVAILABLE = "unavailable"

    fun isValid(value: String): Boolean = value == AUTO || value == ONLINE || value == OFFLINE

    /** Never silently use network tiles when the user explicitly selected offline. */
    fun resolve(mode: String, hasLocalMap: Boolean): String {
        require(isValid(mode)) { "Unknown map source mode" }
        return when (mode) {
            ONLINE -> ONLINE
            OFFLINE -> if (hasLocalMap) OFFLINE else UNAVAILABLE
            else -> if (hasLocalMap) OFFLINE else ONLINE
        }
    }
}
