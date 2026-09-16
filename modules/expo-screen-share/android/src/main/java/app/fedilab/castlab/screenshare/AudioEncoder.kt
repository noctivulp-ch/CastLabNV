package app.fedilab.castlab.screenshare

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi

/**
 * Captures system playback audio and encodes it to AAC in ADTS frames.
 */
@SuppressLint("MissingPermission")
@RequiresApi(Build.VERSION_CODES.Q)
class AudioEncoder(
    private val projection: MediaProjection,
    private val sampleRate: Int = 44_100,
    private val channelCount: Int = 2,
    private val bitRate: Int = 128_000
) {
    private var codec: MediaCodec? = null
    private var record: AudioRecord? = null

    @Volatile
    private var running = false
    private var outputCallback: ((ByteArray) -> Unit)? = null
    private var captureThread: Thread? = null
    private var drainThread: Thread? = null
    private var sampleRateIndex = 0
    private var silenceCallback: (() -> Unit)? = null
    private var silentBytes = 0L
    private var silenceReported = false

    fun setOutputCallback(callback: (ByteArray) -> Unit) {
        outputCallback = callback
    }

    /**
     * Invoked once when the capture stays silent, which is how a protected app behaves
     */
    fun setSilenceCallback(callback: () -> Unit) {
        silenceCallback = callback
    }

    fun init() {
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channelCount).apply {
            setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, MAX_INPUT_SIZE)
        }

        codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        codec!!.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)

        // Other usages stay silent by capture policy
        val config = AudioPlaybackCaptureConfiguration.Builder(projection)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()

        val channelMask = if (channelCount == 1) AudioFormat.CHANNEL_IN_MONO else AudioFormat.CHANNEL_IN_STEREO
        val minBuffer = AudioRecord.getMinBufferSize(sampleRate, channelMask, AudioFormat.ENCODING_PCM_16BIT)
        val bufferSize = if (minBuffer > 0) minBuffer * 2 else sampleRate * channelCount * 2

        record = AudioRecord.Builder()
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(channelMask)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .setAudioPlaybackCaptureConfig(config)
            .build()

        sampleRateIndex = SAMPLE_RATES.indexOf(sampleRate).let { if (it < 0) DEFAULT_RATE_INDEX else it }
        Log.i(TAG, "Audio encoder initialized: ${sampleRate}Hz ${channelCount}ch @ ${bitRate / 1000}kbps")
    }

    fun start() {
        running = true
        codec!!.start()
        record!!.startRecording()

        captureThread = Thread { pumpPcm() }
        drainThread = Thread { drainAac() }
        captureThread!!.start()
        drainThread!!.start()
        Log.i(TAG, "Audio encoder started")
    }

    /**
     * Read PCM from the capture buffer and feed it to the encoder
     */
    private fun pumpPcm() {
        val buffer = ByteArray(READ_SIZE)
        while (running) {
            try {
                val read = record!!.read(buffer, 0, buffer.size)
                if (read <= 0) continue
                trackSilence(buffer, read)

                val index = codec!!.dequeueInputBuffer(DEQUEUE_TIMEOUT_US)
                if (index < 0) continue

                val input = codec!!.getInputBuffer(index) ?: continue
                input.clear()
                input.put(buffer, 0, read)
                codec!!.queueInputBuffer(index, 0, read, System.nanoTime() / 1000, 0)
            } catch (e: Exception) {
                if (running) Log.w(TAG, "PCM capture error: ${e.message}")
            }
        }
    }

    /**
     * A protected source yields zeroed PCM rather than an error
     */
    private fun trackSilence(buffer: ByteArray, read: Int) {
        for (i in 0 until read) {
            if (buffer[i].toInt() != 0) {
                silentBytes = 0
                silenceReported = false
                return
            }
        }

        silentBytes += read
        if (!silenceReported && silentBytes >= silenceThresholdBytes()) {
            silenceReported = true
            Log.i(TAG, "Capture silent for ${SILENCE_THRESHOLD_MS}ms, the source may block capture")
            silenceCallback?.invoke()
        }
    }

    private fun silenceThresholdBytes(): Long =
        sampleRate.toLong() * channelCount * BYTES_PER_SAMPLE * SILENCE_THRESHOLD_MS / 1000

    /**
     * Pull encoded frames and emit them with an ADTS header
     */
    private fun drainAac() {
        val bufferInfo = MediaCodec.BufferInfo()
        while (running) {
            try {
                val index = codec!!.dequeueOutputBuffer(bufferInfo, DEQUEUE_TIMEOUT_US)
                if (index < 0) continue

                val output = codec!!.getOutputBuffer(index)
                if (output != null && bufferInfo.size > 0 &&
                    bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0
                ) {
                    val frame = ByteArray(ADTS_HEADER_SIZE + bufferInfo.size)
                    writeAdtsHeader(frame, frame.size)
                    output.position(bufferInfo.offset)
                    output.get(frame, ADTS_HEADER_SIZE, bufferInfo.size)
                    outputCallback?.invoke(frame)
                }

                codec!!.releaseOutputBuffer(index, false)
            } catch (e: Exception) {
                if (running) Log.w(TAG, "AAC drain error: ${e.message}")
            }
        }
    }

    /**
     * Build the 7 byte ADTS header MediaCodec does not emit
     */
    private fun writeAdtsHeader(frame: ByteArray, frameLength: Int) {
        frame[0] = 0xFF.toByte()
        frame[1] = 0xF1.toByte() // MPEG-4, no CRC
        frame[2] = (((AAC_LC_PROFILE - 1) shl 6) or (sampleRateIndex shl 2) or (channelCount shr 2)).toByte()
        frame[3] = (((channelCount and 0x03) shl 6) or (frameLength shr 11)).toByte()
        frame[4] = (frameLength shr 3 and 0xFF).toByte()
        frame[5] = (((frameLength and 0x07) shl 5) or 0x1F).toByte()
        frame[6] = 0xFC.toByte()
    }

    fun stop() {
        running = false
        try {
            captureThread?.join(2000)
            drainThread?.join(2000)
        } catch (_: Exception) {}
        try {
            record?.stop()
            record?.release()
        } catch (_: Exception) {}
        try {
            codec?.stop()
            codec?.release()
        } catch (_: Exception) {}
        record = null
        codec = null
        Log.i(TAG, "Audio encoder stopped")
    }

    companion object {
        private const val TAG = "AudioEncoder"
        private const val ADTS_HEADER_SIZE = 7
        private const val AAC_LC_PROFILE = 2
        private const val MAX_INPUT_SIZE = 16384
        private const val READ_SIZE = 4096
        private const val DEQUEUE_TIMEOUT_US = 10_000L
        private const val DEFAULT_RATE_INDEX = 4
        private const val BYTES_PER_SAMPLE = 2
        private const val SILENCE_THRESHOLD_MS = 5_000L
        private val SAMPLE_RATES = listOf(
            96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350
        )
    }
}
