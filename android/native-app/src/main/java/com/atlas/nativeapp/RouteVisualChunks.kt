package com.atlas.nativeapp

import org.maplibre.android.geometry.LatLng

/** Bound line-gradient ramp quantization even for country-length routes. */
internal object RouteVisualChunks {
    const val MAX_METRES = 96.0
    data class Chunk(val points:List<LatLng>,val start:Double,val end:Double)
    data class Paint(val index:Int,val fraction:Double)
    class Prepared(val chunks:List<Chunk>) {
        fun progress(fraction:Double):Paint {
            if(chunks.isEmpty())return Paint(0,0.0)
            val along=fraction.coerceIn(0.0,1.0)*chunks.last().end
            var lo=0;var hi=chunks.lastIndex
            while(lo<hi) { val mid=(lo+hi) ushr 1
                if(chunks[mid].end<along)lo=mid+1 else hi=mid }
            val part=chunks[lo]
            return Paint(lo,if(part.end>part.start)((along-part.start)/(part.end-part.start)).coerceIn(0.0,1.0) else 0.0)
        }
    }
    fun prepare(points:List<LatLng>):Prepared {
        if(points.size<2)return Prepared(emptyList())
        val result=mutableListOf<Chunk>()
        var current=mutableListOf(points.first())
        var start=0.0;var along=0.0
        for(i in 1 until points.size) {
            val a=points[i-1];val b=points[i]
            val length=RouteVisualSmoothing.distance(a,b)
            var offset=0.0
            while(length-offset>MAX_METRES-(along-start)+1e-8) {
                val take=MAX_METRES-(along-start)
                offset+=take;along+=take
                val t=offset/length
                val cut=LatLng(a.latitude+(b.latitude-a.latitude)*t,a.longitude+(b.longitude-a.longitude)*t)
                current.add(cut);result.add(Chunk(current.toList(),start,along))
                start=along;current=mutableListOf(cut)
            }
            along+=length-offset
            if(RouteVisualSmoothing.distance(current.last(),b)>1e-8)current.add(b)
        }
        if(current.size>=2)result.add(Chunk(current.toList(),start,along))
        return Prepared(result)
    }
}
