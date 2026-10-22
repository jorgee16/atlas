package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test

class RoadsideArrivalNoticeTest {
    @Test fun ordinaryDoorstepPinsDoNotShowAnAccessWarning() {
        assertNull(RoadsideArrivalNotice.text(5.0))
        assertNull(RoadsideArrivalNotice.text(75.0))
        assertNull(RoadsideArrivalNotice.text(Double.NaN))
    }
    @Test fun inaccessiblePolygonCentersKeepUserInformed() {
        assertTrue(RoadsideArrivalNotice.text(253.0)!!.contains("250 m"))
        assertTrue(RoadsideArrivalNotice.text(1525.0)!!.contains("1.5 km"))
        assertTrue(RoadsideArrivalNotice.text(200.0)!!.contains("vehicle entrance"))
    }
}
