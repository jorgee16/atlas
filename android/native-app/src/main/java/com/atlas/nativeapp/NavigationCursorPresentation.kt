package com.atlas.nativeapp

/**
 * A new map-match or GPS accuracy label is not movement. Both the 30 Hz
 * drawing clock and 1 Hz JNI state observer must honour the same anchor.
 *
 * Explicit navigation-start and foreground-resume epochs may synchronize
 * independently to a recent real GPS fix. Ordinary route matching cannot.
 */
internal object NavigationCursorPresentation {
    fun choose(previous: Coordinate?, candidate: Coordinate,
               fix: Fix, explicitGpsEpoch: Boolean): Coordinate {
        if (previous == null || explicitGpsEpoch) return candidate
        if (fix.motionConfirmed == false) return previous
        return candidate
    }
}
