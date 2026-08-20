package dev.aibou.wear.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.*
import dev.aibou.wear.data.ConnectionState
import dev.aibou.wear.data.SessionState
import dev.aibou.wear.data.UiState
import kotlinx.coroutines.delay

/**
 * Status screen — session name, status, elapsed time (AC5.1.3).
 * Also shows mock badge when in mock mode.
 */
@Composable
fun StatusScreen(
    uiState: UiState,
    onNavigateToApproval: () -> Unit
) {
    val session = uiState.session
    val connectionState = uiState.connectionState

    // Timer for elapsed time display
    var elapsedText by remember { mutableStateOf("") }
    LaunchedEffect(session?.lastActivity) {
        while (true) {
            val lastActivity = session?.lastActivity ?: 0L
            if (lastActivity > 0) {
                val elapsed = System.currentTimeMillis() - lastActivity
                elapsedText = formatElapsed(elapsed)
            } else {
                elapsedText = "--:--"
            }
            delay(1000)
        }
    }

    // Navigate to approval when one arrives
    LaunchedEffect(uiState.pendingApproval) {
        if (uiState.pendingApproval != null) {
            onNavigateToApproval()
        }
    }

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(16.dp)
    ) {
        // Mock mode badge
        if (uiState.mode == "mock") {
            item {
                Chip(
                    onClick = {},
                    label = { Text("MOCK", style = MaterialTheme.typography.caption3) },
                    colors = ChipDefaults.chipColors(
                        backgroundColor = Color(0xFFD97706) // Amber-600
                    ),
                    modifier = Modifier.height(24.dp)
                )
            }
        }

        // Connection state
        item {
            val (statusColor, statusLabel) = when (connectionState) {
                ConnectionState.CONNECTED -> Color(0xFF10B981) to "Connected"
                ConnectionState.CONNECTING -> Color(0xFFFBBF24) to "Connecting..."
                ConnectionState.AUTHENTICATING -> Color(0xFFFBBF24) to "Authenticating..."
                ConnectionState.DISCONNECTED -> Color(0xFFEF4444) to "Disconnected"
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
                modifier = Modifier.fillMaxWidth()
            ) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .padding(end = 4.dp)
                ) {
                    androidx.compose.foundation.Canvas(modifier = Modifier.fillMaxSize()) {
                        drawCircle(color = statusColor)
                    }
                }
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = statusLabel,
                    style = MaterialTheme.typography.caption2,
                    color = MaterialTheme.colors.onSurface.copy(alpha = 0.7f)
                )
            }
        }

        item { Spacer(modifier = Modifier.height(12.dp)) }

        // Session info
        if (session != null) {
            item {
                val cwdBasename = session.cwd.split("/", "\\").lastOrNull() ?: session.cwd
                Text(
                    text = cwdBasename,
                    style = MaterialTheme.typography.title3,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                Spacer(modifier = Modifier.height(8.dp))
            }

            // Status with color
            item {
                val (color, icon) = when (session.status) {
                    "idle" -> Color(0xFF6B7280) to "⏸"
                    "working" -> Color(0xFF3B82F6) to "⚡"
                    "awaiting_permission" -> Color(0xFFF59E0B) to "🔐"
                    "awaiting_input" -> Color(0xFF8B5CF6) to "💬"
                    "error" -> Color(0xFFEF4444) to "❌"
                    "disconnected" -> Color(0xFF374151) to "🔌"
                    else -> Color(0xFF6B7280) to "❓"
                }

                Text(
                    text = "$icon ${session.status.replace("_", " ")}",
                    style = MaterialTheme.typography.body1,
                    color = color,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // Inferred marker
            if (session.statusSource == "inferred") {
                item {
                    Text(
                        text = "(inferred)",
                        style = MaterialTheme.typography.caption3,
                        color = Color(0xFFFBBF24),
                        textAlign = TextAlign.Center
                    )
                }
            }

            // Elapsed time
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = elapsedText,
                    style = MaterialTheme.typography.caption1,
                    color = MaterialTheme.colors.onSurface.copy(alpha = 0.5f),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // Pending approvals badge
            if (session.pendingApprovals > 0) {
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Chip(
                        onClick = onNavigateToApproval,
                        label = { Text("${session.pendingApprovals} pending approval(s)") },
                        colors = ChipDefaults.chipColors(
                            backgroundColor = Color(0xFFF59E0B)
                        )
                    )
                }
            }
        } else {
            item {
                Text(
                    text = "No active session",
                    style = MaterialTheme.typography.body2,
                    color = MaterialTheme.colors.onSurface.copy(alpha = 0.5f),
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}

private fun formatElapsed(ms: Long): String {
    val totalSeconds = ms / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return if (minutes > 59) {
        "${minutes / 60}h ${minutes % 60}m"
    } else {
        "${minutes}m ${seconds}s"
    }
}
