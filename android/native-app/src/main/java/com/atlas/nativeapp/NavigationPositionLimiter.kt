package com.atlas.nativeapp

import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max

/** Final presentation bound shared by frame ticks and state emissions.
 * Does not extrapolate/filter normal route movement a second time. It only
 * bridges discontinuities (first matching, route/free handoff and recovery).
 */
internal class NavigationPositionLimiter {
    private var position:Coordinate?=null
    private var lastTime=Double.NaN
    var active=false
        private set
    fun reset() { position=null;lastTime=Double.NaN;active=false }
    fun commit(target:Coordinate,now:Double,speed:Double):Coordinate {
        val previous=position
        if(previous==null) {position=target;lastTime=now;active=false;return target}
        if(!now.isFinite() || now<=lastTime)return previous
        val dt=(now-lastTime).coerceAtMost(.1)
        lastTime=now
        val distance=hypot((target.lat-previous.lat)*111320.0,
            (target.lon-previous.lon)*111320.0*cos(Math.toRadians(target.lat)))
        val budget=max(4.0,(speed.takeIf { it.isFinite() && it>=0.0 } ?: 0.0)*1.7+3.0)*dt
        val fraction=if(distance>budget && distance>0.0)budget/distance else 1.0
        val next=Coordinate(previous.lat+(target.lat-previous.lat)*fraction,
            previous.lon+(target.lon-previous.lon)*fraction)
        position=next
        active=distance-budget>.001
        return next
    }
}
