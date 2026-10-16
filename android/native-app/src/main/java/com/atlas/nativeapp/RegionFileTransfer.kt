package com.atlas.nativeapp

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Resumable, content-addressed offline region file transfer.
 * Existing staged bytes are hashed before appending. A server that ignores
 * Range is supported by restarting the file, never by appending the response.
 * Only the caller may activate the region after *every* file validates.
 */
internal object RegionFileTransfer {
    private fun sha(): MessageDigest = MessageDigest.getInstance("SHA-256")
    private fun MessageDigest.hex() = digest().joinToString("") { "%02x".format(it) }

    suspend fun fetch(
        url: URL,
        target: File,
        sizeBytes: Long,
        expectedSha256: String,
        onBytes: (Long) -> Unit
    ) {
        require(sizeBytes >= 0 && expectedSha256.matches(Regex("[0-9a-fA-F]{64}")))
        target.parentFile?.mkdirs()
        var existing = if (target.isFile) target.length() else 0L
        if (existing > sizeBytes) {
            target.delete()
            existing = 0L
        }
        var hash = sha()
        if (existing > 0) {
            FileInputStream(target).use { input ->
                val buffer = ByteArray(128 * 1024)
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val n = input.read(buffer)
                    if (n < 0) break
                    hash.update(buffer, 0, n)
                }
            }
            if (existing == sizeBytes) {
                if (hash.hex().equals(expectedSha256, ignoreCase = true)) {
                    onBytes(existing)
                    return
                }
                target.delete()
                existing = 0
                hash = sha()
            } else {
                onBytes(existing)
            }
        }
        val conn = url.openConnection() as HttpURLConnection
        conn.connectTimeout = 20_000
        conn.readTimeout = 30_000
        conn.setRequestProperty("Accept-Encoding", "identity")
        if (existing > 0) conn.setRequestProperty("Range", "bytes=$existing-")
        try {
            val code = conn.responseCode
            if (existing > 0 && code == HttpURLConnection.HTTP_OK) {
                // Source did not support Range; reset the cumulative progress and
                // restart rather than corrupting the partial local archive.
                onBytes(-existing)
                existing = 0L
                hash = sha()
            } else if (existing > 0 && code == HttpURLConnection.HTTP_PARTIAL) {
                val value = conn.getHeaderField("Content-Range") ?: ""
                val match = Regex("""bytes (\\d+)-(\\d+)/(\\d+)""").matchEntire(value)
                    ?: throw IOException("Missing or invalid HTTP Content-Range")
                val (start, end, total) = match.destructured
                if (start.toLong() != existing || end.toLong() < existing ||
                    total.toLong() != sizeBytes) {
                    throw IOException("Unexpected HTTP Content-Range")
                }
            } else if (code != HttpURLConnection.HTTP_OK) {
                throw IOException("Region download failed: HTTP $code")
            }
            var count = existing
            conn.inputStream.use { input ->
                FileOutputStream(target, existing > 0).use { output ->
                    val buffer = ByteArray(128 * 1024)
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val n = input.read(buffer)
                        if (n < 0) break
                        if (n == 0) continue
                        if (count + n > sizeBytes) throw IOException("Package file exceeds expected size")
                        output.write(buffer, 0, n)
                        hash.update(buffer, 0, n)
                        count += n
                        onBytes(n.toLong())
                    }
                    output.fd.sync()
                }
            }
            if (count != sizeBytes) throw IOException("Partial download saved for later retry: $count/$sizeBytes")
            if (!hash.hex().equals(expectedSha256, ignoreCase = true)) {
                target.delete()
                throw IOException("Region package checksum mismatch")
            }
        } finally {
            conn.disconnect()
        }
    }
}
