package com.atlas.nativeapp

import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.cos
import kotlin.math.min

/** One visual clock also owns unconfirmed/off-route positions. Never drives guidance. */
internal class NavigationPositionInterpolator {
    private var position: Coordinate? = null
    private var target: Coordinate? = null
    private var fixTime = Double.NEGATIVE_INFINITY
    private var frameTime = Double.NaN
    private var accuracy = 10.0

    fun reset() {
        position=null; target=null; fixTime=Double.NEGATIVE_INFINITY; frameTime=Double.NaN
    }
    fun accept(point: Coordinate, timestamp: Double, uncertainty: Double,
               now: Double, seed: Coordinate? = null) {
        if (!timestamp.isFinite() || timestamp <= fixTime && seed == null) return
        fixTime=timestamp
        target=point
        accuracy=uncertainty.takeIf { it.isFinite() && it >= 0 } ?: 100.0
        if (seed != null || position == null) {
            position=seed ?: point
            frameTime=now
        }
    }
    fun sample(now: Double): Pair<Coordinate,Boolean>? {
        val p=position ?: return null
        val goal=target ?: return null
        if (!now.isFinite()) return null
        val dt=if(frameTime.isFinite())(now-frameTime).coerceIn(0.0,0.1) else 0.0
        frameTime=now
        val alpha=1-exp(-3.2*(30.0/accuracy.coerceAtLeast(10.0)).coerceIn(.15,1.0)*dt)
        val gap=hypot((p.lat-goal.lat)*111320.0,
            (p.lon-goal.lon)*111320.0*cos(Math.toRadians(goal.lat)))
        // Bound visual recovery even if the first unconfirmed fix is far away.
        val bounded=if(gap>0) min(alpha,45.0*dt/gap) else 0.0
        val next=Coordinate(p.lat+(goal.lat-p.lat)*bounded,p.lon+(goal.lon-p.lon)*bounded)
        position=next
        val error=hypot((next.lat-goal.lat)*111320.0,
            (next.lon-goal.lon)*111320.0*cos(Math.toRadians(goal.lat)))
        return next to (error > .1)
    }
}
