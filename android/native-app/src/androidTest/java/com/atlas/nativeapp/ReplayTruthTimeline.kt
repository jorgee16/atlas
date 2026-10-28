package com.atlas.nativeapp

import java.util.concurrent.ConcurrentSkipListMap
import kotlin.math.abs

/** Pair replay truth with the GPS fix actually delivered to the renderer.
 * A newly injected Location is asynchronous; it cannot relabel an old frame.
 * Test-only metadata: never changes app GPS, timestamps or camera behaviour.
 */
internal class ReplayTruthTimeline {
    data class Truth(val heading:Double,val stableSince:Double,val fixTime:Double)
    private val entries=ConcurrentSkipListMap<Double,Truth>()

    @Synchronized fun record(fixTime:Double,heading:Double) {
        require(fixTime.isFinite() && heading.isFinite())
        val previous=entries.lastEntry()?.value
        require(previous==null || fixTime>previous.fixTime)
        // Match the heading gate's existing 1.5s freshness window. A
        // delivery blackout cannot accumulate four seconds of stable GPS
        // evidence while no new observations reach Android.
        val stableSince=if(previous==null || fixTime-previous.fixTime>=1.5 ||
            AtlasHeading.angleDifference(previous.heading,heading)>45.0)
                fixTime else previous.stableSince
        entries[fixTime]=Truth(heading,stableSince,fixTime)
    }

    fun forFix(fixTime:Double):Truth? {
        if(!fixTime.isFinite())return null
        // Tolerate timestamp serialization rounding, never a preceding 1Hz fix.
        return entries.floorEntry(fixTime+.001)?.value
            ?.takeIf { abs(it.fixTime-fixTime)<.01 }
    }
}
