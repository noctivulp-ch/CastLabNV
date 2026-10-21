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
import java.util.concurrent.locks.LockSupport

/**
 * Captures the device's playback audio through MediaProjection and encodes it
 * to AAC-LC, feeding ADTS frames into the shared [TsMuxer].
 *
 * Only apps that allow playback capture are recorded: anything flagged as
 * non-capturable (most DRM-protected players) is silently absent from the
 * mix. That is an OS restriction, not something the caller can lift.
 */
@RequiresApi(Build.VERSION_CODES.Q)
class AudioEncoder(
    private val mediaProjection: MediaProjection,
    private val tsMuxer: TsMuxer,
    private val sampleRate: Int = 44_100,
    private val channelCount: Int = 2,
    private val bitRate: Int = 128_000,
) {
    private var codec: MediaCodec? = null
    private var record: AudioRecord? = null

    @Volatile
    private var running = false
    private var captureThread: Thread? = null
    private var drainThread: Thread? = null
    private var outputCallback: ((ByteArray) -> Unit)? = null

    fun setOutputCallback(callback: (ByteArray) -> Unit) {
        outputCallback = callback
    }

    @SuppressLint("MissingPermission") // RECORD_AUDIO is checked by the caller
    fun init(): Boolean {
        return try {
            val captureConfig = AudioPlaybackCaptureConfiguration.Builder(mediaProjection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()

            val channelMask = if (channelCount == 1) {
                AudioFormat.CHANNEL_IN_MONO
            } else {
                AudioFormat.CHANNEL_IN_STEREO
            }

            val minBuffer = AudioRecord.getMinBufferSize(
                sampleRate, channelMask, AudioFormat.ENCODING_PCM_16BIT
            )
            val bufferSize = if (minBuffer > 0) minBuffer * 2 else sampleRate * channelCount

            record = AudioRecord.Builder()
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(sampleRate)
                        .setChannelMask(channelMask)
                        .build()
                )
                .setBufferSizeInBytes(bufferSize)
                .setAudioPlaybackCaptureConfig(captureConfig)
                .build()

            if (record!!.state != AudioRecord.STATE_INITIALIZED) {
                Log.w(TAG, "AudioRecord did not initialize; continuing without audio")
                release()
                return false
            }

            val format = MediaFormat.createAudioFormat(
                MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channelCount
            ).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, MAX_INPUT_SIZE)
            }
            codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            codec!!.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)

            Log.i(TAG, "Audio encoder initialized: ${sampleRate}Hz ${channelCount}ch @ ${bitRate / 1000}kbps")
            true
        } catch (e: Exception) {
            Log.w(TAG, "Audio capture unavailable: ${e.message}")
            release()
            false
        }
    }

    fun start() {
        running = true
        codec!!.start()
        record!!.startRecording()

        captureThread = Thread { captureLoop() }
        drainThread = Thread { drainLoop() }
        captureThread!!.start()
        drainThread!!.start()
        Log.i(TAG, "Audio encoder started")
    }

    private fun captureLoop() {
        val frameBytes = READ_SAMPLES * channelCount * 2
        val buffer = ByteArray(frameBytes)
        val periodNs = READ_SAMPLES.toLong() * 1_000_000_000L / sampleRate
        var deadline = System.nanoTime()

        while (running) {
            try {
                // Lectura no bloqueante y cadencia propia: si el sistema deja
                // de entregar audio —nada sonando en el teléfono— el hueco se
                // rellena con silencio en lugar de dejar morir el stream. El
                // receptor engancha su reloj a la pista de audio, y un audio
                // que se corta le congela la imagen.
                var filled = 0
                while (filled < frameBytes) {
                    val read = record!!.read(
                        buffer, filled, frameBytes - filled, AudioRecord.READ_NON_BLOCKING
                    )
                    if (read <= 0) break
                    filled += read
                }
                if (filled < frameBytes) {
                    java.util.Arrays.fill(buffer, filled, frameBytes, 0)
                }

                val index = codec!!.dequeueInputBuffer(10_000)
                if (index >= 0) {
                    val input = codec!!.getInputBuffer(index)
                    if (input != null) {
                        input.clear()
                        input.put(buffer, 0, frameBytes)
                        // El sello va del reloj monotónico, el mismo del que
                        // salen los timestamps del surface de vídeo. Derivarlo
                        // del número de muestras parecía más limpio, pero el
                        // contador corre también mientras se rellena silencio
                        // esperando a que arranque la captura: ese adelanto
                        // —1,2 s medidos— se queda fijo en todo el audio
                        // posterior y se oye como desincronía.
                        val ptsUs = System.nanoTime() / 1000
                        codec!!.queueInputBuffer(index, 0, frameBytes, ptsUs, 0)
                    } else {
                        codec!!.queueInputBuffer(index, 0, 0, 0, 0)
                    }
                }

                // Cuando una vuelta se pasa de tiempo no se reajusta el plazo:
                // se sigue sin dormir hasta recuperar el atraso. Reajustarlo
                // regalaba ese tiempo, el audio salía a menos velocidad que el
                // reloj —12 % medido— y el receptor, que se guía por la pista
                // de audio, acumulaba retraso sin recuperarlo nunca.
                deadline += periodNs
                val sleep = deadline - System.nanoTime()
                if (sleep > 0) {
                    LockSupport.parkNanos(sleep)
                } else if (-sleep > MAX_ATRASO_NS) {
                    // Atraso desmedido (el proceso estuvo parado): recuperarlo
                    // entero sería una ráfaga inútil de audio viejo.
                    deadline = System.nanoTime()
                }
            } catch (e: Exception) {
                if (running) Log.w(TAG, "Audio capture error: ${e.message}")
            }
        }
    }

    private fun drainLoop() {
        val bufferInfo = MediaCodec.BufferInfo()
        while (running) {
            try {
                val index = codec!!.dequeueOutputBuffer(bufferInfo, 10_000)
                if (index < 0) continue
                val output = codec!!.getOutputBuffer(index)
                if (output == null) {
                    codec!!.releaseOutputBuffer(index, false)
                    continue
                }

                if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 &&
                    bufferInfo.size > 0
                ) {
                    val raw = ByteArray(bufferInfo.size)
                    output.position(bufferInfo.offset)
                    output.get(raw, 0, bufferInfo.size)

                    // stream_type 0x0F in the PMT means ADTS-framed AAC, and
                    // MediaCodec hands back raw AAC, so the header goes here.
                    val frame = adtsHeader(raw.size) + raw
                    val packets = tsMuxer.muxAudio(frame, bufferInfo.presentationTimeUs)
                    if (packets.isNotEmpty()) outputCallback?.invoke(packets)
                }
                codec!!.releaseOutputBuffer(index, false)
            } catch (e: Exception) {
                if (running) Log.w(TAG, "Audio drain error: ${e.message}")
            }
        }
    }

    private fun adtsHeader(payloadSize: Int): ByteArray {
        val frameLength = payloadSize + ADTS_HEADER_SIZE
        val freqIndex = SAMPLE_RATES.indexOf(sampleRate).let { if (it < 0) 4 else it }
        return byteArrayOf(
            0xFF.toByte(),                                   // syncword
            0xF1.toByte(),                                   // MPEG-4, no CRC
            (((AAC_LC - 1) shl 6) or (freqIndex shl 2) or (channelCount shr 2)).toByte(),
            (((channelCount and 3) shl 6) or (frameLength shr 11)).toByte(),
            (frameLength shr 3 and 0xFF).toByte(),
            (((frameLength and 7) shl 5) or 0x1F).toByte(),
            0xFC.toByte(),
        )
    }

    fun stop() {
        running = false
        try { captureThread?.join(2000) } catch (_: Exception) {}
        try { drainThread?.join(2000) } catch (_: Exception) {}
        release()
        Log.i(TAG, "Audio encoder stopped")
    }

    private fun release() {
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
    }

    companion object {
        private const val TAG = "AudioEncoder"
        private const val ADTS_HEADER_SIZE = 7
        private const val AAC_LC = 2
        private const val MAX_INPUT_SIZE = 16_384
        private const val READ_SAMPLES = 1024
        private const val MAX_ATRASO_NS = 500_000_000L
        private val SAMPLE_RATES = listOf(
            96000, 88200, 64000, 48000, 44100, 32000,
            24000, 22050, 16000, 12000, 11025, 8000
        )
    }
}
