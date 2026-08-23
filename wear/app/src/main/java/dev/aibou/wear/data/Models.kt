package dev.aibou.wear.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * AWP data models — Kotlin mirror of packages/protocol.
 * When protocol changes, this file must be updated in the same commit.
 */

@Serializable
data class BaseFrame(
    val v: Int = 1,
    val t: String,
    val id: String? = null,
    val ts: Long = System.currentTimeMillis()
)

@Serializable
data class HelloFrame(
    val v: Int = 1,
    val t: String = "hello",
    val bridgeVersion: String = "",
    val protocolVersion: Int = 1,
    val mode: String = "live", // "live" | "mock"
    val capabilities: List<String> = emptyList(),
    val ts: Long = 0
)

@Serializable
data class SessionState(
    val sessionId: String,
    val cwd: String = "",
    val status: String = "idle",
    val statusSource: String = "observed",
    val statusReason: String? = null,
    val pendingApprovals: Int = 0,
    val lastActivity: Long = 0
)

@Serializable
data class PermissionRequest(
    val approvalId: String,
    val sessionId: String,
    val toolName: String,
    val summary: String,
    val toolInput: JsonElement? = null,
    val riskTier: String = "medium", // "low" | "medium" | "high"
    val expiresAt: Long = 0
)

@Serializable
data class PermissionResolved(
    val approvalId: String,
    val decision: String,
    val resolution: String // "user" | "policy" | "timeout"
)

/**
 * One line of agent activity, rendered on the watch so the developer can see
 * what Kiro is actually doing between approvals.
 *
 * `text` is only ever what the Bridge sent. Nothing here is synthesised — an
 * event the agent did not report simply does not appear (context.md §6).
 */
data class ActivityItem(
    val seq: Long,
    val kind: String,
    val text: String,
    val ts: Long = System.currentTimeMillis()
) {
    /** Short glyph so a glance conveys the type without reading. */
    val glyph: String
        get() = when (kind) {
            "agent.text" -> "💬"
            "agent.thought" -> "…"
            "tool.start" -> "⚙"
            "tool.end" -> "✓"
            "task.update" -> "📋"
            "usage" -> "📊"
            else -> "•"
        }
}

/**
 * Combined UI state derived from WebSocket frames.
 */
data class UiState(
    val connectionState: ConnectionState = ConnectionState.DISCONNECTED,
    val mode: String? = null, // "live" | "mock"
    val session: SessionState? = null,
    val pendingApproval: PermissionRequest? = null,
    /** Newest last. Bounded — see AibouClient.MAX_ACTIVITY. */
    val activity: List<ActivityItem> = emptyList(),
    val error: String? = null
) {
    /**
     * Line to preview on the status screen.
     *
     * Prefers the newest thing the agent said or did over bookkeeping: a token
     * count is the least useful answer to "what is it doing right now", and it
     * often arrives last, so a naive tail would show that instead of the work.
     * The full feed still keeps everything in arrival order.
     */
    val latestActivity: ActivityItem?
        get() = activity.lastOrNull { it.kind != "usage" } ?: activity.lastOrNull()
}

enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    AUTHENTICATING,
    CONNECTED
}
