package com.atlas.nativeapp

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLEncoder

internal class TollCatalogUpdater(private val repository:TollCatalogRepository,
    private val origin:String=RegionStore.ORIGIN,private val download:(String,Int)->ByteArray={ url,limit -> httpsDownload(url,limit) }) {
    fun update(country:String):TollCatalog {
        require(TollTableAssets.safeCountry(country))
        val base=URI(origin)
        require(base.scheme=="https" && !base.host.isNullOrBlank() && base.rawUserInfo==null && base.rawQuery==null && base.rawFragment==null && base.rawPath.orEmpty().isEmpty())
        val encoded=URLEncoder.encode(country,"UTF-8").replace("+","%20")
        val metadata=download("$origin/toll-tariffs/$encoded/manifest.json",64*1024)
        require(metadata.size in 1..64*1024)
        val manifest=JSONObject(String(metadata,Charsets.UTF_8))
        require(manifest.getInt("schemaVersion")==1 && manifest.getString("country")==country)
        val size=manifest.getInt("sizeBytes");require(size in 1..TollCatalog.MAX_BYTES)
        val revision=manifest.getLong("revision");require(revision>0)
        val path=manifest.getString("path")
        require(path=="/toll-tariffs/$encoded/$revision/table.csv") { "Unexpected tariff download path" }
        val url=base.resolve(path);require(url.scheme==base.scheme && url.rawAuthority==base.rawAuthority)
        val bytes=download(url.toASCIIString(),size);require(bytes.size==size)
        return repository.install(country,manifest,bytes)
    }
    companion object {
        private fun httpsDownload(url:String,limit:Int):ByteArray {
            val connection=URL(url).openConnection() as HttpURLConnection
            connection.instanceFollowRedirects=false;connection.connectTimeout=15000;connection.readTimeout=30000
            connection.setRequestProperty("User-Agent","Atlas-Toll-Catalog/1.0")
            try {
                check(connection.responseCode==200) { "Tariff download HTTP "+connection.responseCode }
                require(connection.contentLengthLong<=limit || connection.contentLengthLong<0)
                return connection.inputStream.use { input ->
                    val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
                    while(true) {
                        val count=input.read(buffer);if(count<0)break
                        require(out.size()+count<=limit) { "Tariff response too large" };out.write(buffer,0,count)
                    }
                    out.toByteArray()
                }
            } finally { connection.disconnect() }
        }
    }
}

