package app.fedilab.castlab.screenshare

import android.util.Log
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Minimal HTTP server that streams MPEG-TS data via chunked transfer encoding.
 */
class StreamHttpServer(private val port: Int) {
    private var serverSocket: ServerSocket? = null
    private val clients = CopyOnWriteArrayList<OutputStream>()
    @Volatile
    private var running = false

    // Lets the encoder emit a keyframe when a client joins
    var onClientConnected: (() -> Unit)? = null

    fun start() {
        running = true
        Thread {
            try {
                serverSocket = ServerSocket(port)
                Log.i(TAG, "Stream server started on port $port")
                while (running) {
                    try {
                        val socket = serverSocket!!.accept()
                        handleClient(socket)
                    } catch (e: Exception) {
                        if (running) Log.w(TAG, "Accept error: ${e.message}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Server start error: ${e.message}")
            }
        }.start()
    }

    private fun handleClient(socket: Socket) {
        Thread {
            try {
                val input = socket.getInputStream().bufferedReader()
                // Consume HTTP request
                var line = input.readLine()
                while (line != null && line.isNotEmpty()) {
                    line = input.readLine()
                }

                val output = socket.getOutputStream()
                val header = "HTTP/1.1 200 OK\r\n" +
                        "Content-Type: video/mp2t\r\n" +
                        "Transfer-Encoding: chunked\r\n" +
                        "Connection: keep-alive\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "transferMode.dlna.org: Streaming\r\n" +
                        "\r\n"
                output.write(header.toByteArray())
                output.flush()

                clients.add(output)
                Log.i(TAG, "Client connected, total: ${clients.size}")
                onClientConnected?.invoke()

                // Keep alive until closed
                try {
                    while (running && !socket.isClosed) {
                        Thread.sleep(1000)
                    }
                } catch (_: Exception) {}
            } catch (e: Exception) {
                Log.w(TAG, "Client handler error: ${e.message}")
            } finally {
                try { socket.close() } catch (_: Exception) {}
            }
        }.start()
    }

    fun pushData(data: ByteArray) {
        if (clients.isEmpty()) return
        val chunk = "${data.size.toString(16)}\r\n".toByteArray() + data + "\r\n".toByteArray()
        val toRemove = mutableListOf<OutputStream>()
        for (client in clients) {
            try {
                client.write(chunk)
                client.flush()
            } catch (_: Exception) {
                toRemove.add(client)
            }
        }
        clients.removeAll(toRemove.toSet())
    }

    fun stop() {
        running = false
        clients.clear()
        try { serverSocket?.close() } catch (_: Exception) {}
        serverSocket = null
        Log.i(TAG, "Stream server stopped")
    }

    companion object {
        private const val TAG = "StreamHttpServer"
    }
}
