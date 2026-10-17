package com.atlas.nativeapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CancellationException

/**
 * Persisted, user-initiated region transfer. WorkManager reschedules after
 * process death; RegionStore retains verified bytes for a later HTTP Range.
 */
class RegionDownloadWorker(context: Context, parameters: WorkerParameters) :
    CoroutineWorker(context, parameters) {
    companion object {
        const val KEY_REGION = "region"
        const val KEY_VERSION = "version"
        const val KEY_PERCENT = "percent"
        fun uniqueName(region: String) = "atlas-region:$region"
        private const val CHANNEL = "atlas-region-transfers"
    }
    override suspend fun doWork(): Result {
        val id=inputData.getString(KEY_REGION) ?: return Result.failure()
        val version=inputData.getInt(KEY_VERSION,-1)
        val store=RegionStore(applicationContext)
        val region=store.regions.firstOrNull { it.id==id && it.version==version }
            ?: return Result.failure(workDataOf("error" to "Region catalog changed; refresh and retry"))
        var last=-1
        return try {
            setForeground(buildForeground(id,0))
            store.install(region) { bytes,total ->
                val pct=if(total>0) (100*bytes/total).toInt().coerceIn(0,100) else 0
                if(pct!=last) {
                    last=pct
                    setProgressAsync(workDataOf(KEY_PERCENT to pct))
                }
            }
            Result.success(workDataOf(KEY_PERCENT to 100))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (runAttemptCount<2 && !isStopped) Result.retry()
            else Result.failure(workDataOf("error" to (e.message ?: "Region download failed")))
        }
    }
    private fun buildForeground(id:String,percent:Int): ForegroundInfo {
        val manager=applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(
            CHANNEL,"Atlas offline downloads", NotificationManager.IMPORTANCE_LOW))
        val intent=PendingIntent.getActivity(applicationContext,350,
            Intent(applicationContext,MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification=Notification.Builder(applicationContext,CHANNEL)
            .setSmallIcon(applicationContext.applicationInfo.icon)
            .setContentTitle("Downloading ${id.replaceFirstChar { it.uppercase() }}")
            .setContentText("Offline map, routing and search · tap for details")
            .setOngoing(true)
            .setProgress(100,percent,true)
            .setContentIntent(intent)
            .build()
        return ForegroundInfo(350,notification,
            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    }
}
