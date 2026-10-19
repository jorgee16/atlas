package com.atlas.nativeapp

/** One camera owner. Style/layout callbacks may apply only the latest request. */
internal class NavigationCameraState {
    enum class Mode { FOLLOWING, OVERVIEW, FREE }
    var mode = Mode.FOLLOWING
        private set
    var revision = 0L
        private set
    var pending = true
        private set
    fun request(next: Mode) {
        mode = next
        revision++
        pending = next != Mode.FREE
    }
    fun viewportChanged() {
        revision++
        pending = mode != Mode.FREE
    }
    fun applied(request: Long) {
        if (request == revision) pending = false
    }
}
