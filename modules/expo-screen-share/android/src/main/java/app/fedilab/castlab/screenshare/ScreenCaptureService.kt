package app.fedilab.castlab.screenshare

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log

/**
 * Foreground service for screen capture via MediaProjection.
 * Required on Android 10+ for persistent screen capture.
 */
class ScreenCaptureService : Service() {
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var encoder: ScreenEncoder? = null
    private var audioEncoder: AudioEncoder? = null
    private var httpServer: StreamHttpServer? = null
    private var audioOnly = false

    @Volatile
    private var active = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START, ACTION_START_AUDIO -> {
                audioOnly = intent.action == ACTION_START_AUDIO
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, -1)
                val data = intent.getParcelableExtra<Intent>(EXTRA_DATA) ?: return START_NOT_STICKY
                val port = intent.getIntExtra(EXTRA_PORT, 9126)

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(
                        NOTIFICATION_ID,
                        buildNotification(),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                    )
                } else {
                    startForeground(NOTIFICATION_ID, buildNotification())
                }
                startCapture(resultCode, data, port)
            }
            ACTION_STOP -> {
                stopCapture()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun startCapture(resultCode: Int, data: Intent, port: Int) {
        val mpManager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = mpManager.getMediaProjection(resultCode, data)

        // Android 14+ requires a callback registered before createVirtualDisplay
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            mediaProjection!!.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    Log.i(TAG, "MediaProjection stopped by system")
                    stopCapture()
                }
            }, Handler(Looper.getMainLooper()))
        }

        if (audioOnly) {
            startAudioCapture(port)
            return
        }

        val metrics = resources.displayMetrics
        // Scale down to half resolution (must be even)
        val width = (metrics.widthPixels / 2) and 0x7FFFFFFE.toInt()
        val height = (metrics.heightPixels / 2) and 0x7FFFFFFE.toInt()
        val density = metrics.densityDpi

        // Init encoder
        encoder = ScreenEncoder(width, height)
        encoder!!.init()

        // Init HTTP server
        httpServer = StreamHttpServer(port)
        httpServer!!.start()

        // Wire encoder output to HTTP server
        encoder!!.setOutputCallback { tsPackets ->
            httpServer!!.pushData(tsPackets)
        }

        // A joining client needs a keyframe before it can decode anything
        httpServer!!.onClientConnected = {
            encoder?.requestKeyFrame()
        }

        // Create virtual display with encoder's input surface
        virtualDisplay = mediaProjection!!.createVirtualDisplay(
            "CastLabScreenShare",
            width, height, density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            encoder!!.inputSurface,
            null, null
        )

        encoder!!.start()
        active = true
        running = true
        Log.i(TAG, "Screen capture started: ${width}x${height} on port $port")
    }

    /**
     * Stream system playback audio without mirroring the display
     */
    private fun startAudioCapture(port: Int) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            Log.e(TAG, "Audio capture needs Android 10")
            stopSelf()
            return
        }

        audioEncoder = AudioEncoder(mediaProjection!!)
        audioEncoder!!.init()

        httpServer = StreamHttpServer(port)
        httpServer!!.start()

        audioEncoder!!.setOutputCallback { frames ->
            httpServer!!.pushData(frames)
        }

        audioEncoder!!.setSilenceCallback {
            onSilenceDetected?.invoke()
        }

        audioEncoder!!.start()
        active = true
        running = true
        Log.i(TAG, "Audio capture started on port $port")
    }

    private fun stopCapture() {
        active = false
        running = false
        audioEncoder?.stop()
        audioEncoder = null
        encoder?.stop()
        virtualDisplay?.release()
        mediaProjection?.stop()
        httpServer?.stop()
        encoder = null
        virtualDisplay = null
        mediaProjection = null
        httpServer = null
        Log.i(TAG, "Screen capture stopped")
    }

    fun isActive(): Boolean = active

    override fun onDestroy() {
        stopCapture()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Screen Share",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Screen sharing is active"
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val appIcon = applicationInfo.icon
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("CastLab")
                .setContentText("Screen sharing is active")
                .setSmallIcon(appIcon)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("CastLab")
                .setContentText("Screen sharing is active")
                .setSmallIcon(appIcon)
                .build()
        }
    }

    companion object {
        @Volatile
        var running = false
        var onSilenceDetected: (() -> Unit)? = null

        private const val TAG = "ScreenCaptureService"
        private const val NOTIFICATION_ID = 2001
        private const val CHANNEL_ID = "screen_share_channel"
        const val ACTION_START = "app.fedilab.castlab.screenshare.START"
        const val ACTION_START_AUDIO = "app.fedilab.castlab.screenshare.START_AUDIO"
        const val ACTION_STOP = "app.fedilab.castlab.screenshare.STOP"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_DATA = "data"
        const val EXTRA_PORT = "port"
    }
}
