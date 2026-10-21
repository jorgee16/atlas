package com.atlas.nativeapp

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import java.util.Locale

/**
 * Keeps the native guidance engine supplied with GPS when MainActivity is stopped.
 * The user may stop guidance directly from the persistent notification.
 *
 * Navigation is process-local: after a force-stop or process death the user must
 * reopen Atlas and start guidance again. Process-death session restoration is a
 * separate acceptance requirement.
 */
class NavigationService : Service(), LocationListener {
    companion object {
        const val ACTION_START = "com.atlas.nativeapp.navigation.START"
        const val ACTION_STOP = "com.atlas.nativeapp.navigation.STOP"
        private const val CHANNEL = "atlas-navigation"
        private const val NOTIFICATION_ID = 3101
    }

    private val model: AtlasModel get() = (application as AtlasApplication).model
    private val locations by lazy { getSystemService(LOCATION_SERVICE) as LocationManager }
    private val handler = Handler(Looper.getMainLooper())
    private var reliableGpsTime = Double.NEGATIVE_INFINITY
    private var speech: TextToSpeech? = null
    private var speechReady = false
    private var running = false
    private val gapTick = object : Runnable {
        override fun run() {
            if (!model.updates.value.navigating) {
                stopSelf()
                return
            }
            model.predictSignalGap(SystemClock.elapsedRealtimeNanos() / 1e9)
            handler.postDelayed(this, 1_000L)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            model.endNavigation()
            stopSelf()
            return START_NOT_STICKY
        }
        if (!model.updates.value.navigating) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (running) return START_NOT_STICKY
        running = true
        createNotificationChannel()
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        speech = TextToSpeech(this) { result ->
            speechReady = result == TextToSpeech.SUCCESS
            if (speechReady) speech?.language = Locale.UK
        }
        model.speak = { text ->
            if (speechReady && model.voice) {
                speech?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "atlas-native-maneuver")
            }
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            try {
                for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                    if (locations.isProviderEnabled(provider)) {
                        locations.requestLocationUpdates(provider, 1_000L, 0f, this, Looper.getMainLooper())
                    }
                }
            } catch (_: SecurityException) {
                model.status("Atlas needs location permission to navigate in the background.")
            }
        } else {
            model.status("Allow location access before starting navigation.")
            stopSelf()
            return START_NOT_STICKY
        }
        handler.post(gapTick)
        return START_NOT_STICKY
    }

    override fun onLocationChanged(location: Location) {
        if (!model.updates.value.navigating) {
            stopSelf()
            return
        }
        val now = location.elapsedRealtimeNanos / 1e9
        val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble().coerceAtLeast(0.0) else 100.0
        if (location.provider == LocationManager.GPS_PROVIDER && accuracy <= 45.0) reliableGpsTime = now
        if (location.provider == LocationManager.NETWORK_PROVIDER && now - reliableGpsTime in 0.0..7.0) return
        model.fix(Fix(
            Coordinate(location.latitude, location.longitude),
            accuracy,
            if (location.hasSpeed()) location.speed.toDouble().coerceAtLeast(0.0) else -1.0,
            if (location.hasBearing()) location.bearing.toDouble() else null,
            now,
            if (location.hasBearing() && location.hasBearingAccuracy())
                location.bearingAccuracyDegrees.toDouble() else null,
            if (location.hasBearing()) location.bearing.toDouble() else null,
            provider=location.provider
        ))
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(
            CHANNEL, "Active Atlas navigation", NotificationManager.IMPORTANCE_LOW
        ).apply { description = "Continuous GPS guidance when Atlas is in the background" })
    }

    private fun buildNotification(): Notification {
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val open = PendingIntent.getActivity(this, 3101,
            Intent(this, MainActivity::class.java).addFlags(
                Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            ), flags)
        val stop = PendingIntent.getService(this, 3102,
            Intent(this, NavigationService::class.java).setAction(ACTION_STOP), flags)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("Atlas navigation")
            .setContentText("Navigation is active · tap to return to the map")
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "End navigation", stop).build())
            .setCategory(Notification.CATEGORY_NAVIGATION)
            .build()
    }

    override fun onDestroy() {
        handler.removeCallbacks(gapTick)
        if (running) locations.removeUpdates(this)
        model.speak = null
        speech?.stop()
        speech?.shutdown()
        running = false
        super.onDestroy()
    }
}

