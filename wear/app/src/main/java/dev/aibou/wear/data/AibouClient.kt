package dev.aibou.wear.data

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
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
    private val scope: CoroutineScope,
    private val notifier: ApprovalNotifier? = null
) {
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var webSocket: WebSocket? = null
    private var reconnectAttempt = 0
    private var reconnectJob: Job? = null
    private var intentionalClose = false
    private var lastSeq = 0L

    /** Decisions taken while the socket was down, flushed on reconnect. */
    private val pendingSends = mutableListOf<String>()

    private val json = Json { ignoreUnknownKeys = true }

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // No read timeout for WebSocket
        .connectTimeout(10, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build()

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        /** Activity lines retained. Small on purpose: a watch, not a terminal. */
        const val MAX_ACTIVITY = 40

        /** Cap per line so one long tool result cannot dominate memory. */
        const val MAX_ITEM_CHARS = 400
    }

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
     *
     * A decision tapped on a notification can arrive before the socket is ready,
     * because the process may have just been recreated. Dropping it there would
     * lose the developer's answer silently and leave the agent blocked, so an
     * unsendable decision is queued and flushed once authentication completes.
     */
    fun respondToPermission(approvalId: String, decision: String) {
        val frame = buildJsonObject {
            put("v", 1)
            put("t", "permission.respond")
            put("approvalId", approvalId)
            put("decision", decision)
            put("ts", System.currentTimeMillis())
        }
        if (!trySend(frame.toString())) {
            synchronized(pendingSends) { pendingSends.add(frame.toString()) }
            connect() // no-op if a connection attempt is already in flight
        }
    }

    /** Send now if the socket is open, reporting whether it went out. */
    private fun trySend(payload: String): Boolean {
        val ws = webSocket ?: return false
        return runCatching { ws.send(payload) }.getOrDefault(false)
    }

    /** Flush anything queued while the socket was down. */
    private fun flushPending() {
        val queued: List<String>
        synchronized(pendingSends) {
            if (pendingSends.isEmpty()) return
            queued = pendingSends.toList()
            pendingSends.clear()
        }
        for (payload in queued) {
            if (!trySend(payload)) {
                synchronized(pendingSends) { pendingSends.add(payload) }
            }
        }
    }

    /** Ask the Bridge to re-read the Kiro account from the CLI. */
    fun refreshAccount() {
        val frame = buildJsonObject {
            put("v", 1)
            put("t", "account.status")
            put("ts", System.currentTimeMillis())
        }
        if (!trySend(frame.toString())) {
            // Not worth queueing: a fresh account.state arrives on reconnect anyway.
            connect()
        }
    }

    /**
     * Sign the Kiro account out.
     *
     * Ends the agent's ability to work until someone signs in again, and is the
     * only thing that does — Kiro persists credentials, so restarts do not. The
     * watch stays paired.
     */
    fun signOutKiroAccount() {
        val frame = buildJsonObject {
            put("v", 1)
            put("t", "account.logout")
            put("ts", System.currentTimeMillis())
        }
        if (!trySend(frame.toString())) {
            synchronized(pendingSends) { pendingSends.add(frame.toString()) }
            connect()
        }
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
     * Exchange a 6-digit pairing code for a bearer token and persist it.
     *
     * @return null on success, or a short human-readable reason for the failure
     *   so the pairing screen can tell the user what actually went wrong.
     */
    suspend fun pair(bridgeUrl: String, code: String): String? {
        return withContext(Dispatchers.IO) {
            try {
                val payload = buildJsonObject { put("code", code) }.toString()
                val body = payload.toRequestBody(JSON_MEDIA_TYPE)
                val request = Request.Builder()
                    .url("$bridgeUrl/api/pair")
                    .post(body)
                    .build()

                client.newCall(request).execute().use { response ->
                    // OkHttp 5: Response.body is non-null.
                    val raw = response.body.string()

                    if (!response.isSuccessful) {
                        return@withContext when (response.code) {
                            401 -> "Invalid or expired code"
                            429 -> "Too many attempts, wait 5 min"
                            else -> "Bridge error ${response.code}"
                        }
                    }
                    if (raw.isNullOrBlank()) return@withContext "Empty response from Bridge"

                    val token = runCatching {
                        json.parseToJsonElement(raw).jsonObject["token"]?.jsonPrimitive?.content
                    }.getOrNull()

                    if (token.isNullOrBlank()) return@withContext "No token in response"

                    tokenStore.token = token
                    tokenStore.bridgeUrl = bridgeUrl
                    null
                }
            } catch (e: IOException) {
                "Cannot reach $bridgeUrl"
            } catch (e: Exception) {
                e.message?.take(40) ?: "Pairing failed"
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
                    // Deliver any decision taken while offline.
                    flushPending()
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
                    // Also raise it outside the app, so a backgrounded watch or a
                    // dark screen does not leave the agent blocked in silence.
                    notifier?.show(approval)
                }

                "permission.resolved" -> {
                    val resolvedId = frame["approvalId"]?.jsonPrimitive?.content
                    if (resolvedId == _state.value.pendingApproval?.approvalId) {
                        _state.value = _state.value.copy(pendingApproval = null)
                    }
                    // Resolved by anyone — this watch, the PWA, policy, or a
                    // timeout. Either way the notification is now stale.
                    notifier?.clear()
                }

                "event" -> {
                    val seq = frame["seq"]?.jsonPrimitive?.long ?: 0
                    if (seq > lastSeq) lastSeq = seq
                    appendActivity(seq, frame)
                }

                "account.state" -> {
                    fun field(key: String): String? =
                        frame[key]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }

                    _state.value = _state.value.copy(
                        account = AccountInfo(
                            state = field("state") ?: "unauthenticated",
                            accountType = field("accountType"),
                            provider = field("provider"),
                            email = field("email"),
                            verificationUri = field("verificationUri"),
                            userCode = field("userCode"),
                            reason = field("reason"),
                        )
                    )
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
     * Turn an AWP `event` frame into a line of watch-readable activity.
     *
     * The agent streams its prose in many small chunks, so consecutive
     * `agent.text` events are merged into the item already on screen rather than
     * producing a wall of fragments. Events that carry no displayable text are
     * dropped instead of being padded out with invented wording.
     */
    private fun appendActivity(seq: Long, frame: JsonObject) {
        val kind = frame["kind"]?.jsonPrimitive?.content ?: return
        val payload = frame["payload"] as? JsonObject

        val text = describe(kind, payload) ?: return

        val current = _state.value.activity
        val last = current.lastOrNull()

        // Merge streamed prose into the previous line so it reads as a sentence.
        val merged =
            if (last != null && last.kind == kind && (kind == "agent.text" || kind == "agent.thought")) {
                current.dropLast(1) + last.copy(seq = seq, text = (last.text + text).takeLast(MAX_ITEM_CHARS))
            } else {
                current + ActivityItem(seq = seq, kind = kind, text = text.take(MAX_ITEM_CHARS))
            }

        _state.value = _state.value.copy(activity = merged.takeLast(MAX_ACTIVITY))
    }

    /**
     * Human-readable one-liner for an event payload, or null when the event has
     * nothing worth showing on a watch-sized screen.
     */
    private fun describe(kind: String, payload: JsonObject?): String? {
        if (payload == null) return null

        fun str(key: String): String? =
            (payload[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }

        return when (kind) {
            "agent.text", "agent.thought" -> str("text")

            "tool.start" -> {
                val command = (payload["rawInput"] as? JsonObject)
                    ?.let { (it["command"] as? JsonPrimitive)?.contentOrNull }
                command ?: str("title") ?: str("kind")
            }

            "tool.end" -> {
                val status = str("status") ?: "done"
                val output = toolOutput(payload)
                if (output != null) "$status — $output" else status
            }

            "task.update" -> {
                val entries = payload["entries"] as? JsonArray ?: return "plan updated"
                val active = entries.firstOrNull { entry ->
                    val status = ((entry as? JsonObject)?.get("status") as? JsonPrimitive)?.contentOrNull
                    status == "in_progress"
                } as? JsonObject
                val label = (active?.get("content") as? JsonPrimitive)?.contentOrNull
                label ?: "plan: ${entries.size} steps"
            }

            // Only ever the agent's own numbers, never a computed estimate.
            "usage" -> {
                val used = (payload["used"] as? JsonPrimitive)?.contentOrNull
                val size = (payload["size"] as? JsonPrimitive)?.contentOrNull
                when {
                    used != null && size != null -> "context $used/$size"
                    used != null -> "context $used"
                    else -> null
                }
            }

            else -> null
        }
    }

    /** Pull the first text blob out of an ACP tool result, if there is one. */
    private fun toolOutput(payload: JsonObject): String? {
        val content = payload["content"] as? JsonArray ?: return null
        for (element in content) {
            val obj = element as? JsonObject ?: continue
            // Real kiro-cli nests as { type: "content", content: { text } };
            // some agents send { text } directly.
            val direct = (obj["text"] as? JsonPrimitive)?.contentOrNull
            if (!direct.isNullOrBlank()) return direct.trim()
            val nested = ((obj["content"] as? JsonObject)?.get("text") as? JsonPrimitive)?.contentOrNull
            if (!nested.isNullOrBlank()) return nested.trim()
        }
        return null
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
