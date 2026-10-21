package app.fedilab.castlab.screenshare

import java.io.ByteArrayOutputStream

/**
 * Lightweight MPEG-TS muxer for one H.264 video stream and an optional
 * AAC audio stream.
 *
 * Video and audio are muxed from different threads, so every entry point is
 * synchronized: a TS packet must never be interleaved halfway through.
 */
class TsMuxer {
    private var patCc = 0
    private var pmtCc = 0
    private var videoCc = 0
    private var audioCc = 0
    private var configData: ByteArray? = null // SPS + PPS

    /**
     * Whether the PMT advertises an audio elementary stream. Must be set
     * before muxing starts: audio capture needs RECORD_AUDIO and API 29+, so
     * a video-only stream stays a valid outcome.
     */
    @Volatile
    var hasAudio = false

    fun setConfigData(data: ByteArray) {
        configData = data
    }

    /**
     * Mux an H.264 access unit into MPEG-TS packets.
     * @param nalData H.264 NAL unit data (with start codes)
     * @param pts Presentation timestamp in microseconds
     * @return Complete TS packets as byte array
     */
    @Synchronized
    fun mux(nalData: ByteArray, pts: Long): ByteArray {
        val output = ByteArrayOutputStream()

        // Insert PAT + PMT before each keyframe
        if (isKeyFrame(nalData)) {
            output.write(buildPat())
            output.write(buildPmt())
        }

        val pesData = buildVideoPes(nalData, pts)
        // The PCR rides on the video PID, as the PMT declares.
        videoCc = packetize(output, VIDEO_PID, pesData, videoCc, pts * 90)
        return output.toByteArray()
    }

    /**
     * Mux one ADTS-framed AAC access unit.
     * @param adtsFrame AAC frame including its 7-byte ADTS header
     * @param pts Presentation timestamp in microseconds, same clock as video
     */
    @Synchronized
    fun muxAudio(adtsFrame: ByteArray, pts: Long): ByteArray {
        if (!hasAudio) return ByteArray(0)
        val output = ByteArrayOutputStream()
        val pesData = buildAudioPes(adtsFrame, pts)
        audioCc = packetize(output, AUDIO_PID, pesData, audioCc, null)
        return output.toByteArray()
    }

    /**
     * Splits a PES packet across 188-byte TS packets, padding the last one
     * with an adaptation field. Returns the next continuity counter.
     */
    private fun packetize(
        output: ByteArrayOutputStream,
        pid: Int,
        pesData: ByteArray,
        startCc: Int,
        pcr: Long?,
    ): Int {
        var cc = startCc
        var offset = 0
        var first = true

        while (offset < pesData.size) {
            val packet = ByteArray(TS_PACKET_SIZE) { 0xFF.toByte() }
            packet[0] = SYNC_BYTE
            packet[1] = ((if (first) 0x40 else 0x00) or (pid shr 8 and 0x1F)).toByte()
            packet[2] = (pid and 0xFF).toByte()

            val remaining = pesData.size - offset
            val wantPcr = first && pcr != null

            // Adaptation field length, counting its own length byte.
            var afLen = if (wantPcr) PCR_AF_LEN else 0
            if (remaining < TS_PAYLOAD_SIZE - afLen) {
                afLen = TS_PAYLOAD_SIZE - remaining
            }

            packet[3] = ((if (afLen > 0) 0x30 else 0x10) or (cc and 0x0F)).toByte()

            if (afLen > 0) {
                packet[4] = (afLen - 1).toByte()
                if (afLen >= 2) {
                    packet[5] = if (wantPcr) 0x10 else 0x00 // PCR flag
                    if (pcr != null && wantPcr) writePcr(packet, 6, pcr)
                }
            }

            val headerSize = 4 + afLen
            val payloadSize = TS_PACKET_SIZE - headerSize
            System.arraycopy(pesData, offset, packet, headerSize, payloadSize)

            cc = (cc + 1) and 0x0F
            offset += payloadSize
            first = false
            output.write(packet)
        }
        return cc
    }

    /** 33-bit base, 6 reserved bits, 9-bit extension. */
    private fun writePcr(packet: ByteArray, at: Int, pcr90: Long) {
        val base = pcr90 and 0x1FFFFFFFFL
        packet[at] = (base shr 25 and 0xFF).toByte()
        packet[at + 1] = (base shr 17 and 0xFF).toByte()
        packet[at + 2] = (base shr 9 and 0xFF).toByte()
        packet[at + 3] = (base shr 1 and 0xFF).toByte()
        packet[at + 4] = (((base and 1L) shl 7) or 0x7E).toByte()
        packet[at + 5] = 0x00
    }

    private fun isKeyFrame(nalData: ByteArray): Boolean {
        // Look for IDR NAL unit type (5) in the data
        for (i in 0 until nalData.size - 4) {
            if (nalData[i] == 0x00.toByte() && nalData[i + 1] == 0x00.toByte() &&
                nalData[i + 2] == 0x00.toByte() && nalData[i + 3] == 0x01.toByte()) {
                val nalType = nalData[i + 4].toInt() and 0x1F
                if (nalType == 5) return true
            }
            if (nalData[i] == 0x00.toByte() && nalData[i + 1] == 0x00.toByte() &&
                nalData[i + 2] == 0x01.toByte()) {
                val nalType = nalData[i + 3].toInt() and 0x1F
                if (nalType == 5) return true
            }
        }
        return false
    }

    private fun buildVideoPes(nalData: ByteArray, pts: Long): ByteArray {
        // Prepend SPS/PPS before keyframes
        val payload = if (isKeyFrame(nalData) && configData != null) {
            configData!! + nalData
        } else {
            nalData
        }
        // Video may declare length 0 (unbounded) when it overflows 16 bits.
        val pesLen = payload.size + 8
        return buildPes(VIDEO_STREAM_ID, payload, pts, if (pesLen > 0xFFFF) 0 else pesLen)
    }

    private fun buildAudioPes(adtsFrame: ByteArray, pts: Long): ByteArray {
        // Audio PES length is mandatory: 0 is only legal for video.
        return buildPes(AUDIO_STREAM_ID, adtsFrame, pts, adtsFrame.size + 8)
    }

    private fun buildPes(
        streamId: Int,
        payload: ByteArray,
        pts: Long,
        pesLen: Int,
    ): ByteArray {
        val ptsTs = pts * 90 / 1000 // Convert us to 90kHz clock

        val pes = ByteArrayOutputStream()
        // Start code
        pes.write(0x00)
        pes.write(0x00)
        pes.write(0x01)
        pes.write(streamId)
        pes.write(pesLen shr 8 and 0xFF)
        pes.write(pesLen and 0xFF)
        // Flags: data alignment, PTS present
        pes.write(0x80)
        pes.write(0x80) // PTS only
        // PES header data length
        pes.write(0x05)
        // PTS (5 bytes)
        pes.write((0x21 or ((ptsTs shr 29 and 0x0E).toInt())).toByte().toInt())
        pes.write((ptsTs shr 22 and 0xFF).toInt())
        pes.write((0x01 or ((ptsTs shr 14 and 0xFE).toInt())).toByte().toInt())
        pes.write((ptsTs shr 7 and 0xFF).toInt())
        pes.write((0x01 or ((ptsTs shl 1 and 0xFE).toInt())).toByte().toInt())

        pes.write(payload)
        return pes.toByteArray()
    }

    private fun buildPat(): ByteArray {
        val packet = ByteArray(TS_PACKET_SIZE) { 0xFF.toByte() }
        packet[0] = SYNC_BYTE
        packet[1] = 0x40 // payload unit start
        packet[2] = 0x00 // PID 0 (PAT)
        packet[3] = (0x10 or (patCc and 0x0F)).toByte()
        patCc = (patCc + 1) and 0x0F

        // Pointer field
        packet[4] = 0x00

        // PAT table
        val pat = byteArrayOf(
            0x00,                           // table_id
            0xB0.toByte(), 0x0D,            // section syntax + length (13)
            0x00, 0x01,                     // transport_stream_id
            0xC1.toByte(),                  // version, current
            0x00, 0x00,                     // section number, last section
            0x00, 0x01,                     // program number (1)
            0x10.toByte(), 0x00             // PMT PID (0x1000)
        )
        System.arraycopy(pat, 0, packet, 5, pat.size)
        writeCrc(packet, pat.size)
        return packet
    }

    private fun buildPmt(): ByteArray {
        val packet = ByteArray(TS_PACKET_SIZE) { 0xFF.toByte() }
        packet[0] = SYNC_BYTE
        packet[1] = 0x50 // payload unit start + PID 0x1000 high bits
        packet[2] = 0x00 // PID 0x1000 low bits
        packet[3] = (0x10 or (pmtCc and 0x0F)).toByte()
        pmtCc = (pmtCc + 1) and 0x0F

        // Pointer field
        packet[4] = 0x00

        val streams = ByteArrayOutputStream()
        streams.write(byteArrayOf(
            0x1B,                           // stream_type: H.264
            0xE1.toByte(), 0x00,            // elementary PID (0x100)
            0xF0.toByte(), 0x00             // ES info length (0)
        ))
        if (hasAudio) {
            streams.write(byteArrayOf(
                0x0F,                       // stream_type: AAC (ADTS)
                0xE1.toByte(), 0x01,        // elementary PID (0x101)
                0xF0.toByte(), 0x00         // ES info length (0)
            ))
        }
        val streamBytes = streams.toByteArray()

        // section_length spans everything after the length field, CRC included.
        val sectionLength = PMT_FIXED_SECTION_LEN + streamBytes.size

        val pmt = ByteArrayOutputStream()
        pmt.write(0x02)                                     // table_id (PMT)
        pmt.write(0xB0 or (sectionLength shr 8 and 0x0F))
        pmt.write(sectionLength and 0xFF)
        pmt.write(byteArrayOf(
            0x00, 0x01,                     // program_number
            0xC1.toByte(),                  // version, current
            0x00, 0x00,                     // section number, last section
            0xE1.toByte(), 0x00,            // PCR PID = VIDEO_PID (0x100)
            0xF0.toByte(), 0x00             // program info length (0)
        ))
        pmt.write(streamBytes)

        val table = pmt.toByteArray()
        System.arraycopy(table, 0, packet, 5, table.size)
        writeCrc(packet, table.size)
        return packet
    }

    private fun writeCrc(packet: ByteArray, tableLength: Int) {
        val crc = crc32Mpeg(packet, 5, tableLength)
        val at = 5 + tableLength
        packet[at] = (crc shr 24 and 0xFF).toByte()
        packet[at + 1] = (crc shr 16 and 0xFF).toByte()
        packet[at + 2] = (crc shr 8 and 0xFF).toByte()
        packet[at + 3] = (crc and 0xFF).toByte()
    }

    private fun crc32Mpeg(data: ByteArray, offset: Int, length: Int): Int {
        var crc = 0xFFFFFFFF.toInt()
        for (i in offset until offset + length) {
            crc = crc xor (data[i].toInt() shl 24)
            for (j in 0 until 8) {
                crc = if (crc and 0x80000000.toInt() != 0) {
                    (crc shl 1) xor 0x04C11DB7
                } else {
                    crc shl 1
                }
            }
        }
        return crc
    }

    companion object {
        private const val TS_PACKET_SIZE = 188
        private const val TS_PAYLOAD_SIZE = 184
        private const val SYNC_BYTE = 0x47.toByte()
        private const val VIDEO_PID = 0x100
        private const val AUDIO_PID = 0x101
        private const val VIDEO_STREAM_ID = 0xE0
        private const val AUDIO_STREAM_ID = 0xC0

        // 1 length byte + 1 flags byte + 6 PCR bytes
        private const val PCR_AF_LEN = 8

        // Bytes from program_number through program_info_length, plus CRC32.
        private const val PMT_FIXED_SECTION_LEN = 13
    }
}
