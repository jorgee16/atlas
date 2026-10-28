package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class ReplayTruthTimelineTest {
    @Test fun queuedLocationCannotRelabelAnOldRenderedFrame() {
        val truth=ReplayTruthTimeline()
        truth.record(100.0,0.0)
        truth.record(114.6,180.0)
        assertEquals(0.0,truth.forFix(100.0)!!.heading,.001)
        assertEquals(100.0,truth.forFix(100.0)!!.fixTime,.001)
        assertEquals(180.0,truth.forFix(114.6)!!.heading,.001)
        assertEquals(114.6,truth.forFix(114.6)!!.stableSince,.001)
    }

    @Test fun pairingAllowsRoundingButNeverGuessesTruthForAnotherFix() {
        val truth=ReplayTruthTimeline()
        truth.record(100.0,325.0)
        truth.record(101.0,326.0)
        assertEquals(101.0,truth.forFix(101.000000001)!!.fixTime,.001)
        assertEquals(100.0,truth.forFix(101.0)!!.stableSince,.001)
        assertNull(truth.forFix(100.5))
        assertNull(truth.forFix(Double.NaN))
    }

    @Test fun staleDeliveryTimeCannotCountAsContinuousFreshHeadingEvidence() {
        val truth=ReplayTruthTimeline()
        truth.record(100.0,325.0)
        truth.record(101.0,326.0)
        assertEquals(100.0,truth.forFix(101.0)!!.stableSince,.001)
        truth.record(114.6,326.0)
        assertEquals(114.6,truth.forFix(114.6)!!.stableSince,.001)
        truth.record(115.6,326.0)
        assertEquals(114.6,truth.forFix(115.6)!!.stableSince,.001)
    }
}
