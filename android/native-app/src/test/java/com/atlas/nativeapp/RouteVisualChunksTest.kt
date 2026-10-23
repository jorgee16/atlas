package com.atlas.nativeapp

import org.junit.Assert.*
import org.junit.Test
import org.maplibre.android.geometry.LatLng

class RouteVisualChunksTest {
    @Test fun countryLengthRoutesRetainSubMetrePaintResolutionAndExactSeams() {
        val start=LatLng(38.7,-9.1)
        val end=LatLng(38.7,-9.1+100000.0/(111320*kotlin.math.cos(Math.toRadians(38.7))))
        val raw=listOf(start,end)
        val prepared=RouteVisualChunks.prepare(raw)
        assertTrue(prepared.chunks.size>1000)
        assertEquals(start,prepared.chunks.first().points.first())
        assertEquals(end,prepared.chunks.last().points.last())
        for(part in prepared.chunks)assertTrue((part.end-part.start)/255.0<.38)
        for((a,b)in prepared.chunks.zipWithNext()) {
            assertEquals(a.points.last(),b.points.first());assertEquals(a.end,b.start,1e-8)
        }
        val length=RouteVisualSmoothing.distance(start,end)
        assertEquals(length,prepared.chunks.last().end,1e-5)
        val p=prepared.progress(50000.0/length)
        val reconstructed=prepared.chunks[p.index].let { it.start+p.fraction*(it.end-it.start) }
        assertEquals(50000.0,reconstructed,1e-5)
    }

    @Test fun oneMetreProgressRemainsOneMetreAcrossChunkBoundaries() {
        val points=listOf(LatLng(38.7,-9.1),LatLng(38.71,-9.1))
        val data=RouteVisualChunks.prepare(points)
        val total=data.chunks.last().end
        for(metre in 0..1000) {
            val p=data.progress(metre/total)
            val part=data.chunks[p.index]
            assertEquals(metre.toDouble(),part.start+p.fraction*(part.end-part.start),1e-6)
        }
    }
}
