package dev.aibou.wear.data

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.*
import okhttp3.*
import java.util.concurrent.TimeUnit

/**
 * Aibou WebSocket client for Wear OS.
 *
 * Connects to the Bridge, authenticates, subscribes to events,
 * and exposes a StateFlow<UiState> for the UI layer.
 *
 * Handles auto-reconnect with exponential backoff (AC5.1.7, AC3.3.2).
 */
class AibouClient(
    private val tokenStore: TokenStore,
    private val scope: CoroutineScope
) {
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var webSocket: WebSocket? = null
    private var reconnectAttempt = 0
    private var reconnectJob: Job? = null
    private var intentionalClose = false
    private var lastSeq = 0L

    private val json = Json { ignoreUnknownKeys = true }

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // No timeout for WebSocket
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    /**
     * Connect to the Bridge WebSocket.
     */
    fun connect() {
        val url = tokenStore.bridgeUrl ?: return
        val wsUrl = url.replace("http://", "ws://").replace("https://", "wss://") + "/ws"

        intentionalClose = false
        _state.value = _state.value.copy(connectionState = ConnectionState.CONNECTING)

        val request = Request.Builder().url(wsUrl).build()
        webSocket = client.newWebSocket(request, createListener())
    }

    /**
     * Disconnect from the Bridge.
     */
    fun disconnect() {
        intentionalClose = true
        reconnectJob?.cancel()
        webSocket?.close(1000, "User disconnect")
        webSocket = null
        _state.value = UiState(connectionState = ConnectionState.DISCONNECTED)
    }

    /**
     * Send a permission response (approve or deny).
     */
    fun respondToPermission(approvalId: String, decision: String) {
        val frame = buildJsonObject {
            put("v", 1)
            put("t", "permission.respond")
            put("approvalId", approvalId)
            put("decision", decision)
            put("ts", System.currentTimeMillis())
        }
        webSocket?.send(frame.toString())
    }

    /**
     * Send an interrupt command for the current session.
     */
    fun interruptSession() {
        val sessionId = _state.value.session?.sessionId ?: return
        val frame = buildJsonObject {
            put("v", 1)
            put("t", "session.interrupt")
            put("sessionId", sessionId)
            put("ts", System.currentTimeMillis())
        }
        webSocket?.send(frame.toString())
    }

    /**
     * Send a voice prompt to the agent.
     */
    fun sendPrompt(text: String) {
        val sessionId = _state.value.session?.sessionId ?: return
        val frame = buildJsonObject {
            put("v", 1)
            put("t", "prompt.send")
            put("sessionId", sessionId)
            put("text", text)
            put("source", "voice")
            put("ts", System.currentTimeMillis())
        }
        webSocket?.send(frame.toString())
    }

    /**
     * Pair with the Bridge using a 6-digit code.
     */
    suspend fun pair(bridgeUrl: String, code: String): Boolean {
        return withContext(Dispatchers.IO) {
            try {
                val body = RequestBody.create(
                    MediaType.parse("application/json"),
                    """{"code":"$code"}"""
                )
                val request = Request.Builder()
                    .url("$bridgeUrl/api/pair")
                    .post(body)
                    .build()

                val response = client.newCall(request).execute()
                if (response.isSuccessful) {
                    val responseBody = response.body()?.string() ?: return@withContext false
                    val jsonResponse = json.parseToJsonElement(responseBody).jsonObject
                    val token = jsonResponse["token"]?.jsonPrimitive?.content
                    if (token != null) {
                        tokenStore.token = token
                        tokenStore.bridgeUrl = bridgeUrl
                        return@withContext true
                    }
                }
                false
            } catch (e: Exception) {
                false
            }
        }
    }

    private fun createListener(): WebSocketListener {
        return object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                _state.value = _state.value.copy(connectionState = ConnectionState.AUTHENTICATING)
                // Send auth frame
                val authFrame = buildJsonObject {
                    put("v", 1)
                    put("t", "auth")
                    put("token", tokenStore.token ?: "")
                    put("ts", System.currentTimeMillis())
                }
                webSocket.send(authFrame.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleFrame(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (!intentionalClose) {
                    _state.value = _state.value.copy(connectionState = ConnectionState.DISCONNECTED)
                    scheduleReconnect()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                _state.value = _state.value.copy(
                    connectionState = ConnectionState.DISCONNECTED,
                    error = t.message
                )
                if (!intentionalClose) {
                    scheduleReconnect()
                }
            }
        }
    }

    private fun handleFrame(text: String) {
        try {
            val frame = json.parseToJsonElement(text).jsonObject
            val type = frame["t"]?.jsonPrimitive?.content ?: return

            when (type) {
                "hello" -> {
                    val mode = frame["mode"]?.jsonPrimitive?.content
                    _state.value = _state.value.copy(
                        connectionState = ConnectionState.CONNECTED,
                        mode = mode
                    )
                    reconnectAttempt = 0
                    // Subscribe
                    val subscribeFrame = buildJsonObject {
                        put("v", 1)
                        put("t", "subscribe")
                        put("since", lastSeq)
                        put("ts", System.currentTimeMillis())
                    }
                    webSocket?.send(subscribeFrame.toString())
                }

                "session.state" -> {
                    val session = SessionState(
                        sessionId = frame["sessionId"]?.jsonPrimitive?.content ?: "",
                        cwd = frame["cwd"]?.jsonPrimitive?.content ?: "",
                        status = frame["status"]?.jsonPrimitive?.content ?: "idle",
                        statusSource = frame["statusSource"]?.jsonPrimitive?.content ?: "observed",
                        statusReason = frame["statusReason"]?.jsonPrimitive?.contentOrNull,
                        pendingApprovals = frame["pendingApprovals"]?.jsonPrimitive?.int ?: 0,
                        lastActivity = frame["lastActivity"]?.jsonPrimitive?.long ?: 0
                    )
                    _state.value = _state.value.copy(session = session)
                }

                "permission.request" -> {
                    val approval = PermissionRequest(
                        approvalId = frame["approvalId"]?.jsonPrimitive?.content ?: "",
                        sessionId = frame["sessionId"]?.jsonPrimitive?.content ?: "",
                        toolName = frame["toolName"]?.jsonPrimitive?.content ?: "",
                        summary = frame["summary"]?.jsonPrimitive?.content ?: "",
                        toolInput = frame["toolInput"],
                        riskTier = frame["riskTier"]?.jsonPrimitive?.content ?: "medium",
                        expiresAt = frame["expiresAt"]?.jsonPrimitive?.long ?: 0
                    )
                    _state.value = _state.value.copy(pendingApproval = approval)
                }

                "permission.resolved" -> {
                    val resolvedId = frame["approvalId"]?.jsonPrimitive?.content
                    if (resolvedId == _state.value.pendingApproval?.approvalId) {
                        _state.value = _state.value.copy(pendingApproval = null)
                    }
                }

                "event" -> {
                    val seq = frame["seq"]?.jsonPrimitive?.long ?: 0
                    if (seq > lastSeq) lastSeq = seq
                }

                "heartbeat" -> {
                    val pongFrame = buildJsonObject {
                        put("v", 1)
                        put("t", "pong")
                        put("ts", System.currentTimeMillis())
                    }
                    webSocket?.send(pongFrame.toString())
                }

                "error" -> {
                    val code = frame["code"]?.jsonPrimitive?.content
                    if (code == "AIBOU_UNAUTHORIZED") {
                        intentionalClose = true
                        webSocket?.close(1000, "Unauthorized")
                        tokenStore.clear()
                        _state.value = UiState(connectionState = ConnectionState.DISCONNECTED, error = "Token expired. Re-pair required.")
                    } else {
                        val msg = frame["message"]?.jsonPrimitive?.content ?: "Unknown error"
                        _state.value = _state.value.copy(error = msg)
                    }
                }
            }
        } catch (e: Exception) {
            // Ignore malformed frames
        }
    }

    /**
     * Reconnect with exponential backoff: 1s, 2s, 4s, 8s, capped at 30s (AC3.3.2).
     */
    private fun scheduleReconnect() {
        if (intentionalClose) return

        val delay = minOf(1000L * (1L shl reconnectAttempt), 30_000L)
        reconnectAttempt++

        reconnectJob = scope.launch {
            delay(delay)
            connect()
        }
    }
}
