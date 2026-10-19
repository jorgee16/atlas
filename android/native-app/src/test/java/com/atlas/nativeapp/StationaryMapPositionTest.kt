package com.atlas.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Test

class StationaryMapPositionTest {
    private val base = Coordinate(40.0,-8.0)
    private fun fix(time:Double, speed:Double=0.0,accuracy:Double=8.0) =
        Fix(base,accuracy,speed,null,time)
    @Test fun stoppedGpsDriftDoesNotMoveTheCarMarker() {
        val policy=StationaryMapPosition()
        assertEquals(base,policy.select(base,fix(1.0),true,false))
        val drift=Coordinate(base.lat+0.00005,base.lon+0.00004)
        assertEquals(base,policy.select(drift,fix(2.0),true,false))
        assertEquals(base,policy.select(drift,fix(3.0),true,false))
    }
    @Test fun confirmedNewPositionIsAcceptedAfterIndependentFixes() {
        val policy=StationaryMapPosition()
        policy.select(base,fix(1.0),true,false)
        val position=Coordinate(base.lat+0.00032,base.lon)
        assertEquals(base,policy.select(position,fix(2.0),true,false))
        assertEquals(base,policy.select(position,fix(2.0),true,false))
        assertEquals(base,policy.select(position,fix(3.0),true,false))
        assertEquals(position,policy.select(position,fix(4.0),true,false))
    }
    @Test fun confirmedMovementAndWalkingNeverGetFrozen() {
        val policy=StationaryMapPosition()
        policy.select(base,fix(1.0),true,false)
        val point=Coordinate(base.lat+0.00001,base.lon)
        assertEquals(point,policy.select(point,fix(2.0,2.0),true,false))
        assertEquals(base,policy.select(base,fix(3.0,0.0),true,true))
        assertEquals(point,policy.select(point,fix(4.0,0.6),true,true))
    }
    @Test fun leavingNavigationResetsTheStationaryAnchor() {
        val policy=StationaryMapPosition()
        policy.select(base,fix(1.0),true,false)
        val point=Coordinate(base.lat+0.00003,base.lon)
        assertEquals(point,policy.select(point,fix(2.0),false,false))
        assertEquals(point,policy.select(point,fix(3.0),true,false))
    }
    @Test fun stoppedWalkingRejectsJitterButSlowConfirmedWalkingResumes() {
        val policy=StationaryMapPosition()
        policy.select(base,fix(1.0),true,true)
        val drift=Coordinate(base.lat+0.000025,base.lon)
        assertEquals(base,policy.select(drift,fix(2.0),true,true))
        assertEquals(base,policy.select(drift,fix(3.0),true,true))
        assertEquals(drift,policy.select(drift,fix(4.0,0.6),true,true))
    }
}

