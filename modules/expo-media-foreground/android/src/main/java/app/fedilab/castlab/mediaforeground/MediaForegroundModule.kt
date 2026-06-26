package app.fedilab.castlab.mediaforeground

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * Options for the casting notification, passed as a single object from JS.
 */
class ForegroundOptions : Record {
    @Field var title: String = "CastLab"
    @Field var text: String = ""
    @Field var isPlaying: Boolean = false
    @Field var showControls: Boolean = false
    @Field var playLabel: String = "Play"
    @Field var pauseLabel: String = "Pause"
    @Field var stopLabel: String = "Stop"
    @Field var prevLabel: String = "Previous"
    @Field var nextLabel: String = "Next"
    @Field var positionMs: Double = 0.0
    @Field var durationMs: Double = 0.0
    @Field var artworkUri: String = ""
}

/**
 * Expo Module exposing the casting foreground service to JavaScript. Owns the single
 * casting notification and forwards its actions back to JS through onCastAction.
 */
class MediaForegroundModule : Module() {
    private var isActive = false

    override fun definition() = ModuleDefinition {
        Name("ExpoMediaForeground")

        Events("onCastAction")

        OnCreate {
            actionListener = { action, position ->
                sendEvent("onCastAction", mapOf("action" to action, "position" to position))
            }
        }

        OnDestroy {
            actionListener = null
        }

        AsyncFunction("startMediaForeground") { options: ForegroundOptions ->
            sendCommand(MediaForegroundService.ACTION_START, options, start = true)
            isActive = true
        }

        AsyncFunction("updateMediaForeground") { options: ForegroundOptions ->
            sendCommand(MediaForegroundService.ACTION_UPDATE, options, start = false)
        }

        AsyncFunction("stopMediaForeground") {
            val context = appContext.reactContext
            if (context != null) {
                val intent = Intent(context, MediaForegroundService::class.java).apply {
                    action = MediaForegroundService.ACTION_STOP
                }
                context.startService(intent)
            }
            isActive = false
        }

        Function("isMediaForegroundActive") {
            isActive
        }
    }

    private fun sendCommand(action: String, options: ForegroundOptions, start: Boolean) {
        val context = appContext.reactContext ?: throw Exception("No React context")
        val intent = Intent(context, MediaForegroundService::class.java).apply {
            this.action = action
            putExtra(MediaForegroundService.EXTRA_TITLE, options.title)
            putExtra(MediaForegroundService.EXTRA_TEXT, options.text)
            putExtra(MediaForegroundService.EXTRA_IS_PLAYING, options.isPlaying)
            putExtra(MediaForegroundService.EXTRA_SHOW_CONTROLS, options.showControls)
            putExtra(MediaForegroundService.EXTRA_PLAY_LABEL, options.playLabel)
            putExtra(MediaForegroundService.EXTRA_PAUSE_LABEL, options.pauseLabel)
            putExtra(MediaForegroundService.EXTRA_STOP_LABEL, options.stopLabel)
            putExtra(MediaForegroundService.EXTRA_PREV_LABEL, options.prevLabel)
            putExtra(MediaForegroundService.EXTRA_NEXT_LABEL, options.nextLabel)
            putExtra(MediaForegroundService.EXTRA_POSITION_MS, options.positionMs.toLong())
            putExtra(MediaForegroundService.EXTRA_DURATION_MS, options.durationMs.toLong())
            putExtra(MediaForegroundService.EXTRA_ARTWORK_URI, options.artworkUri)
        }
        if (start && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    companion object {
        /** Set while the module is alive so the service can forward notification actions to JS. */
        @Volatile
        var actionListener: ((String, Long) -> Unit)? = null
    }
}
