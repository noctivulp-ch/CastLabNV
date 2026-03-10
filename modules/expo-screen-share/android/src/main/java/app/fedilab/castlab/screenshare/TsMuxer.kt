package app.fedilab.castlab.screenshare

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/**
 * Lightweight MPEG-TS muxer for a single H.264 video stream.
 * Wraps H.264 NAL units into PES packets, then into 188-byte TS packets.
 */
class TsMuxer {
    private var patCc = 0
    private var pmtCc = 0
    private var videoCc = 0
    private var configData: ByteArray? = null // SPS + PPS

    fun setConfigData(data: ByteArray) {
        configData = data
    }

    /**
     * Mux H.264 access unit into MPEG-TS packets.
     * @param nalData H.264 NAL unit data (with start codes)
     * @param pts Presentation timestamp in microseconds
     * @return Complete TS packets as byte array
     */
    fun mux(nalData: ByteArray, pts: Long): ByteArray {
        val output = ByteArrayOutputStream()

        // Insert PAT + PMT before each keyframe
        if (isKeyFrame(nalData)) {
            output.write(buildPat())
            output.write(buildPmt())
        }

        // Build PES packet
        val pesData = buildPes(nalData, pts)

        // Split PES into 188-byte TS packets
        var offset = 0
        var first = true
        while (offset < pesData.size) {
            val packet = ByteArray(TS_PACKET_SIZE)
            packet[0] = SYNC_BYTE

            // PID = VIDEO_PID (0x100)
            val payloadUnitStart = if (first) 0x40 else 0x00
            packet[1] = (payloadUnitStart or (VIDEO_PID shr 8 and 0x1F)).toByte()
            packet[2] = (VIDEO_PID and 0xFF).toByte()

            val remaining = pesData.size - offset
            val headerSize: Int

            if (first && remaining < TS_PAYLOAD_SIZE) {
                // Need adaptation field for padding
                val adaptLen = TS_PAYLOAD_SIZE - remaining
                packet[3] = (0x30 or (videoCc and 0x0F)).toByte() // adaptation + payload
                packet[4] = (adaptLen - 1).toByte()
                if (adaptLen > 1) {
                    packet[5] = 0x00 // flags
                    for (i in 6 until 4 + adaptLen) {
                        packet[i] = 0xFF.toByte() // stuffing
                    }
                }
                headerSize = 4 + adaptLen
            } else if (!first && remaining < TS_PAYLOAD_SIZE) {
                val adaptLen = TS_PAYLOAD_SIZE - remaining
                packet[3] = (0x30 or (videoCc and 0x0F)).toByte()
                packet[4] = (adaptLen - 1).toByte()
                if (adaptLen > 1) {
                    packet[5] = 0x00
                    for (i in 6 until 4 + adaptLen) {
                        packet[i] = 0xFF.toByte()
                    }
                }
                headerSize = 4 + adaptLen
            } else {
                packet[3] = (0x10 or (videoCc and 0x0F)).toByte() // payload only
                headerSize = 4
            }

            val payloadSize = minOf(remaining, TS_PACKET_SIZE - headerSize)
            System.arraycopy(pesData, offset, packet, headerSize, payloadSize)

            videoCc = (videoCc + 1) and 0x0F
            offset += payloadSize
            first = false

            output.write(packet)
        }

        return output.toByteArray()
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

    private fun buildPes(nalData: ByteArray, pts: Long): ByteArray {
        val ptsTs = pts * 90 / 1000 // Convert us to 90kHz clock

        // Prepend SPS/PPS before keyframes
        val payload = if (isKeyFrame(nalData) && configData != null) {
            configData!! + nalData
        } else {
            nalData
        }

        val pesHeaderLen = 14 // PES header with PTS
        val pesLen = payload.size + 8 // 3 (header extension) + 5 (PTS) + payload

        val pes = ByteArrayOutputStream()
        // Start code
        pes.write(0x00)
        pes.write(0x00)
        pes.write(0x01)
        // Stream ID (video)
        pes.write(0xE0)
        // PES packet length (0 = unbounded for video)
        if (pesLen > 0xFFFF) {
            pes.write(0x00)
            pes.write(0x00)
        } else {
            pes.write(pesLen shr 8 and 0xFF)
            pes.write(pesLen and 0xFF)
        }
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
        val packet = ByteArray(TS_PACKET_SIZE)
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

        // CRC32
        val crc = crc32Mpeg(packet, 5, pat.size)
        val crcOffset = 5 + pat.size
        packet[crcOffset] = (crc shr 24 and 0xFF).toByte()
        packet[crcOffset + 1] = (crc shr 16 and 0xFF).toByte()
        packet[crcOffset + 2] = (crc shr 8 and 0xFF).toByte()
        packet[crcOffset + 3] = (crc and 0xFF).toByte()

        // Fill rest with 0xFF
        for (i in crcOffset + 4 until TS_PACKET_SIZE) {
            packet[i] = 0xFF.toByte()
        }

        return packet
    }

    private fun buildPmt(): ByteArray {
        val packet = ByteArray(TS_PACKET_SIZE)
        packet[0] = SYNC_BYTE
        packet[1] = 0x50 // payload unit start + PID 0x1000 high bits
        packet[2] = 0x00 // PID 0x1000 low bits
        packet[3] = (0x10 or (pmtCc and 0x0F)).toByte()
        pmtCc = (pmtCc + 1) and 0x0F

        // Pointer field
        packet[4] = 0x00

        // PMT table
        val pmt = byteArrayOf(
            0x02,                           // table_id (PMT)
            0xB0.toByte(), 0x12,            // section syntax + length (18)
            0x00, 0x01,                     // program_number
            0xC1.toByte(),                  // version, current
            0x00, 0x00,                     // section number, last section
            0xE1.toByte(), 0x00,            // PCR PID = VIDEO_PID (0x100)
            0xF0.toByte(), 0x00,            // program info length (0)
            0x1B,                           // stream_type: H.264
            0xE1.toByte(), 0x00,            // elementary PID = VIDEO_PID (0x100)
            0xF0.toByte(), 0x00             // ES info length (0)
        )
        System.arraycopy(pmt, 0, packet, 5, pmt.size)

        // CRC32
        val crc = crc32Mpeg(packet, 5, pmt.size)
        val crcOffset = 5 + pmt.size
        packet[crcOffset] = (crc shr 24 and 0xFF).toByte()
        packet[crcOffset + 1] = (crc shr 16 and 0xFF).toByte()
        packet[crcOffset + 2] = (crc shr 8 and 0xFF).toByte()
        packet[crcOffset + 3] = (crc and 0xFF).toByte()

        for (i in crcOffset + 4 until TS_PACKET_SIZE) {
            packet[i] = 0xFF.toByte()
        }

        return packet
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
    }
}
