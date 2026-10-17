package com.atlas.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationRenderInterpolatorTest {
    private val first = Coordinate(40.0,-8.0)
    private val turn = Coordinate(40.0009,-8.0)
    private val last = Coordinate(40.0009,-7.9988)
    private fun route() = NavigationRenderInterpolator().apply {
        setRoute(listOf(first,turn,last),200.0)
    }

    @Test fun interpolatesSmoothlyWithOneHertzGps() {
        val a=route()
        assertTrue(a.acceptGps(0.0,first,12.0,5.0,100.0,false))
        assertEquals(first,a.sample(100.0)!!.position)
        val mid=a.sample(100.5)!!
        assertTrue(mid.active)
        assertTrue(mid.along > 0.0 && mid.along < 6.1)
        assertTrue(mid.position.lon <= -8.0 + 1e-8)
        val next=a.sample(101.0)!!
        assertTrue(next.along > mid.along)
        assertTrue(next.along < 12.1)
        assertFalse(a.acceptGps(14.0,first,12.0,5.0,100.0,false))
        assertTrue(a.acceptGps(14.0,turn,12.0,5.0,101.0,false))
        val corrected=a.sample(101.033)!!
        assertTrue(corrected.along > next.along)
        assertTrue(corrected.along < 14.5)
    }

    @Test fun predictionFollowsBendInsteadOfStraightLine() {
        val a=route()
        assertTrue(a.acceptGps(98.0,first,25.0,5.0,100.0,false))
        a.sample(100.0)
        val end=a.sample(101.2)!!
        assertTrue(end.position.lat > 40.0003)
        assertTrue(end.position.lon >= -8.0)
        assertTrue(end.along > 100.0)
    }

    @Test fun stopsAfterBoundedPredictionAndNeverPredictsPastArrival() {
        val a=route()
        a.acceptGps(195.0,last,20.0,5.0,100.0,false)
        a.sample(100.0)
        a.sample(101.2)
        assertTrue(a.sample(101.4)!!.along <= 200.0)
        assertTrue(a.sample(108.0)!!.along <= 200.0)
    }

    @Test fun walkingHasShorterHorizonAndDifferentMinimumSpeed() {
        val a=route()
        a.acceptGps(10.0,first,0.6,8.0,50.0,true)
        a.sample(50.0)
        val walking=a.sample(50.55)!!
        assertTrue(walking.along > 10.0)
        val after=a.sample(54.0)!!
        assertTrue(after.along <= 10.34)
    }

    @Test fun stationaryGpsNoiseNeverCreepsForward() {
        val a=route()
        a.acceptGps(50.0,first,0.0,14.0,100.0,false)
        assertEquals(50.0,a.sample(100.0)!!.along,0.0001)
        assertTrue(a.acceptGps(57.0,first,0.0,14.0,101.0,false))
        assertEquals(50.0,a.sample(101.0)!!.along,0.0001)
    }

    @Test fun predictedTunnelProgressIsNotExtrapolatedAgain() {
        val a=route()
        a.acceptGps(10.0,first,10.0,5.0,100.0,false)
        a.sample(100.0)
        a.sample(101.2)
        assertTrue(a.acceptGapPrediction(60.0,103.0,5.0,false))
        a.sample(103.0)
        val frame=a.sample(103.6)!!
        assertTrue(frame.along < 60.0)
        assertFalse(frame.active && frame.along > 60.0)
        assertFalse(a.acceptGapPrediction(65.0,103.0,5.0,false))
        assertTrue(a.acceptGps(64.0,turn,10.0,5.0,103.2,false))
    }

    @Test fun routeResetInvalidatesOldPrediction() {
        val a=route()
        a.acceptGps(40.0,first,10.0,5.0,100.0,false)
        a.sample(101.0)
        a.setRoute(listOf(first,turn),100.0)
        assertEquals(null,a.sample(101.1))
        a.acceptGps(0.0,first,0.0,5.0,101.2,false)
        assertEquals(0.0,a.sample(101.2)!!.along,0.00001)
    }

    @Test fun veryInaccurateGpsCanCorrectButCannotPredict() {
        val a=route()
        a.acceptGps(30.0,first,12.0,70.0,100.0,false)
        val start=a.sample(100.0)!!
        val later=a.sample(101.0)!!
        assertEquals(start.along,later.along,1e-6)
    }
}
