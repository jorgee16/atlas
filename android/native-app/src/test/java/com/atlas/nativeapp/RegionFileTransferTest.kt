package com.atlas.nativeapp

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URL
import java.security.MessageDigest
import kotlin.concurrent.thread
import kotlin.io.path.createTempDirectory

class RegionFileTransferTest {
    private val bytes = ByteArray(8192) { (it % 251).toByte() }
    private val sum = MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString("") { "%02x".format(it) }

    private fun withServer(rangeSupported: Boolean, action: (URL) -> Unit) {
        // ServerSocket is part of the ordinary JVM/Android boot classpath,
        // unlike the optional jdk.httpserver module.
        val socket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        val worker = thread(isDaemon=true) {
            socket.accept().use { client ->
                client.soTimeout = 10_000
                val input = client.getInputStream().bufferedReader(Charsets.ISO_8859_1)
                var offset = 0
                var requested: String? = null
                while (true) {
                    val line = input.readLine() ?: break
                    if (line.isEmpty()) break
                    if (line.startsWith("Range:", true)) requested=line.substringAfter(':').trim()
                }
                if (rangeSupported && requested?.startsWith("bytes=") == true) {
                    offset=requested.removePrefix("bytes=").removeSuffix("-").toInt()
                }
                val count = bytes.size - offset
                val code = if(offset>0) "206 Partial Content" else "200 OK"
                val extra = if(offset>0)
                    "Content-Range: bytes $offset-${bytes.size-1}/${bytes.size}\r\n" else ""
                val headers = "HTTP/1.1 $code\r\n" +
                    "Content-Type: application/octet-stream\r\n" +
                    "Content-Length: $count\r\n" +
                    extra + "Connection: close\r\n\r\n"
                client.getOutputStream().use { out ->
                    out.write(headers.toByteArray(Charsets.ISO_8859_1))
                    out.write(bytes, offset, count)
                    out.flush()
                }
            }
        }
        try { action(URL("http://127.0.0.1:${socket.localPort}/map")) }
        finally { socket.close(); worker.join(1_000) }
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
