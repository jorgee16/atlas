package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class RouteChoicesTest {
    @Test fun compactOrderedRoadsAndLocalFallback() {
        assertEquals("A8 → IC17 → A5",
            RouteChoices.roads(listOf("A8","IC17","A5")))
        assertEquals("Local roads",RouteChoices.roads(emptyList()))
        assertEquals("A8 → IC17 → A5 → EN360",
            RouteChoices.roads(listOf("A8","IC17","A5","EN360","EN9")))
    }
    @Test fun onlyGenuinelyDifferentPathsBecomeAlternatives() {
        assertFalse(RouteChoices.distinctEdges(setOf(1,2,3,4,5),
            listOf(setOf(1,2,3,4,5))))
        assertFalse(RouteChoices.distinctEdges(setOf(1,2,3,4,5,6),
            listOf(setOf(1,2,3,4,5))))
        assertTrue(RouteChoices.distinctEdges(setOf(1,2,6,7,8),
            listOf(setOf(1,2,3,4,5))))
        assertFalse(RouteChoices.distinctEdges(emptySet(),emptyList()))
    }
    @Test fun excessiveDiversionIsRejected() {
        assertTrue(RouteChoices.reasonableDetour(3600.0,60000.0,4800.0,75000.0))
        assertFalse(RouteChoices.reasonableDetour(3600.0,60000.0,10000.0,90000.0))
        assertFalse(RouteChoices.reasonableDetour(3600.0,60000.0,4500.0,150000.0))
    }
}
