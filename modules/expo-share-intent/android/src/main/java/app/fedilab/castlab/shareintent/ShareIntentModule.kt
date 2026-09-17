package app.fedilab.castlab.shareintent

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Exposes media shared into the app through the Android share sheet.
 */
class ShareIntentModule : Module() {

    override fun definition() = ModuleDefinition {
        Name("ExpoShareIntent")

        Events("onShareIntent")

        /**
         * Empty on an ordinary launch
         */
        AsyncFunction("getPendingShare") {
            val intent = appContext.currentActivity?.intent ?: return@AsyncFunction emptyList<Map<String, Any?>>()
            val items = extractItems(intent)
            // Clearing the action stops the same share replaying
            if (items.isNotEmpty()) intent.action = null
            items
        }

        OnNewIntent { intent ->
            val items = extractItems(intent)
            if (items.isNotEmpty()) {
                intent.action = null
                sendEvent("onShareIntent", mapOf("items" to items))
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun extractItems(intent: Intent): List<Map<String, Any?>> {
        val uris: List<Uri> = when (intent.action) {
            Intent.ACTION_SEND ->
                listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
            Intent.ACTION_SEND_MULTIPLE ->
                intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()
            else -> emptyList()
        }
        if (uris.isNotEmpty()) return uris.map { describe(it) }

        // A shared link arrives as text with no stream attached
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim()
        if (intent.action == Intent.ACTION_SEND && !text.isNullOrEmpty()) {
            return listOf(mapOf("text" to text, "uri" to "", "name" to "", "mimeType" to "text/plain"))
        }
        return emptyList()
    }

    /**
     * Resolve the display name and type behind a content URI
     */
    private fun describe(uri: Uri): Map<String, Any?> {
        val resolver = appContext.reactContext?.contentResolver
        var name = uri.lastPathSegment ?: FALLBACK_NAME

        try {
            resolver?.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (column >= 0 && cursor.moveToFirst()) {
                    name = cursor.getString(column) ?: name
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not read the name of $uri: ${e.message}")
        }

        return mapOf(
            "uri" to uri.toString(),
            "name" to name,
            "mimeType" to (resolver?.getType(uri) ?: "")
        )
    }

    companion object {
        private const val TAG = "ShareIntentModule"
        private const val FALLBACK_NAME = "shared"
    }
}
