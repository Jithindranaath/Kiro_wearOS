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
 * Combined UI state derived from WebSocket frames.
 */
data class UiState(
    val connectionState: ConnectionState = ConnectionState.DISCONNECTED,
    val mode: String? = null, // "live" | "mock"
    val session: SessionState? = null,
    val pendingApproval: PermissionRequest? = null,
    val error: String? = null
)

enum class ConnectionState {
    DISCONNECTED,
    CONNECTING,
    AUTHENTICATING,
    CONNECTED
}
