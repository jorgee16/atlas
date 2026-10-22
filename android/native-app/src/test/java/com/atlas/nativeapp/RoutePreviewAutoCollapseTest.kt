package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class RoutePreviewAutoCollapseTest {
    @Test fun collapsesAfterTenSecondsOfRoutePreviewWithoutTouch() {
        assertFalse(RoutePreviewAutoCollapse.shouldCollapse(10_000,2_000,0))
        assertTrue(RoutePreviewAutoCollapse.shouldCollapse(12_000,2_000,0))
    }
    @Test fun recentTouchPostponesCollapseInsteadOfDiscardingIt() {
        assertFalse(RoutePreviewAutoCollapse.shouldCollapse(12_000,0,9_000))
        assertTrue(RoutePreviewAutoCollapse.shouldCollapse(16_001,0,9_000))
    }
    @Test fun wallClockChangesMustNotCollapseInThePast() {
        assertFalse(RoutePreviewAutoCollapse.shouldCollapse(1_000,10_000,0))
    }
}
