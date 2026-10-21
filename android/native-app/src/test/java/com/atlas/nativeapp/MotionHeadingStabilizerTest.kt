package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class MotionHeadingStabilizerTest {
    private fun fix(time: Double, bearing: Double? = 10.0,
        accuracy: Double = 5.0, directionError: Double? = 8.0,
        speed: Double = 14.0, lat: Double = 38.72) =
        Fix(Coordinate(lat,-9.14),accuracy,speed,bearing,time,directionError)

    @Test fun movingCarFollowsGpsInsteadOfDeviceRotation() {
        val filter = MotionHeadingStabilizer()
        assertEquals(10.0,filter.resolve(fix(1.0),255.0,false),0.001)
        assertTrue(filter.ownsMovingHeading(fix(1.0)))
        assertEquals(10.0,filter.resolve(fix(1.0),80.0,false),0.001)
    }
    @Test fun preciseProviderHeadingOverridesNoisyNativeDisplacementCourse() {
        val filter = MotionHeadingStabilizer()
        val nativeCourse=fix(1.0,bearing=172.0).copy(providerBearing=7.0)
        assertEquals(7.0,filter.resolve(nativeCourse,240.0,false),0.001)
    }
    @Test fun noisySingleFixDoesNotReverseDirection() {
        val filter = MotionHeadingStabilizer()
        filter.resolve(fix(1.0),250.0,false)
        assertEquals(10.0,filter.resolve(fix(2.0,180.0,70.0,90.0,lat=38.7201),
            200.0,false),0.001)
    }
    @Test fun genuineTurnNeedsConfirmationButThenAdvances() {
        val filter = MotionHeadingStabilizer()
        filter.resolve(fix(1.0,0.0),180.0,false)
        assertEquals(0.0,filter.resolve(fix(2.0,92.0),180.0,false),0.001)
        val next=filter.resolve(fix(3.0,94.0),180.0,false)
        assertTrue(next > 20.0 && next < 55.0)
        assertTrue(filter.resolve(fix(4.0,95.0),180.0,false) > next)
    }
    @Test fun reverseProjectionFromRerouteDoesNotFlipCar() {
        val filter=MotionHeadingStabilizer()
        filter.resolve(fix(1.0,10.0),90.0,false)
        val reversed=filter.resolve(fix(2.0,11.0),90.0,true,190.0,true)
        assertTrue(reversed < 40.0 || reversed > 340.0)
        // Actual movement and route in agreement can still turn.
        val accepted=filter.resolve(fix(3.0,12.0),90.0,true,35.0,true)
        assertTrue(accepted in 10.0..40.0)
    }
    @Test fun weakGpsTrustsRouteOnlyIfOnRoute() {
        val filter = MotionHeadingStabilizer()
        filter.resolve(fix(1.0,55.0),200.0,false)
        val weak=fix(2.0,170.0,75.0,80.0)
        assertTrue(filter.resolve(weak,200.0,true,90.0,true) in 80.0..92.0)
        assertEquals(55.0,filter.resolve(weak,200.0,true,90.0,false),0.001)
    }
    @Test fun slowTravelUsesCompassAndHandlesNorthWrap() {
        val filter = MotionHeadingStabilizer()
        filter.resolve(fix(1.0,359.0),90.0,false)
        val bearing=filter.resolve(fix(2.0,2.0),90.0,false)
        assertTrue(bearing > 355.0 || bearing < 8.0)
        assertEquals(205.0,filter.resolve(fix(3.0,speed=0.3),205.0,false),0.001)
    }
    @Test fun duplicatesAndBackdatedFixesNeverRewindCourse() {
        val filter=MotionHeadingStabilizer()
        filter.resolve(fix(1.0,20.0),90.0,false)
        assertEquals(20.0,filter.resolve(fix(1.0,180.0),90.0,false),0.001)
        assertEquals(20.0,filter.resolve(fix(0.1,180.0),90.0,false),0.001)
    }
    @Test fun twoOppositeGnssFixesCannotStartAFalseUTurn() {
        val f=MotionHeadingStabilizer()
        f.resolve(fix(1.0,0.0),null,true)
        assertEquals(0.0,f.resolve(fix(2.0,180.0),null,true),.001)
        assertEquals(0.0,f.resolve(fix(3.0,180.0),null,true),.001)
        // No positional corroboration: a third consistent fix permits a real turn.
        val turn=f.resolve(fix(4.0,180.0),null,true)
        assertTrue(AtlasHeading.angleDifference(turn,0.0) > 20.0)
    }
    @Test fun newTripDoesNotInheritAnOppositeCourseFromThePreviousJourney() {
        val filter=MotionHeadingStabilizer()
        filter.resolve(fix(1.0,120.0),null,true,120.0,true)
        filter.reset()
        assertEquals(325.0,filter.resolve(fix(2.0,325.0).copy(providerBearing=325.0),
            null,true,325.0,true),.001)
    }
    @Test fun oneHzEightMetreDisplacementConfirmsAGenuineUTurn() {
        val filter=MotionHeadingStabilizer()
        filter.resolve(fix(1.0,0.0,lat=38.72),null,true)
        filter.resolve(fix(2.0,0.0,lat=38.72+8.0/111320),null,true)
        val turn=filter.resolve(fix(3.0,180.0,lat=38.72),null,true,180.0,true)
        assertEquals(180.0,turn,.001)
    }
    @Test fun reacquiredGnssAfterFiveSecondGapConfirmsPhysicalTurnInsteadOfHoldingOldRouteBearing() {
        val filter=MotionHeadingStabilizer()
        filter.resolve(fix(1.0,176.0,speed=8.0),null,true,176.0,true)
        // A replay screenshot or Android callback delay can separate GPS
        // deliveries by >5s without invalidating 8m of observable movement.
        // Native-filtered heading may be wrong even though provider bearing
        // accuracy is 8 degrees. The independent position delta corroborates
        // the new ~60-degree course and rejects the stale reroute bearing.
        val moved=fix(6.5,331.0,speed=8.0).copy(
            point=Coordinate(38.72+4.0/111320.0,
                -9.14+7.0/(111320.0*0.7809)),providerBearing=60.0)
        assertEquals(60.0,filter.resolve(moved,null,true,176.0,true),1.0)
    }
    @Test fun longGapWithoutDisplacementDoesNotAuthorizeSpuriousGpsReversal() {
        val filter=MotionHeadingStabilizer()
        filter.resolve(fix(1.0,176.0,speed=8.0),null,true,176.0,true)
        val unmoved=fix(6.5,60.0,speed=8.0).copy(providerBearing=60.0)
        assertEquals(176.0,filter.resolve(unmoved,null,true,176.0,true),1.0)
    }
    @Test fun movementVerifiedGnssPreventsOnRouteRerouteBearingFromTurningCameraBackwards() {
        val filter=MotionHeadingStabilizer()
        filter.resolve(fix(1.0,60.0,speed=8.0).copy(providerBearing=60.0),
            null,true,60.0,true)
        // JNI/native heading is noisy, but the independent raw GNSS bearing
        // agrees with the 8 m physical movement to the north-east.
        val moved=fix(2.0,331.0,speed=8.0).copy(
            point=Coordinate(38.72+4.0/111320.0,
                -9.14+7.0/(111320.0*0.7809)),providerBearing=60.0)
        assertEquals(60.0,filter.resolve(moved,null,true,176.0,true),1.0)
    }
    @Test fun headingIgnoresOldOrMismatchedNativeGuidanceButAcceptsFreshGuidance() {
        assertFalse(NavigationResumePolicy.currentHeadingGuidance(10.0,9.9,9.0))
        assertFalse(NavigationResumePolicy.currentHeadingGuidance(10.0,7.0,7.0))
        assertTrue(NavigationResumePolicy.currentHeadingGuidance(10.0,9.0,9.0))
    }
    @Test fun twoInvertedBearingsCannotOverrideContinuingDisplacement() {
        val filter=MotionHeadingStabilizer()
        filter.resolve(fix(1.0,0.0,lat=38.72),null,true)
        for(i in 1..2)assertEquals(0.0,filter.resolve(
            fix(i+1.0,180.0,lat=38.72+i*8.0/111320),null,true),.001)
    }
}
