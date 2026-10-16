package com.atlas.nativeapp

import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress
import java.net.URL
import java.security.MessageDigest
import kotlin.io.path.createTempDirectory

class RegionFileTransferTest {
    private val bytes = ByteArray(8192) { (it % 251).toByte() }
    private val sum = MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString("") { "%02x".format(it) }

    private fun withServer(rangeSupported: Boolean, action: (URL) -> Unit) {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        server.createContext("/map") { exchange ->
            val header = exchange.requestHeaders.getFirst("Range")
            val offset = if (rangeSupported && header?.startsWith("bytes=") == true)
                header.removePrefix("bytes=").removeSuffix("-").toInt() else 0
            val count = bytes.size - offset
            if (offset != 0) {
                exchange.responseHeaders.add("Content-Range","bytes $offset-${bytes.size-1}/${bytes.size}")
            }
            exchange.sendResponseHeaders(if(offset == 0) 200 else 206,count.toLong())
            exchange.responseBody.use { it.write(bytes, offset, count) }
        }
        server.start()
        try { action(URL("http://127.0.0.1:${server.address.port}/map")) }
        finally { server.stop(0) }
    }

    @Test fun continueFromExistingBytesWithHttpRange() = withServer(true) { url ->
        val dir=createTempDirectory("atlas-resume").toFile()
        try {
            val file=File(dir,"map.pmtiles")
            file.writeBytes(bytes.copyOfRange(0,2200))
            var progressed=0L
            runBlocking { RegionFileTransfer.fetch(url,file,bytes.size.toLong(),sum){progressed+=it} }
            assertArrayEquals(bytes,file.readBytes())
            assertEquals(bytes.size.toLong(),progressed)
        } finally { dir.deleteRecursively() }
    }

    @Test fun serverIgnoringRangeRestartsWithoutDuplicatingBytes() = withServer(false) { url ->
        val dir=createTempDirectory("atlas-range-ignored").toFile()
        try {
            val file=File(dir,"map.pmtiles")
            file.writeBytes(bytes.copyOfRange(0,1600))
            var progressed=0L
            runBlocking { RegionFileTransfer.fetch(url,file,bytes.size.toLong(),sum){progressed+=it} }
            assertArrayEquals(bytes,file.readBytes())
            assertEquals(bytes.size.toLong(),progressed)
        } finally { dir.deleteRecursively() }
    }

    @Test fun completeVerifiedFileSkipsNetwork() {
        val dir=createTempDirectory("atlas-cache").toFile()
        try {
            val file=File(dir,"map.pmtiles").apply { writeBytes(bytes) }
            var progressed=0L
            runBlocking {
                RegionFileTransfer.fetch(URL("http://127.0.0.1:1/unavailable"),
                    file,bytes.size.toLong(),sum){progressed+=it}
            }
            assertEquals(bytes.size.toLong(),progressed)
        } finally {dir.deleteRecursively()}
    }
}
