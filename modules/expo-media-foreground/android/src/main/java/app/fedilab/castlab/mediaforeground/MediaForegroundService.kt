package app.fedilab.castlab.mediaforeground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import java.net.URL

/**
 * Foreground service that keeps the app process alive while casting and owns the
 * casting notification. The mediaPlayback type exempts the process from the cached
 * app freezer and LowMemoryKiller, so the media HTTP server keeps serving in the
 * background. A MediaSession drives the system media player UI with a seek bar, and
 * its transport controls plus the notification actions are forwarded to JS via
 * MediaForegroundModule.
 */
class MediaForegroundService : Service() {

    private var title = "CastLab"
    private var text = "Casting in progress"
    private var isPlaying = false
    private var showControls = false
    private var playLabel = "Play"
    private var pauseLabel = "Pause"
    private var stopLabel = "Stop"
    private var prevLabel = "Previous"
    private var nextLabel = "Next"
    private var positionMs = 0L
    private var durationMs = 0L

    private var artworkUri = ""
    private var artwork: Bitmap? = null
    private var loadedArtworkUri = ""

    private var mediaSession: MediaSession? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        setupMediaSession()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START, ACTION_UPDATE -> {
                readExtras(intent)
                try {
                    updateSession()
                } catch (e: Exception) {
                    Log.w(TAG, "updateSession failed: ${e.message}")
                }
                postNotification()
                loadArtworkIfNeeded()
            }
            ACTION_STOP -> {
                releaseSession()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                Log.i(TAG, "Media foreground service stopped")
            }
            ACTION_CONTROL_PLAY -> dispatch("play")
            ACTION_CONTROL_PAUSE -> dispatch("pause")
            ACTION_CONTROL_STOP -> MediaForegroundModule.actionListener?.invoke("stop", 0L)
            ACTION_CONTROL_PREV -> MediaForegroundModule.actionListener?.invoke("previous", 0L)
            ACTION_CONTROL_NEXT -> MediaForegroundModule.actionListener?.invoke("next", 0L)
        }
        return START_NOT_STICKY
    }

    private fun dispatch(action: String) {
        MediaForegroundModule.actionListener?.invoke(action, 0L)
        isPlaying = action == "play"
        updateSession()
        postNotification()
    }

    private fun setupMediaSession() {
        mediaSession = MediaSession(this, "CastLab").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() = MediaForegroundModule.actionListener?.invoke("play", 0L) ?: Unit
                override fun onPause() = MediaForegroundModule.actionListener?.invoke("pause", 0L) ?: Unit
                override fun onStop() = MediaForegroundModule.actionListener?.invoke("stop", 0L) ?: Unit
                override fun onSkipToNext() = MediaForegroundModule.actionListener?.invoke("next", 0L) ?: Unit
                override fun onSkipToPrevious() = MediaForegroundModule.actionListener?.invoke("previous", 0L) ?: Unit
                override fun onSeekTo(pos: Long) {
                    MediaForegroundModule.actionListener?.invoke("seek", pos)
                }
            })
            isActive = true
        }
    }

    private fun releaseSession() {
        mediaSession?.isActive = false
        mediaSession?.release()
        mediaSession = null
    }

    private fun updateSession() {
        val session = mediaSession ?: return

        val metadata = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, text)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, title)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)
        artwork?.let { metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it) }
        session.setMetadata(metadata.build())

        val actions = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
            PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or
            PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_STOP or
            PlaybackState.ACTION_SEEK_TO
        val state = if (isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
        session.setPlaybackState(
            PlaybackState.Builder()
                .setActions(actions)
                .setState(state, positionMs, if (isPlaying) 1f else 0f)
                .build()
        )
    }

    private fun readExtras(intent: Intent) {
        title = intent.getStringExtra(EXTRA_TITLE) ?: title
        text = intent.getStringExtra(EXTRA_TEXT) ?: text
        isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, isPlaying)
        showControls = intent.getBooleanExtra(EXTRA_SHOW_CONTROLS, showControls)
        playLabel = intent.getStringExtra(EXTRA_PLAY_LABEL) ?: playLabel
        pauseLabel = intent.getStringExtra(EXTRA_PAUSE_LABEL) ?: pauseLabel
        stopLabel = intent.getStringExtra(EXTRA_STOP_LABEL) ?: stopLabel
        prevLabel = intent.getStringExtra(EXTRA_PREV_LABEL) ?: prevLabel
        nextLabel = intent.getStringExtra(EXTRA_NEXT_LABEL) ?: nextLabel
        positionMs = intent.getLongExtra(EXTRA_POSITION_MS, 0L)
        durationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0L)
        artworkUri = intent.getStringExtra(EXTRA_ARTWORK_URI) ?: ""
        if (artworkUri.isEmpty()) {
            artwork = null
            loadedArtworkUri = ""
        }
    }

    private fun postNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                buildNotification(),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } else {
            startForeground(NOTIFICATION_ID, buildNotification())
        }
    }

    /**
     * Loads the artwork off the main thread, then refreshes session and notification.
     */
    private fun loadArtworkIfNeeded() {
        val uri = artworkUri
        if (uri.isEmpty() || uri == loadedArtworkUri) return
        Thread {
            val bitmap = loadBitmap(uri)
            mainHandler.post {
                if (uri == artworkUri && bitmap != null) {
                    artwork = bitmap
                    loadedArtworkUri = uri
                    updateSession()
                    getSystemService(NotificationManager::class.java)
                        ?.notify(NOTIFICATION_ID, buildNotification())
                }
            }
        }.start()
    }

    private fun loadBitmap(uriStr: String): Bitmap? {
        return try {
            val raw = when {
                uriStr.startsWith("http") -> URL(uriStr).openStream().use { BitmapFactory.decodeStream(it) }
                uriStr.startsWith("content://") ->
                    contentResolver.openInputStream(Uri.parse(uriStr))?.use { BitmapFactory.decodeStream(it) }
                else -> BitmapFactory.decodeFile(Uri.parse(uriStr).path ?: uriStr)
            } ?: return null
            if (raw.width > MAX_ARTWORK_SIZE || raw.height > MAX_ARTWORK_SIZE) {
                val ratio = MAX_ARTWORK_SIZE.toFloat() / maxOf(raw.width, raw.height)
                Bitmap.createScaledBitmap(raw, (raw.width * ratio).toInt(), (raw.height * ratio).toInt(), true)
            } else {
                raw
            }
        } catch (e: Exception) {
            Log.w(TAG, "Artwork load failed: ${e.message}")
            null
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Casting",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps casting active in the background"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        builder.setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(smallIconRes())
            .setOngoing(true)
        buildContentIntent()?.let { builder.setContentIntent(it) }
        artwork?.let { builder.setLargeIcon(it) }

        if (showControls) {
            // Order: Previous, Play/Pause, Next, Stop
            builder.addAction(
                android.R.drawable.ic_media_previous, prevLabel,
                controlIntent(ACTION_CONTROL_PREV, REQ_PREV)
            )
            if (isPlaying) {
                builder.addAction(
                    android.R.drawable.ic_media_pause, pauseLabel,
                    controlIntent(ACTION_CONTROL_PAUSE, REQ_PAUSE)
                )
            } else {
                builder.addAction(
                    android.R.drawable.ic_media_play, playLabel,
                    controlIntent(ACTION_CONTROL_PLAY, REQ_PLAY)
                )
            }
            builder.addAction(
                android.R.drawable.ic_media_next, nextLabel,
                controlIntent(ACTION_CONTROL_NEXT, REQ_NEXT)
            )
            builder.addAction(
                android.R.drawable.ic_menu_close_clear_cancel, stopLabel,
                controlIntent(ACTION_CONTROL_STOP, REQ_STOP)
            )
            try {
                val style = Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2)
                mediaSession?.let { style.setMediaSession(it.sessionToken) }
                builder.style = style
            } catch (e: Exception) {
                Log.w(TAG, "MediaStyle failed, falling back to plain actions: ${e.message}")
            }
        }
        return builder.build()
    }

    private fun controlIntent(action: String, requestCode: Int): PendingIntent {
        val intent = Intent(this, MediaForegroundService::class.java).apply { this.action = action }
        return PendingIntent.getService(this, requestCode, intent, pendingFlags())
    }

    /**
     * Reopens the app when the notification body is tapped.
     */
    private fun buildContentIntent(): PendingIntent? {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
        return PendingIntent.getActivity(this, REQ_CONTENT, launchIntent, pendingFlags())
    }

    // Monochrome notification icon, falls back to the launcher icon
    private fun smallIconRes(): Int {
        val id = resources.getIdentifier("notification_icon", "drawable", packageName)
        return if (id != 0) id else applicationInfo.icon
    }

    private fun pendingFlags(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
    }

    override fun onDestroy() {
        releaseSession()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MediaForegroundService"
        private const val NOTIFICATION_ID = 3001
        private const val CHANNEL_ID = "casting_channel"
        private const val MAX_ARTWORK_SIZE = 512
        private const val REQ_CONTENT = 0
        private const val REQ_PLAY = 1
        private const val REQ_PAUSE = 2
        private const val REQ_STOP = 3
        private const val REQ_PREV = 4
        private const val REQ_NEXT = 5

        const val ACTION_START = "app.fedilab.castlab.mediaforeground.START"
        const val ACTION_UPDATE = "app.fedilab.castlab.mediaforeground.UPDATE"
        const val ACTION_STOP = "app.fedilab.castlab.mediaforeground.STOP"
        const val ACTION_CONTROL_PLAY = "app.fedilab.castlab.mediaforeground.CONTROL_PLAY"
        const val ACTION_CONTROL_PAUSE = "app.fedilab.castlab.mediaforeground.CONTROL_PAUSE"
        const val ACTION_CONTROL_STOP = "app.fedilab.castlab.mediaforeground.CONTROL_STOP"
        const val ACTION_CONTROL_PREV = "app.fedilab.castlab.mediaforeground.CONTROL_PREV"
        const val ACTION_CONTROL_NEXT = "app.fedilab.castlab.mediaforeground.CONTROL_NEXT"

        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
        const val EXTRA_IS_PLAYING = "isPlaying"
        const val EXTRA_SHOW_CONTROLS = "showControls"
        const val EXTRA_PLAY_LABEL = "playLabel"
        const val EXTRA_PAUSE_LABEL = "pauseLabel"
        const val EXTRA_STOP_LABEL = "stopLabel"
        const val EXTRA_PREV_LABEL = "prevLabel"
        const val EXTRA_NEXT_LABEL = "nextLabel"
        const val EXTRA_POSITION_MS = "positionMs"
        const val EXTRA_DURATION_MS = "durationMs"
        const val EXTRA_ARTWORK_URI = "artworkUri"
    }
}
