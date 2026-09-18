package app.fedilab.castlab.screenshare

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log

/**
 * Brings the app forward to start sharing, and stops it without leaving the panel.
 */
class ScreenShareTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        refreshTile()
    }

    override fun onClick() {
        super.onClick()

        // Stopping needs no activity, the service is already running
        if (ScreenCaptureService.running) {
            startService(Intent(this, ScreenCaptureService::class.java).apply {
                action = ScreenCaptureService.ACTION_STOP
            })
            refreshTile()
            return
        }

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

    /**
     * Without a label the tile falls back to the manifest and shows no state
     */
    private fun refreshTile() {
        val sharing = ScreenCaptureService.running
        qsTile?.apply {
            state = if (sharing) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
            label = getString(R.string.screen_share_tile_label)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                subtitle = getString(
                    if (sharing) R.string.screen_share_tile_active
                    else R.string.screen_share_tile_idle
                )
            }
            updateTile()
        }
    }

    companion object {
        private const val TAG = "ScreenShareTile"
        const val EXTRA_START_SCREEN_SHARE = "app.fedilab.castlab.START_SCREEN_SHARE"
    }
}
