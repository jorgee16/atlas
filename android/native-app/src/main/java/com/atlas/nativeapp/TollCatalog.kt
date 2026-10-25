package com.atlas.nativeapp

import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID

internal data class TollCatalog(val country:String,val currency:String,val year:Int,val revision:Long,
    val source:String,val fractionDigits:Int,val classes:List<Int>,val csv:ByteArray,val origin:String) {
    val sha256:String get()=digest(csv)
    companion object {
        const val MAX_BYTES=2*1024*1024
        fun digest(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        fun parse(country:String,bytes:ByteArray,origin:String):TollCatalog {
            require(TollTableAssets.safeCountry(country) && bytes.size in 1..MAX_BYTES)
            val text=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString()
            val metadata=linkedMapOf<String,String>();val rows=mutableListOf<List<String>>()
            for(raw in text.lineSequence()) {
                val line=raw.trim();if(line.isEmpty())continue
                if(line.startsWith("#")) {
                    val at=line.indexOf('=')
                    if(at>0)require(metadata.put(line.substring(1,at).trim(),line.substring(at+1).trim())==null)
                } else rows.add(line.split(';').map { it.trim() })
            }
            require(metadata["country"]==country) { "Tariff country mismatch" }
            val currency=metadata["currency"].orEmpty();require(currency.matches(Regex("[A-Z]{3}")))
            val year=metadata["year"]?.takeIf { it.matches(Regex("[0-9]{4}")) }?.toInt() ?: error("Missing tariff year")
            val revision=metadata["version"]?.let {
                require(it.matches(Regex("[1-9][0-9]{0,15}")));it.toLong()
            } ?: 0L
            val source=metadata["source"].orEmpty();require(source.startsWith("https://") && source.length<=2048)
            require(metadata["scheme"]==null || metadata["scheme"]=="road-average")
            val digits=metadata["fractionDigits"]?.let { require(it.matches(Regex("[0-3]")));it.toInt() } ?: 2
            require(rows.size in 2..30001 && rows.first().take(3)==listOf("road","section","km"))
            val columns=rows.first().drop(3)
            require(columns.size in 1..32 && columns.all { it.matches(Regex("class[1-9][0-9]?")) })
            val classes=columns.map { it.removePrefix("class").toInt() };require(classes.toSet().size==classes.size)
            val identities=hashSetOf<Pair<String,String>>();val roads=hashSetOf<String>()
            for(row in rows.drop(1)) {
                require(row.size==3+classes.size && row[0].isNotBlank() && row[1].isNotBlank())
                val road=row[0].replace(Regex("\\s+"),"").uppercase(Locale.ROOT);roads.add(road)
                require(identities.add(road to row[1])) { "Duplicate tariff section" }
                for((index,value) in row.drop(2).withIndex()) {
                    require(value.matches(Regex("[0-9]+(?:\\.[0-9]+)?")))
                    val n=value.toDouble();require(n.isFinite() && n>=0 && n<=1e9 && (index!=0 || n>0))
                }
            }
            metadata["estimateRoads"]?.split(',')?.filter { it.isNotBlank() }?.forEach {
                require(it.replace(Regex("\\s+"),"").uppercase(Locale.ROOT) in roads)
            }
            return TollCatalog(country,currency,year,revision,source,digits,classes,bytes.copyOf(),origin)
        }
    }
}
internal interface CountryTollProvider { fun load(country:String):TollCatalog? }

/** Immutable table versions, atomic pointer, persistent rollback rejection.
 * Data updates never replace graph files or mutate an existing route. */
internal class TollCatalogRepository(private val root:File,private val bundledReader:(String)->ByteArray?,
    private val nativeValidator:(String,ByteArray)->Unit={_,_->}):CountryTollProvider {
    init { require(root.mkdirs() || root.isDirectory) }
    private fun directory(country:String):File {
        require(TollTableAssets.safeCountry(country));return File(root,country)
    }
    private fun bundled(country:String):TollCatalog?=try {
        bundledReader(country)?.let { TollCatalog.parse(country,it,"bundled") }
    } catch(_:Exception){null}
    private fun cached(country:String,version:Long):TollCatalog?=try {
        val folder=File(directory(country),version.toString())
        if(File(folder,"disabled").exists())null else {
            val file=File(folder,"table.csv");require(file.length() in 1..TollCatalog.MAX_BYTES.toLong())
            val catalog=TollCatalog.parse(country,file.readBytes(),"cache")
            val manifestFile=File(folder,"manifest.json");require(manifestFile.length() in 1..65536)
            verify(JSONObject(manifestFile.readText()),catalog);require(catalog.revision==version);catalog
        }
    } catch(_:Exception){null}
    private fun versions(country:String)=directory(country).listFiles().orEmpty()
        .filter { it.isDirectory && it.name.matches(Regex("[1-9][0-9]{0,15}")) }
        .map { it.name.toLong() }.sortedDescending()
    private fun active(country:String):JSONObject?=try {
        val file=File(directory(country),"active.json");require(file.length() in 1..4096);JSONObject(file.readText())
    } catch(_:Exception){null}
    @Synchronized override fun load(country:String):TollCatalog? {
        if(!TollTableAssets.safeCountry(country))return null
        val fallback=bundled(country);val pointer=active(country)
        val candidates=listOfNotNull(pointer?.optLong("active"),pointer?.optLong("previous"))+versions(country)
        for(version in candidates.distinct()) {
            val candidate=cached(country,version) ?: continue
            return if(fallback!=null && fallback.revision>candidate.revision)fallback else candidate
        }
        return fallback
    }
    private fun verify(manifest:JSONObject,catalog:TollCatalog) {
        require(manifest.getInt("schemaVersion")==1 && manifest.getString("country")==catalog.country)
        require(manifest.getLong("revision")==catalog.revision && catalog.revision>0)
        require(manifest.getLong("sizeBytes")==catalog.csv.size.toLong())
        require(manifest.getString("sha256").matches(Regex("[0-9a-fA-F]{64}")))
        require(manifest.getString("sha256").equals(catalog.sha256,true)) { "Tariff SHA-256 mismatch" }
        require(manifest.getString("currency")==catalog.currency && manifest.getInt("year")==catalog.year)
        require(manifest.getInt("fractionDigits")==catalog.fractionDigits)
        val ids=manifest.getJSONArray("vehicleClasses")
        require((0 until ids.length()).map { ids.getInt(it) }==catalog.classes)
    }
    private fun durable(file:File,bytes:ByteArray) { FileOutputStream(file).use { it.write(bytes);it.fd.sync() } }
    private fun activate(country:String,version:Long,previous:Long) {
        val dir=directory(country).apply { mkdirs() };val next=File(dir,".active-"+UUID.randomUUID())
        try {
            durable(next,JSONObject().put("active",version).put("previous",previous).toString().toByteArray())
            check(next.renameTo(File(dir,"active.json"))) { "Could not activate toll catalog" }
        } finally { next.delete() }
    }
    @Synchronized fun install(country:String,manifest:JSONObject,bytes:ByteArray):TollCatalog {
        val candidate=TollCatalog.parse(country,bytes,"cache");verify(manifest,candidate)
        nativeValidator(country,bytes)
        val before=load(country)
        if(before?.revision==candidate.revision) {
            require(before.sha256==candidate.sha256) { "Immutable version collision" }
            return before
        }
        val highest=maxOf(bundled(country)?.revision ?: 0,versions(country).firstOrNull() ?: 0)
        require(candidate.revision>=highest) { "Tariff rollback/replay rejected" }
        val target=File(directory(country),candidate.revision.toString())
        if(target.exists()) {
            require(!File(target,"disabled").exists()) { "Rolled-back version; require a newer revision" }
            require(cached(country,candidate.revision)?.sha256==candidate.sha256) { "Immutable version collision" }
        } else {
            require(candidate.revision>highest)
            val dir=directory(country).apply { mkdirs() }
            val staging=File(dir,".staging-"+UUID.randomUUID()).apply { check(mkdir()) }
            try {
                durable(File(staging,"table.csv"),bytes)
                durable(File(staging,"manifest.json"),manifest.toString().toByteArray())
                check(staging.renameTo(target)) { "Could not commit toll data" }
            } finally { staging.deleteRecursively() }
        }
        activate(country,candidate.revision,before?.revision ?: 0);return candidate
    }
    @Synchronized fun canRollback(country:String):Boolean {
        val current=load(country) ?: return false
        return current.origin=="cache" && (versions(country).any { it<current.revision && cached(country,it)!=null } ||
            (bundled(country)?.revision ?: Long.MAX_VALUE)<current.revision)
    }
    @Synchronized fun rollback(country:String):TollCatalog {
        val current=load(country) ?: error("No tariff catalog");require(current.origin=="cache")
        val previous=versions(country).filter { it<current.revision }.firstNotNullOfOrNull { cached(country,it) }
            ?: bundled(country)?.takeIf { it.revision<current.revision } ?: error("No previous valid tariffs")
        durable(File(File(directory(country),current.revision.toString()),"disabled"),byteArrayOf(1))
        activate(country,previous.revision,0);return previous
    }
}

