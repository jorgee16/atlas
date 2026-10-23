package com.atlas.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TunnelRecoveryPolicyTest {
    private fun fix(lon:Double, time:Double, accuracy:Double=5.0,
                    speed:Double=12.0, moving:Boolean=true) = Fix(
        Coordinate(38.0,lon),accuracy,speed,90.0,time,motionConfirmed=moving)
    private fun guidance(time:Double)=JSONObject()
        .put("gpsFixTime",time).put("state","normal")
        .put("offRoute",4.0).put("along",750.0)

    @Test fun recoveryNeedsTwoAccurateConsecutiveIndependentFixes() {
        val before=fix(-9.0,100.0)
        val first=fix(-8.998,125.0)
        val second=fix(-8.99785,126.0)
        assertTrue(TunnelRecoveryPolicy.isBlackoutReturn(before,first))
        assertFalse("first fix after gap is not a consecutive pair",
            TunnelRecoveryPolicy.confirmedConsecutiveFixes(before,first,guidance(125.0)))
        assertTrue(TunnelRecoveryPolicy.confirmedConsecutiveFixes(
            first,second,guidance(126.0)))
        assertFalse("old JNI route match cannot authorize recovery",
            TunnelRecoveryPolicy.confirmedConsecutiveFixes(first,second,guidance(125.0)))
        assertFalse("inaccurate second fix cannot jump",
            TunnelRecoveryPolicy.confirmedConsecutiveFixes(
                first,second.copy(accuracy=70.0),guidance(126.0)))
        assertFalse("stationary fixes cannot simulate movement",
            TunnelRecoveryPolicy.confirmedConsecutiveFixes(
                first,second.copy(speed=0.0,motionConfirmed=false),guidance(126.0)))
        assertFalse("off-route map match cannot authorize teleport",
            TunnelRecoveryPolicy.confirmedConsecutiveFixes(
                first,second,guidance(126.0).put("offRoute",40.0)))
    }
}
