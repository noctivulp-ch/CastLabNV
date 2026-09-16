package app.fedilab.castlab.screenshare

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Bundle
import android.util.Log
import android.view.Surface

/**
 * H.264 hardware encoder using MediaCodec in Surface input mode.
 * The VirtualDisplay renders into the input Surface, and encoded NAL units
 * are muxed into MPEG-TS and pushed to the HTTP server.
 */
class ScreenEncoder(
    private val width: Int,
    private val height: Int,
    private val bitRate: Int = 2_000_000,
    private val frameRate: Int = 30
) {
    private var codec: MediaCodec? = null
    private var tsMuxer = TsMuxer()
    var inputSurface: Surface? = null
        private set

    @Volatile
    private var running = false
    private var outputCallback: ((ByteArray) -> Unit)? = null
    private var outputThread: Thread? = null

    fun init() {
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
            setInteger(MediaFormat.KEY_FRAME_RATE, frameRate)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
            setInteger(
                MediaFormat.KEY_COLOR_FORMAT,
                MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
            )
        }

        codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codec!!.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        inputSurface = codec!!.createInputSurface()
        Log.i(TAG, "Encoder initialized: ${width}x${height} @ ${bitRate / 1000}kbps")
    }

    fun setOutputCallback(callback: (ByteArray) -> Unit) {
        outputCallback = callback
    }

    /**
     * Request a keyframe so a joining client can start decoding
     */
    fun requestKeyFrame() {
        try {
            val params = Bundle().apply {
                putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0)
            }
            codec?.setParameters(params)
        } catch (e: Exception) {
            Log.w(TAG, "Keyframe request failed: ${e.message}")
        }
    }

    fun start() {
        running = true
        codec!!.start()

        outputThread = Thread {
            val bufferInfo = MediaCodec.BufferInfo()
            while (running) {
                try {
                    val index = codec!!.dequeueOutputBuffer(bufferInfo, 10_000)
                    if (index >= 0) {
                        val outputBuffer = codec!!.getOutputBuffer(index) ?: continue

                        if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                            // SPS/PPS — store for prepending before keyframes
                            val configData = ByteArray(bufferInfo.size)
                            outputBuffer.get(configData)
                            tsMuxer.setConfigData(configData)
                        } else if (bufferInfo.size > 0) {
                            val nalData = ByteArray(bufferInfo.size)
                            outputBuffer.get(nalData)
                            val tsPackets = tsMuxer.mux(nalData, bufferInfo.presentationTimeUs)
                            outputCallback?.invoke(tsPackets)
                        }

                        codec!!.releaseOutputBuffer(index, false)
                    }
                } catch (e: Exception) {
                    if (running) Log.w(TAG, "Output drain error: ${e.message}")
                }
            }
        }
        outputThread!!.start()
        Log.i(TAG, "Encoder started")
    }

    fun stop() {
        running = false
        try {
            outputThread?.join(2000)
        } catch (_: Exception) {}
        try {
            codec?.stop()
            codec?.release()
        } catch (_: Exception) {}
        try {
            inputSurface?.release()
        } catch (_: Exception) {}
        codec = null
        inputSurface = null
        Log.i(TAG, "Encoder stopped")
    }

    companion object {
        private const val TAG = "ScreenEncoder"
    }
}
