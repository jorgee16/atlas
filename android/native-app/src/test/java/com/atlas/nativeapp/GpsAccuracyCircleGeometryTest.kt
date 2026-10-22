package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class GpsAccuracyCircleGeometryTest {
    @Test fun precisionRadiusScalesWithReportedAccuracy() {
        val near=GpsAccuracyCircleGeometry.eastLongitude(38.7,-9.1,5.0)!!
        val far=GpsAccuracyCircleGeometry.eastLongitude(38.7,-9.1,20.0)!!
        assertEquals(4.0,(far+9.1)/(near+9.1),0.00001)
    }
    @Test fun invalidAccuracyIsNotRendered() {
        assertNull(GpsAccuracyCircleGeometry.eastLongitude(38.7,-9.1,0.0))
        assertNull(GpsAccuracyCircleGeometry.eastLongitude(38.7,-9.1,Double.NaN))
        assertNull(GpsAccuracyCircleGeometry.eastLongitude(95.0,-9.1,10.0))
    }
}
