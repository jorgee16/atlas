package com.atlas.nativeapp

/**
 * Pure visual camera policy. Route instructions and road matching never modify
 * the raw GPS location; this only sets the MapLibre FOLLOWING zoom and tilt.
 * Overview and manual FREE framing remain user-owned.
 */
internal object NavigationCameraFraming {
    data class Target(val zoom: Double, val tilt: Double)
    private data class Key(val distance: Double, val zoom: Double, val tilt: Double)

    // Metres until a manoeuvre, with extra perspective on long, easy sections
    // and detail at forks/exits/roundabouts. Continuous values avoid step jumps.
    private val approach = listOf(
        Key(0.0, 18.7, 49.0),
        Key(50.0, 18.55, 50.0),
        Key(150.0, 18.2, 53.0),
        Key(400.0, 17.7, 56.0),
        Key(1_000.0, 17.15, 58.0),
        Key(3_000.0, 16.65, 60.0),
        Key(7_000.0, 16.4, 60.0)
    )

    fun upcomingDistance(
        currentType: String?, distanceToCurrent: Double?,
        distanceToNextAfterDeparture: Double?
    ): Double? {
        // The initial 'Head NE' event is at 0 m. It must NOT cause a full
        // junction zoom when the first real turn is kilometres away.
        val value = if (currentType == "depart")
            distanceToNextAfterDeparture else distanceToCurrent
        return value?.takeIf { it.isFinite() && it >= 0.0 }
    }

    fun roundaboutTarget(base: Target, distanceMeters: Double, speed: Double): Target {
        if (!distanceMeters.isFinite() || distanceMeters !in 0.0..140.0) return base
        // More street geometry while actually navigating an approaching circle.
        // At high speeds resist zooming into the junction too early.
        val extra=((140.0-distanceMeters)/140.0).coerceIn(0.0,1.0)*
            if(speed >= 17.0) 0.25 else 0.65
        return Target((base.zoom+extra).coerceAtMost(19.1),
            (base.tilt-extra*8.0).coerceAtLeast(42.0))
    }

    fun target(walking: Boolean, speedMetersPerSecond: Double, nextMeters: Double?): Target {
        if (walking) return Target(18.0, 0.0)
        val distance = nextMeters?.takeIf { it.isFinite() && it >= 0.0 }
            ?: return Target(17.4, 57.0)
        val key = when {
            distance <= approach.first().distance -> approach.first()
            distance >= approach.last().distance -> approach.last()
            else -> {
                val high = approach.indexOfFirst { distance <= it.distance }
                val lo = approach[high - 1]
                val hi = approach[high]
                val fraction = (distance - lo.distance) / (hi.distance - lo.distance)
                Key(distance, lo.zoom + (hi.zoom - lo.zoom) * fraction,
                    lo.tilt + (hi.tilt - lo.tilt) * fraction)
            }
        }
        val kmh = speedMetersPerSecond.takeIf { it.isFinite() && it >= 0.0 }
            ?.times(3.6) ?: 0.0
        // At highway speed show more road ahead; at a nearby exit keep detail.
        val speedBias = ((kmh - 55.0) / 140.0).coerceIn(0.0, 0.45) *
            (distance / 450.0).coerceIn(0.18, 1.0)
        return Target((key.zoom - speedBias).coerceIn(16.0, 18.7), key.tilt)
    }
}
