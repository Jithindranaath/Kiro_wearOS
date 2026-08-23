package dev.aibou.wear.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
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
    onNavigateToApproval: () -> Unit,
    onNavigateToActivity: () -> Unit = {},
    onNavigateToAccount: () -> Unit = {}
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

    // Lay the list out from the top instead of auto-centring it.
    //
    // ScalingLazyColumn centres item index 1 by default, which was tuned against
    // a 454px screen with no session on it. On a 384px round watch the taller
    // session block pushed the connection header clean off the top, so the app
    // opened without saying whether it was connected at all. Auto-centring item 0
    // instead only moved the problem: half the viewport became empty padding and
    // the activity preview fell off the bottom.
    //
    // With autoCentering disabled the header starts at the top edge and every
    // later item flows into the space below it, which is what a status screen
    // wants — nothing here needs to sit under a rotary detent.
    val listState = rememberScalingLazyListState(
        initialCenterItemIndex = 0,
        initialCenterItemScrollOffset = 0,
    )

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = listState,
        autoCentering = null,
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)
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

        // A missing Kiro sign-in stops all work, so it outranks everything else
        // on the screen. Connection state is meaningless if the agent cannot act.
        val account = uiState.account
        if (account != null && (account.state == "unauthenticated" || account.state == "unavailable")) {
            item {
                Chip(
                    onClick = onNavigateToAccount,
                    label = {
                        Text(
                            text = if (account.state == "unauthenticated") {
                                "Kiro not signed in"
                            } else {
                                "Kiro account unknown"
                            },
                            style = MaterialTheme.typography.caption2,
                        )
                    },
                    colors = ChipDefaults.chipColors(backgroundColor = Color(0xFFB45309)),
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }

        // Connection state, with the signed-in account directly beneath it.
        //
        // Both live in one list item on purpose. ScalingLazyColumn auto-centres
        // item index 1, so adding a separate item for the account shifted the
        // whole list and dropped the connection row out of the viewport
        // entirely. Keeping them together means the header cannot be split, and
        // both stay visible without scrolling on a 454px screen.
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
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onNavigateToAccount() }
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
                    // One text node carrying both facts. Sibling composables here
                    // were dropped from the viewport by the scaling list's
                    // auto-centering, and a status header that can lose half of
                    // itself depending on item count is not worth the elegance.
                    text = if (account != null && account.isSignedIn) {
                        "$statusLabel · ${account.label}"
                    } else {
                        statusLabel
                    },
                    style = MaterialTheme.typography.caption3,
                    color = MaterialTheme.colors.onSurface.copy(alpha = 0.7f),
                    textAlign = TextAlign.Center,
                    maxLines = 2
                )
            }
        }

        item { Spacer(modifier = Modifier.height(10.dp)) }

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

            // What the agent is doing right now — the newest line only, so the
            // status screen stays glanceable. Tap through for the full feed.
            val latest = uiState.latestActivity
            if (latest != null) {
                item {
                    Spacer(modifier = Modifier.height(10.dp))
                    Chip(
                        onClick = onNavigateToActivity,
                        label = {
                            Text(
                                text = "${latest.glyph} ${latest.text.replace('\n', ' ').trim()}",
                                style = MaterialTheme.typography.caption2,
                                maxLines = 2
                            )
                        },
                        secondaryLabel = {
                            Text(
                                text = "activity",
                                style = MaterialTheme.typography.caption3,
                                color = MaterialTheme.colors.onSurface.copy(alpha = 0.5f)
                            )
                        },
                        colors = ChipDefaults.secondaryChipColors(),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            } else {
                item {
                    Spacer(modifier = Modifier.height(10.dp))
                    CompactChip(
                        onClick = onNavigateToActivity,
                        label = { Text("Activity", style = MaterialTheme.typography.caption2) },
                        colors = ChipDefaults.secondaryChipColors()
                    )
                }
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

/**
 * Elapsed time since the Bridge last saw activity, or `--:--` when it cannot be
 * known.
 *
 * `lastActivity` is stamped on the Bridge's clock but subtracted from the
 * watch's, so the two must agree for the result to mean anything. They often do
 * not: a Wear emulator boots with a stale clock and no time source, and a real
 * watch that has been off the network drifts. The difference then comes out
 * negative, which used to render as "-253762m -18s".
 *
 * A wrong number is worse than no number, so skew is reported as unknown rather
 * than displayed. Sub-second jitter is treated as zero, since that is ordinary
 * round-trip noise rather than a broken clock.
 */
private fun formatElapsed(ms: Long): String {
    if (ms < -1000) return "--:--"
    val totalSeconds = (if (ms < 0) 0 else ms) / 1000
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return if (minutes > 59) {
        "${minutes / 60}h ${minutes % 60}m"
    } else {
        "${minutes}m ${seconds}s"
    }
}
