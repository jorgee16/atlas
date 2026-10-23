package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class LaneGuidanceTest {
    @Test fun fourLanesHighlightTheTwoExitLanes() {
        val g=LaneGuidance.parse("through|through|through;slight_right|slight_right",
            "slight-right")!!
        assertEquals(listOf(false,false,true,true),g.lanes.map { it.recommended })
        assertEquals(listOf("↑","↑","↑↗","↗"),g.lanes.map { it.symbols })
    }
    @Test fun combinedArrowsArePreservedAndHighlightedForExactTurn() {
        val g=LaneGuidance.parse("left|through;right|right","turn-right")!!
        assertEquals("↑→",g.lanes[1].symbols)
        assertEquals(listOf(false,true,true),g.lanes.map { it.recommended })
    }
    @Test fun incompleteOrAmbiguousTagsNeverSuggestALane() {
        assertNull(LaneGuidance.parse("","turn-right"))
        val g=LaneGuidance.parse("through||right","turn-right")!!
        assertFalse(g.hasRecommendation)
        assertTrue(g.lanes.none { it.recommended })
        assertFalse(LaneGuidance.parse("left|through|right","slight-right")!!.hasRecommendation)
        assertFalse(LaneGuidance.parse("left|through|right","roundabout")!!.hasRecommendation)
        assertNull(LaneGuidance.parse("left","turn-left"))
        assertNull(LaneGuidance.parse("none|none","turn-left"))
    }
}
