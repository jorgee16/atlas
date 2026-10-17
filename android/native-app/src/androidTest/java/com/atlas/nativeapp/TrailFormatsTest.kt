package com.atlas.nativeapp

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(AndroidJUnit4::class)
class TrailFormatsTest {
    private val store get() = TrailStore(InstrumentationRegistry.getInstrumentation().targetContext)

    private val kml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <kml xmlns="http://www.opengis.net/kml/2.2"><Document>
          <Placemark><name>Coastal walk</name><LineString><coordinates>
            -9.1,38.7,12 -9.11,38.71,30 -9.12,38.72,15
          </coordinates></LineString></Placemark>
        </Document></kml>
    """.trimIndent()

    @Test fun kmlSupportsNameDistanceAndElevation() {
        val trail = store.preview(ByteArrayInputStream(kml.toByteArray()), "walk.KML")
        assertEquals("KML", trail.format)
        assertEquals("Coastal walk", trail.name)
        assertEquals(3, trail.points.size)
        assertTrue(trail.distanceMeters > 1000)
        assertEquals(18.0, trail.ascentMeters, 0.01)
        assertEquals(15.0, trail.descentMeters, 0.01)
    }

    @Test fun kmzImportsEmbeddedKmlWithoutExtractingResources() {
        val zipped = ByteArrayOutputStream()
        ZipOutputStream(zipped).use { zip ->
            zip.putNextEntry(ZipEntry("files/photo.jpg"))
            zip.write(byteArrayOf(1, 2, 3))
            zip.closeEntry()
            zip.putNextEntry(ZipEntry("doc.kml"))
            zip.write(kml.toByteArray())
            zip.closeEntry()
        }
        val trail = store.preview(ByteArrayInputStream(zipped.toByteArray()), "path.kmz")
        assertEquals("KMZ", trail.format)
        assertEquals(3, trail.points.size)
    }

    @Test fun geoJsonSupportsFeatureCollection() {
        val json = """
          {"type":"FeatureCollection","features":[
            {"type":"Feature","properties":{"name":"River route"},
             "geometry":{"type":"LineString","coordinates":[[-9.1,38.7,10],[-9.2,38.8,14]]}}
          ]}
        """.trimIndent()
        val trail = store.preview(ByteArrayInputStream(json.toByteArray()), "example.geojson")
        assertEquals("GeoJSON", trail.format)
        assertEquals("River route", trail.name)
        assertEquals(2, trail.points.size)
    }

    @Test fun oldGpxRemainsReadableAndFormatPersists() {
        val gpx = """
          <gpx><trk><name>My route</name><trkseg>
            <trkpt lat="38.7" lon="-9.1"><ele>10</ele></trkpt>
            <trkpt lat="38.8" lon="-9.2"><ele>20</ele></trkpt>
          </trkseg></trk></gpx>
        """.trimIndent()
        val saved = store.save(store.preview(ByteArrayInputStream(gpx.toByteArray()), "route.gpx"))
        try {
            assertEquals("GPX", saved.format)
            assertEquals("GPX", store.all().first { it.id == saved.id }.format)
        } finally { store.remove(saved.id) }
    }

    @Test fun rejectsMaliciousXmlAndUnsupportedFiles() {
        val xml = "<!DOCTYPE x [<!ENTITY bad SYSTEM \"file:///etc/passwd\">]><gpx/>"
        assertThrows(IllegalArgumentException::class.java) {
            store.preview(ByteArrayInputStream(xml.toByteArray()), "evil.gpx")
        }
        assertThrows(IllegalArgumentException::class.java) {
            store.preview(ByteArrayInputStream(byteArrayOf(1)), "example.fit")
        }
    }
}
