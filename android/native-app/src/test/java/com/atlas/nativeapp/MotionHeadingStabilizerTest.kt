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
}
