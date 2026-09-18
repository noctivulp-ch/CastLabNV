package app.fedilab.castlab.screenshare

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo Module exposing screen sharing capabilities to JavaScript.
 * Handles MediaProjection permission and foreground service lifecycle.
 */
class ScreenShareModule : Module() {
    private var pendingPort = 9126
    private var isSharing = false
    private var pendingAudioOnly = false

    override fun definition() = ModuleDefinition {
        Name("ExpoScreenShare")

        Events("onScreenShareStarted", "onScreenShareStopped", "onScreenShareError", "onAudioSilence", "onTileRequest")

        AsyncFunction("requestScreenShare") { port: Int ->
            requestCapture(port, false)
        }

        AsyncFunction("requestAudioShare") { port: Int ->
            requestCapture(port, true)
        }

        OnActivityResult { _, payload ->
            if (payload.requestCode != REQUEST_CODE) return@OnActivityResult

            if (payload.resultCode == Activity.RESULT_OK && payload.data != null) {
                try {
                    ScreenCaptureService.onSilenceDetected = {
                        sendEvent("onAudioSilence", emptyMap<String, Any>())
                    }
                    // Started fires when capture is really running
                    ScreenCaptureService.onCaptureStarted = {
                        isSharing = true
                        sendEvent("onScreenShareStarted", mapOf("port" to pendingPort, "audioOnly" to pendingAudioOnly))
                    }
                    ScreenCaptureService.onCaptureStopped = { wasAudioOnly ->
                        isSharing = false
                        sendEvent("onScreenShareStopped", mapOf("audioOnly" to wasAudioOnly))
                    }
                    ScreenCaptureService.onCaptureError = { message ->
                        isSharing = false
                        sendEvent("onScreenShareError", mapOf("error" to message))
                    }
                    startService(payload.resultCode, payload.data!!, pendingPort, pendingAudioOnly)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to start screen share: ${e.message}")
                    sendEvent("onScreenShareError", mapOf("error" to (e.message ?: "Unknown error")))
                }
            } else {
                sendEvent("onScreenShareError", mapOf("error" to "Permission denied"))
            }
        }

        /**
         * False unless the app was brought forward by the Quick Settings tile
         */
        AsyncFunction("consumeTileRequest") {
            val intent = appContext.currentActivity?.intent
            val requested = intent?.getBooleanExtra(ScreenShareTileService.EXTRA_START_SCREEN_SHARE, false) ?: false
            if (requested) intent?.removeExtra(ScreenShareTileService.EXTRA_START_SCREEN_SHARE)
            requested
        }

        OnNewIntent { intent ->
            if (intent.getBooleanExtra(ScreenShareTileService.EXTRA_START_SCREEN_SHARE, false)) {
                intent.removeExtra(ScreenShareTileService.EXTRA_START_SCREEN_SHARE)
                sendEvent("onTileRequest", emptyMap<String, Any>())
            }
        }

        AsyncFunction("stopScreenShare") {
            ScreenCaptureService.onSilenceDetected = null
            ScreenCaptureService.onCaptureStarted = null
            ScreenCaptureService.onCaptureStopped = null
            ScreenCaptureService.onCaptureError = null
            stopService()
            isSharing = false
            sendEvent("onScreenShareStopped", mapOf("audioOnly" to pendingAudioOnly))
        }

        Function("isScreenSharing") {
            isSharing
        }
    }

    /**
     * The mode is applied once the user accepts the MediaProjection prompt
     */
    private fun requestCapture(port: Int, audioOnly: Boolean) {
        val activity = appContext.currentActivity ?: throw Exception("No current activity")
        if (audioOnly && Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            throw Exception("Audio capture requires Android 10 or later")
        }

        pendingPort = port
        pendingAudioOnly = audioOnly
        val mpManager = activity.getSystemService(Activity.MEDIA_PROJECTION_SERVICE)
                as MediaProjectionManager
        activity.startActivityForResult(mpManager.createScreenCaptureIntent(), REQUEST_CODE)
    }

    private fun startService(resultCode: Int, data: Intent, port: Int, audioOnly: Boolean) {
        val context = appContext.reactContext ?: throw Exception("No React context")
        val intent = Intent(context, ScreenCaptureService::class.java).apply {
            action = if (audioOnly) ScreenCaptureService.ACTION_START_AUDIO
            else ScreenCaptureService.ACTION_START
            putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
            putExtra(ScreenCaptureService.EXTRA_DATA, data)
            putExtra(ScreenCaptureService.EXTRA_PORT, port)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    private fun stopService() {
        val context = appContext.reactContext ?: return
        val intent = Intent(context, ScreenCaptureService::class.java).apply {
            action = ScreenCaptureService.ACTION_STOP
        }
        try {
            context.startService(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop the capture service: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "ScreenShareModule"
        private const val REQUEST_CODE = 10011
    }
}
