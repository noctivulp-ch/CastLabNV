package app.fedilab.castlab.screenshare

import android.Manifest
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

    override fun definition() = ModuleDefinition {
        Name("ExpoScreenShare")

        Events("onScreenShareStarted", "onScreenShareStopped", "onScreenShareError")

        AsyncFunction("requestScreenShare") { port: Int ->
            val activity = appContext.currentActivity
                ?: throw Exception("No current activity")

            pendingPort = port
            // Ask for RECORD_AUDIO first so the very first session can already
            // carry sound; the capture prompt follows either way, since a
            // denied microphone permission only means a video-only stream.
            requestAudioPermission {
                val mpManager = activity.getSystemService(Activity.MEDIA_PROJECTION_SERVICE)
                        as MediaProjectionManager
                val captureIntent = mpManager.createScreenCaptureIntent()
                activity.startActivityForResult(captureIntent, REQUEST_CODE)
            }
        }

        OnActivityResult { _, payload ->
            if (payload.requestCode != REQUEST_CODE) return@OnActivityResult

            if (payload.resultCode == Activity.RESULT_OK && payload.data != null) {
                try {
                    startService(payload.resultCode, payload.data!!, pendingPort)
                    isSharing = true
                    sendEvent("onScreenShareStarted", mapOf("port" to pendingPort))
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to start screen share: ${e.message}")
                    sendEvent("onScreenShareError", mapOf("error" to (e.message ?: "Unknown error")))
                }
            } else {
                sendEvent("onScreenShareError", mapOf("error" to "Permission denied"))
            }
        }

        AsyncFunction("stopScreenShare") {
            stopService()
            isSharing = false
            sendEvent("onScreenShareStopped", emptyMap<String, Any>())
        }

        Function("isScreenSharing") {
            isSharing
        }
    }

    /**
     * Requests RECORD_AUDIO and runs [next] once the user has answered, or
     * immediately when the permission is already granted or unavailable
     * (pre-Android 10, where playback capture does not exist).
     */
    private fun requestAudioPermission(next: () -> Unit) {
        val permissions = appContext.permissions
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || permissions == null) {
            next()
            return
        }
        try {
            permissions.askForPermissions(
                { next() },
                Manifest.permission.RECORD_AUDIO
            )
        } catch (e: Exception) {
            Log.w(TAG, "Could not request RECORD_AUDIO: ${e.message}")
            next()
        }
    }

    private fun startService(resultCode: Int, data: Intent, port: Int) {
        val context = appContext.reactContext ?: throw Exception("No React context")
        val intent = Intent(context, ScreenCaptureService::class.java).apply {
            action = ScreenCaptureService.ACTION_START
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
        context.startService(intent)
    }

    companion object {
        private const val TAG = "ScreenShareModule"
        private const val REQUEST_CODE = 10011
    }
}
