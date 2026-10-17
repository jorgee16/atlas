package com.atlas.nativeapp

import org.json.JSONObject
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.BackgroundLayer
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.VectorSource

/**
 * Hybrid Atlas cartography: uncluttered during turn-by-turn guidance and
 * building/POI detail while exploring. Rendering stays in MapLibre Native.
 */
internal object AtlasCartography {

    /** Third-party Esri imagery is online-only; do not repackage offline. */
    private const val IMAGE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    private const val LABEL_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
    const val SATELLITE_CREDIT = "© Esri, Maxar, Earthstar Geographics, GIS User Community and imagery contributors"

    fun satelliteStyle(hybrid:Boolean):String {
        val labels=if(hybrid) """,
          "satellite-references":{"type":"raster","tiles":[${JSONObject.quote(LABEL_URL)}],
            "tileSize":256,"maxzoom":19,"attribution":"© Esri and contributors"}
        """.trimIndent() else ""
        val labelsLayer=if(hybrid) """,
          {"id":"satellite-reference-layer","type":"raster","source":"satellite-references",
            "paint":{"raster-opacity":1}}
        """.trimIndent() else ""
        return """
        {
          "version":8,
          "sources":{
            "satellite-imagery":{"type":"raster","tiles":[${JSONObject.quote(IMAGE_URL)}],
              "tileSize":256,"maxzoom":19,"attribution":${JSONObject.quote(SATELLITE_CREDIT)}}
            $labels
          },
          "layers":[
            {"id":"satellite-background","type":"background",
             "paint":{"background-color":"#1F2B35"}},
            {"id":"satellite-raster","type":"raster","source":"satellite-imagery",
              "paint":{"raster-opacity":1}}
            $labelsLayer
          ]
        }
        """.trimIndent()
    }

    fun onlineUri(dark: Boolean, navigating: Boolean): String =
        "https://tiles.openfreemap.org/styles/" +
            (if (dark) "dark" else if (navigating) "positron" else "liberty")

    /**
     * PMTiles use the OpenMapTiles layer names. Labels require glyph PBFs;
     * package glyphs locally before promising a fully offline labelled map.
     */
    fun offlineStyle(pmtilesUrl: String, dark: Boolean, navigating: Boolean): String {
        val base = if (dark) "#1D2B38" else "#F0F2EF"
        val water = if (dark) "#24485E" else "#A7D7E7"
        val park = if (dark) "#2B473A" else "#D7EAD1"
        val building = if (dark) "#364958" else "#DFE4E3"
        val outline = if (dark) "#63788A" else "#BAC7CD"
        val roadCasing = if (dark) "#344555" else "#D5DADD"
        val road = if (dark) "#8EA3B8" else "#FFFFFF"
        val names = if (dark) "#E1EAF2" else "#344453"
        val halo = if (dark) "#1D2B38" else "#FFFFFF"
        val placeLabels = if (navigating) "" else """
            ,{"id":"atlas-place-labels","type":"symbol","source":"atlas","source-layer":"place",
              "minzoom":5,"layout":{"text-field":["get","name"],"text-font":["Noto Sans Regular"],
              "text-size":12,"text-max-width":9},
              "paint":{"text-color":"$names","text-halo-color":"$halo","text-halo-width":1.2}}
            ,{"id":"atlas-poi-labels","type":"symbol","source":"atlas","source-layer":"poi",
              "minzoom":16,"layout":{"text-field":["get","name"],"text-font":["Noto Sans Regular"],
              "text-size":10,"text-max-width":7},
              "paint":{"text-color":"$names","text-halo-color":"$halo","text-halo-width":1}}
        """.trimIndent()
        val parks = if (navigating) "" else """
            ,{"id":"atlas-parks","type":"fill","source":"atlas","source-layer":"landuse",
              "filter":["in",["get","class"],["literal",["park","forest","grass","wood"]]],
              "paint":{"fill-color":"$park","fill-opacity":0.7}}
        """.trimIndent()
        return """
        {
          "version":8,
          "glyphs":"https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
          "sources":{"atlas":{"type":"vector","url":${JSONObject.quote(pmtilesUrl)}}},
          "layers":[
            {"id":"atlas-background","type":"background","paint":{"background-color":"$base"}},
            {"id":"atlas-landcover","type":"fill","source":"atlas","source-layer":"landcover",
              "paint":{"fill-color":"$park","fill-opacity":0.65}}
            $parks,
            {"id":"atlas-water","type":"fill","source":"atlas","source-layer":"water",
              "paint":{"fill-color":"$water"}},
            {"id":"atlas-buildings","type":"fill","source":"atlas","source-layer":"building",
              "minzoom":13,
              "paint":{"fill-color":"$building","fill-outline-color":"$outline"}},
            {"id":"atlas-road-casing","type":"line","source":"atlas","source-layer":"transportation",
              "paint":{"line-color":"$roadCasing",
              "line-width":["interpolate",["linear"],["zoom"],8,1.5,14,3.8,18,8]}},
            {"id":"atlas-road-surface","type":"line","source":"atlas","source-layer":"transportation",
              "paint":{"line-color":"$road",
              "line-width":["interpolate",["linear"],["zoom"],8,0.8,14,2.5,18,6]}},
            {"id":"atlas-road-labels","type":"symbol","source":"atlas","source-layer":"transportation_name",
              "minzoom":13,"layout":{"symbol-placement":"line","text-field":["get","name"],
              "text-font":["Noto Sans Regular"],"text-size":11},
              "paint":{"text-color":"$names","text-halo-color":"$halo","text-halo-width":1.25}}
            $placeLabels
          ]
        }
        """.trimIndent()
    }

    /** Add a legible building footprint below streets/labels from the vector source. */
    fun enhanceOnline(style: Style, dark: Boolean, navigating: Boolean) {
        val source = style.getSource("openmaptiles")
            ?: style.getSource("openfreemap")
            ?: style.sources.filterIsInstance<VectorSource>().firstOrNull()
            ?: return

        if (dark) {
            for (layer in style.layers) {
                val id = layer.id.lowercase()
                when (layer) {
                    is BackgroundLayer -> layer.setProperties(
                        PropertyFactory.backgroundColor(if (navigating) "#1D2B38" else "#20303D"))
                    is FillLayer -> when {
                        id.contains("park") || id.contains("forest") || id.contains("wood") ->
                            layer.setProperties(PropertyFactory.fillColor("#2C493B"))
                        id.contains("water") ->
                            layer.setProperties(PropertyFactory.fillColor("#24485E"))
                        id.contains("building") ->
                            layer.setProperties(PropertyFactory.fillColor("#334657"),
                                PropertyFactory.fillOutlineColor("#526C7F"))
                    }
                    is LineLayer -> if ((id.contains("road") || id.contains("highway") ||
                            id.contains("street")) && !id.contains("casing")) {
                        layer.setProperties(
                            PropertyFactory.lineColor(if (navigating) "#7C92A7" else "#8196AA"))
                    }
                    is SymbolLayer -> if (id.contains("road") || id.contains("street") ||
                            id.contains("place") || id.contains("city") || id.contains("town")) {
                        layer.setProperties(PropertyFactory.textColor("#E1EAF2"),
                            PropertyFactory.textHaloColor("#20303D"),
                            PropertyFactory.textHaloWidth(1.3f))
                    }
                }
            }
        }

        if (style.getLayer("atlas-building-footprints") == null) {
            val buildings = FillLayer("atlas-building-footprints", source.id)
                .withSourceLayer("building")
                .withProperties(
                    PropertyFactory.fillColor(
                        if (dark) (if (navigating) "#334556" else "#3D5161")
                        else (if (navigating) "#E0E5E7" else "#DBE2E1")),
                    PropertyFactory.fillOutlineColor(if (dark) "#617B8F" else "#B7C3CA"),
                    PropertyFactory.fillOpacity(if (navigating) 0.8f else 0.95f)
                )
            buildings.setMinZoom(13.0f)
            // Road strokes and labels must remain above the building polygons.
            val before = style.layers.firstOrNull {
                it is LineLayer && (it.id.contains("road", true) ||
                    it.id.contains("highway", true) || it.id.contains("transport", true))
            }?.id ?: style.layers.firstOrNull { it is SymbolLayer }?.id
            if (before != null) style.addLayerBelow(buildings, before)
            else style.addLayer(buildings)
        }
    }
}
