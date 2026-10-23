package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class GuidanceConfidencePresentationTest {
    @Test fun missedExitIsNeverMislabelledAsBadGps() {
        assertEquals("Checking route position · Keeping last reliable position",
            GuidanceConfidencePresentation.text("reduced", 5.0, false))
        assertEquals("Checking possible route deviation…",
            GuidanceConfidencePresentation.text("checking", 5.0, false))
        assertEquals("Off route · Finding another way…",
            GuidanceConfidencePresentation.text("checking", 5.0, true))
        assertEquals("Off route · Recalculating route…",
            GuidanceConfidencePresentation.text("reroute", 5.0, true))
    }
    @Test fun onlyBadHorizontalAccuracyClaimsReducedGpsPrecision() {
        assertEquals("GPS accuracy reduced · Holding last reliable position",
            GuidanceConfidencePresentation.text("reduced", 62.0, false))
        assertFalse(GuidanceConfidencePresentation.text("reduced", 4.0, false)!!
            .contains("GPS accuracy reduced"))
        assertNull(GuidanceConfidencePresentation.text("normal", 5.0, false))
    }
}
