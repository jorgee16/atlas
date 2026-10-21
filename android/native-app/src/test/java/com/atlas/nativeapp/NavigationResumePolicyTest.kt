package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationResumePolicyTest {
    @Test fun shortPauseWithoutNewFixKeepsNormalSmoothFollow() {
        assertFalse(NavigationResumePolicy.shouldSynchronize(100.0,100.2,true))
        // An ordinary app switch can last only one second. Treat it as
        // foreground resumption instead of replaying previously animated
        // route progress from the paused camera.
        assertTrue(NavigationResumePolicy.shouldSynchronize(100.0,101.0,true))
        assertFalse(NavigationResumePolicy.shouldSynchronize(100.0,200.0,false))
        assertFalse(NavigationResumePolicy.shouldSynchronize(Double.NaN,200.0,true))
    }
    @Test fun longPauseWithFreshGpsRequiresImmediateResync() {
        assertTrue(NavigationResumePolicy.shouldSynchronize(100.0,109.0,true))
        assertTrue(NavigationResumePolicy.freshFix(109.0,108.0))
        assertFalse(NavigationResumePolicy.freshFix(109.0,90.0))
        assertFalse(NavigationResumePolicy.freshFix(109.0,110.0))
    }
    @Test fun foregroundWaitsForCurrentAccurateGpsRatherThanOldFrames() {
        assertTrue(NavigationResumePolicy.trustworthyResumeFix(110.0,109.0,5.0))
        assertFalse(NavigationResumePolicy.trustworthyResumeFix(110.0,95.0,5.0))
        assertFalse(NavigationResumePolicy.trustworthyResumeFix(110.0,109.0,95.0))
        assertFalse(NavigationResumePolicy.trustworthyResumeFix(110.0,109.0,Double.NaN))
    }
    @Test fun latestConsecutiveFixesResumeImmediatelyAfterRealBackgroundTravel() {
        val a=Fix(Coordinate(40.0,-8.0),7.0,8.0,null,109.0,
            providerSpeed=8.0,motionConfirmed=true)
        val b=a.copy(point=Coordinate(40.0+8.0/111320.0,-8.0),time=110.0)
        // The cursor may have been kilometres behind during background;
        // only the distance between the two LATEST fixes matters.
        assertTrue(NavigationResumePolicy.consecutiveResumeFix(110.2,b,a))
        assertFalse(NavigationResumePolicy.consecutiveResumeFix(110.2,b,null))
        assertFalse(NavigationResumePolicy.consecutiveResumeFix(130.0,b,a))
    }
    @Test fun plausibleConsecutiveStationaryPositionsCanSynchronize() {
        val a=Fix(Coordinate(40.0,-8.0),12.0,0.0,null,109.0,
            providerSpeed=0.0,motionConfirmed=false)
        val b=a.copy(point=Coordinate(40.0+1.0/111320.0,-8.0),time=110.0)
        assertTrue(NavigationResumePolicy.consecutiveResumeFix(110.2,b,a))
    }
    @Test fun loneJumpEvenWithReportedPrecisionIsNotIndependentMotion() {
        val a=Fix(Coordinate(40.0,-8.0),5.0,0.0,null,109.0,
            providerSpeed=0.0,motionConfirmed=false)
        val jump=a.copy(point=Coordinate(40.0+76.8/111320.0,-8.0),time=110.0)
        assertFalse(NavigationResumePolicy.consecutiveResumeFix(110.1,jump,a))
        val consistent=jump.copy(time=111.0,
            point=Coordinate(jump.point.lat+8/111320.0,jump.point.lon),
            providerSpeed=8.0,speed=8.0,motionConfirmed=true)
        // A new credible sequence can be accepted: an old location must
        // never pin the user permanently after genuine travel.
        assertTrue(NavigationResumePolicy.consecutiveResumeFix(111.2,consistent,
            consistent.copy(time=110.0,point=jump.point)))
    }
    @Test fun degradedAccuracyRequiresNativeMotionEvidence() {
        val a=Fix(Coordinate(40.0,-8.0),55.0,7.0,null,109.0,
            providerSpeed=7.0,motionConfirmed=true)
        val b=a.copy(point=Coordinate(40.0+7/111320.0,-8.0),time=110.0)
        assertTrue(NavigationResumePolicy.consecutiveResumeFix(110.2,b,a))
        assertFalse(NavigationResumePolicy.consecutiveResumeFix(110.2,
            b.copy(motionConfirmed=false),a))
        assertFalse(NavigationResumePolicy.consecutiveResumeFix(110.2,
            b.copy(accuracy=100.0),a))
    }

    @Test fun reducedGuidanceCannotOverrulePairedRealPositionOnReturn() {
        val base=Fix(Coordinate(40.0,-8.0),6.0,8.0,null,112.0,
            providerSpeed=8.0,motionConfirmed=true)
        assertTrue(NavigationResumePolicy.useRouteOnResume(base,"normal"))
        assertFalse(NavigationResumePolicy.useRouteOnResume(base,"reduced"))
        assertFalse(NavigationResumePolicy.useRouteOnResume(base,"checking"))
        assertFalse(NavigationResumePolicy.useRouteOnResume(
            base.copy(motionConfirmed=false),"normal"))
        assertFalse(NavigationResumePolicy.useRouteOnResume(
            base.copy(accuracy=65.0),"normal"))
    }

    @Test fun predictedGuidanceCannotReplayTheFixUsedToResume() {
        assertTrue(NavigationResumePolicy.suppressOldFixPrediction(120.0, 120.0, true))
        assertFalse(NavigationResumePolicy.suppressOldFixPrediction(120.0, 120.0, false))
        assertFalse(NavigationResumePolicy.suppressOldFixPrediction(120.0, 121.0, true))
        assertFalse(NavigationResumePolicy.suppressOldFixPrediction(Double.NaN, 120.0, true))
        assertTrue(NavigationResumePolicy.newFixAfterResume(120.0,121.0))
        assertFalse(NavigationResumePolicy.newFixAfterResume(120.0,120.0))
    }

    @Test fun backgroundGpsCanRaceNativeGuidance() {
        assertTrue(NavigationResumePolicy.currentGuidance(109.0,109.0))
        assertFalse(NavigationResumePolicy.currentGuidance(109.0,108.0))
        assertFalse(NavigationResumePolicy.currentGuidance(109.0,Double.NaN))
    }
}
