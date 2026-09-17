package app.fedilab.castlab.screenshare

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log

/**
 * Brings the app forward and asks it to start screen sharing.
 */
class ScreenShareTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        qsTile?.apply {
            state = if (ScreenCaptureService.running) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            updateTile()
        }
    }

    override fun onClick() {
        super.onClick()

        // MediaProjection consent needs an activity
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            putExtra(EXTRA_START_SCREEN_SHARE, true)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }

        if (launch == null) {
            Log.w(TAG, "No launch intent for $packageName")
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // The intent form throws from Android 14 onwards
            val pending = PendingIntent.getActivity(
                this, 0, launch,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            startActivityAndCollapse(pending)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(launch)
        }
    }

    companion object {
        private const val TAG = "ScreenShareTile"
        const val EXTRA_START_SCREEN_SHARE = "app.fedilab.castlab.START_SCREEN_SHARE"
    }
}
