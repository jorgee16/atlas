package com.atlas.nativeapp

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import android.widget.ImageView
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/** Optional itinerary images; bounded requests, bounded cache and a local icon fallback. */
object PlaceImages {
    private val permits=Semaphore(4)
    private val cache=object:LruCache<String,Bitmap>(8*1024){override fun sizeOf(key:String,value:Bitmap)=value.byteCount/1024}
    fun load(owner:LifecycleOwner,url:String,target:ImageView){
        if(!url.startsWith("https://"))return
        cache.get(url)?.let{target.setImageBitmap(it);return}
        owner.lifecycleScope.launch {
            val bitmap=withContext(Dispatchers.IO){permits.withPermit{
                try{
                    val connection=URL(url).openConnection() as HttpURLConnection
                    connection.connectTimeout=8000;connection.readTimeout=10000
                    try{
                        if(connection.responseCode !in 200..299)return@withPermit null
                        val output=java.io.ByteArrayOutputStream()
                        connection.inputStream.use{input->val buffer=ByteArray(8192);while(output.size()<=4*1024*1024){val n=input.read(buffer);if(n<0)break;output.write(buffer,0,n)}}
                        if(output.size()>4*1024*1024)return@withPermit null
                        val bytes=output.toByteArray()
                        val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true}
                        BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
                        val options=BitmapFactory.Options().apply{inSampleSize=maxOf(1,maxOf(bounds.outWidth,bounds.outHeight)/256)}
                        BitmapFactory.decodeByteArray(bytes,0,bytes.size,options)?.also{cache.put(url,it)}
                    }finally{connection.disconnect()}
                }catch(_:Exception){null}
            }}
            if(bitmap!=null)target.setImageBitmap(bitmap)
        }
    }
}
