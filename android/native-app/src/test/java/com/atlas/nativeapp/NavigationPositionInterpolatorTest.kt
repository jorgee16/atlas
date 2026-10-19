package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationPositionInterpolatorTest {
    @Test fun handingOffAnOldRouteDoesNotSnapOrRestartOnDuplicateState() {
        val a=NavigationPositionInterpolator()
        val previous=Coordinate(38.72,-9.14)
        val actual=Coordinate(38.721,-9.14)
        a.accept(actual,10.0,5.0,10.0,previous)
        assertEquals(previous,a.sample(10.0)!!.first)
        val next=a.sample(10.033)!!.first
        assertTrue(next.lat > previous.lat && next.lat < actual.lat)
        a.accept(actual,10.0,5.0,10.033)
        assertTrue(a.sample(10.066)!!.first.lat > next.lat)
        repeat(200) { a.sample(10.1+it/30.0) }
        assertFalse(a.sample(20.0)!!.second)
    }
    @Test fun rejectsOutOfOrderTargetsAndDoesNotExtrapolateWithoutGps() {
        val a=NavigationPositionInterpolator()
        val p=Coordinate(38.72,-9.14)
        a.accept(p,10.0,100.0,10.0)
        a.accept(Coordinate(40.0,-8.0),9.0,5.0,10.0)
        assertEquals(p,a.sample(50.0)!!.first)
        assertFalse(a.sample(60.0)!!.second)
    }
}
