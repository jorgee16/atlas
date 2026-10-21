package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class NavigationDiagnosticsTest {
    @Test fun realFixAndPredictionAreClearlySeparated() {
        val fix=Fix(Coordinate(40.0,-8.0),5.0,6.0,70.0,100.0,
            bearingAccuracy=9.0,providerBearing=82.0,providerSpeed=7.0,
            motionConfirmed=true,provider="gps")
        val result=NavigationDiagnostics.snapshot(
            AtlasState(fix=fix,gpsHz=1.0,navigating=true),101.0)
        assertTrue(result.short.contains("1.0 Hz"))
        assertTrue(result.details.contains("GPS heading: 82°"))
        assertTrue(result.details.contains("Filtered heading: 70°"))
        assertTrue(result.details.contains("waiting for map-match"))
    }
    @Test fun staleFixDoesNotClaimLiveFrequency() {
        val fix=Fix(Coordinate(40.0,-8.0),80.0,0.0,null,100.0)
        val result=NavigationDiagnostics.snapshot(AtlasState(fix=fix,gpsHz=1.0),120.0)
        assertEquals("STALE GPS",result.headline)
        assertTrue(result.short.contains("— Hz"))
    }
}
