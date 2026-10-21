package app.fedilab.castlab.screenshare

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Build
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
    private val frameRate: Int = 30,
    // Shared with AudioEncoder so both elementary streams land in one TS.
    val tsMuxer: TsMuxer = TsMuxer()
) {
    private var codec: MediaCodec? = null
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
            // Un keyframe por segundo: el receptor no puede empezar a mostrar
            // nada hasta que llega uno, así que este intervalo es el suelo de
            // la latencia al conectar y al recuperarse de un corte.
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
            // Prioridad de tiempo real: sin ella el encoder puede acumular
            // varios cuadros antes de soltar el primero.
            setInteger(MediaFormat.KEY_PRIORITY, 0)
            // Sin cuadros B no hay reordenación, y por tanto no hay que
            // esperar a los siguientes para emitir el actual.
            setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0)
            // Tasa constante: en modo variable el encoder retiene cuadros
            // mientras decide cuánto bitrate darles.
            setInteger(MediaFormat.KEY_BITRATE_MODE,
                MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)
            // Si la pantalla no cambia el encoder no emite nada y el receptor
            // se queda con el último cuadro; repetirlo mantiene el flujo vivo.
            setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 250_000L)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                setInteger(MediaFormat.KEY_LATENCY, 1)
            }
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
