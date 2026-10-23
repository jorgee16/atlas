package com.atlas.nativeapp

import android.graphics.Color
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression.*
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.*
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonOptions
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.LineString
import org.maplibre.geojson.Point

/** Owns only visual layers. Progress changes paint, never the immutable route source. */
internal class RouteLineRenderer(
    private val style: Style,
    private val id: String,
    val prepared: RouteVisualSmoothing.Prepared,
    alternative: Boolean,
    dark: Boolean
) {
    private val layers = mutableListOf<String>()
    private val sourceId = "$id-source"
    private var remaining: LineLayer? = null
    private var travelled: LineLayer? = null
    private var lastFraction = Double.NaN
    private var activeIndex = -1
    private var completed: LineLayer? = null
    private var future: LineLayer? = null
    private val chunks=RouteVisualChunks.prepare(prepared.points)

    init {
        val features=chunks.chunks.mapIndexed { index,part ->
            Feature.fromGeometry(LineString.fromLngLats(part.points.map { Point.fromLngLat(it.longitude,it.latitude) }))
                .apply { addNumberProperty("atlas-route-chunk",index) }
        }
        val source = GeoJsonSource(sourceId, FeatureCollection.fromFeatures(features),
            GeoJsonOptions().withLineMetrics(true).withTolerance(0f))
        style.addSource(source)
        if (alternative) {
            add("alternative", 4f, if (dark) Color.parseColor("#667385") else Color.parseColor("#AAB5C7"))
        } else {
            add("casing", 9f, Color.WHITE)
            completed=add("completed",5f,Color.rgb(158,169,186))
            future=add("future",6f,Color.rgb(49,94,251))
            remaining = add("remaining", 6f, Color.rgb(49, 94, 251))
            travelled = add("travelled", 5f, Color.rgb(158, 169, 186))
            progress(0.0)
        }
    }

    private fun add(suffix: String, width: Float, color: Int): LineLayer {
        val layer = LineLayer("$id-$suffix", sourceId).withProperties(
            lineWidth(width), lineColor(color), lineJoin(Property.LINE_JOIN_ROUND), lineCap(Property.LINE_CAP_ROUND))
        val labels = style.layers.firstOrNull { it is SymbolLayer }?.id
        if (labels == null) style.addLayer(layer) else style.addLayerBelow(layer, labels)
        layers.add(layer.id)
        return layer
    }

    fun progress(segment: Int, position: LatLng) = progress(prepared.fraction(segment, position))

    internal fun progress(fraction: Double) {
        val paint=chunks.progress(fraction)
        val value=paint.fraction
        if(paint.index!=activeIndex) {
            activeIndex=paint.index
            completed?.setFilter(lt(get("atlas-route-chunk"),literal(activeIndex)))
            future?.setFilter(gt(get("atlas-route-chunk"),literal(activeIndex)))
            remaining?.setFilter(eq(get("atlas-route-chunk"),literal(activeIndex)))
            travelled?.setFilter(eq(get("atlas-route-chunk"),literal(activeIndex)))
            lastFraction=Double.NaN
        }
        if (value == lastFraction) return
        lastFraction = value
        remaining?.setProperties(lineGradient(step(lineProgress(), rgba(0, 0, 0, 0),
            stop(value, rgb(49, 94, 251)))))
        travelled?.setProperties(lineGradient(step(lineProgress(), rgb(158, 169, 186),
            stop(value, rgba(0, 0, 0, 0)))))
    }

    fun remove() {
        layers.asReversed().forEach { style.removeLayer(it) }
        style.removeSource(sourceId)
    }
}
