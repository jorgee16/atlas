package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationResumePolicyTest {
    @Test fun shortPauseKeepsNormalSmoothFollow() {
        assertFalse(NavigationResumePolicy.shouldSynchronize(100.0,101.0,true))
        assertFalse(NavigationResumePolicy.shouldSynchronize(100.0,200.0,false))
        assertFalse(NavigationResumePolicy.shouldSynchronize(Double.NaN,200.0,true))
    }
    @Test fun longPauseWithFreshGpsRequiresImmediateResync() {
        assertTrue(NavigationResumePolicy.shouldSynchronize(100.0,109.0,true))
        assertTrue(NavigationResumePolicy.freshFix(109.0,108.0))
        assertFalse(NavigationResumePolicy.freshFix(109.0,90.0))
        assertFalse(NavigationResumePolicy.freshFix(109.0,110.0))
    }
    @Test fun backgroundGpsCanRaceNativeGuidance() {
        assertTrue(NavigationResumePolicy.currentGuidance(109.0,109.0))
        assertFalse(NavigationResumePolicy.currentGuidance(109.0,108.0))
        assertFalse(NavigationResumePolicy.currentGuidance(109.0,Double.NaN))
    }
}
