package dev.aibou.wear.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.*
import dev.aibou.wear.data.AccountInfo

/**
 * Kiro account screen — who the agent runs as, and sign-out.
 *
 * Sign-in is not offered here on purpose: Kiro's OAuth device flow needs a
 * browser and a typed code, which a watch cannot reasonably provide. The screen
 * says where to do it instead of presenting a button that cannot work.
 *
 * Sign-out is behind a confirm step because it stops the agent working entirely.
 */
@Composable
fun AccountScreen(
    account: AccountInfo?,
    onSignOut: () -> Unit,
    onRefresh: () -> Unit
) {
    var confirming by remember { mutableStateOf(false) }

    // Ask the Bridge for a fresh reading whenever this screen is opened.
    LaunchedEffect(Unit) { onRefresh() }

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 26.dp)
    ) {
        item {
            Text(
                text = "Kiro account",
                style = MaterialTheme.typography.caption1,
                color = MaterialTheme.colors.onSurface.copy(alpha = 0.7f)
            )
        }

        if (account == null) {
            item {
                Text(
                    text = "Checking…",
                    style = MaterialTheme.typography.caption2,
                    color = MaterialTheme.colors.onSurface.copy(alpha = 0.5f),
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
            return@ScalingLazyColumn
        }

        item {
            Text(
                text = account.label,
                style = MaterialTheme.typography.body2,
                color = when (account.state) {
                    "authenticated" -> MaterialTheme.colors.onSurface
                    "unauthenticated" -> Color(0xFFF59E0B)
                    "mock" -> Color(0xFFD97706)
                    "unavailable" -> Color(0xFFEF4444)
                    else -> Color(0xFFFBBF24)
                },
                textAlign = TextAlign.Center,
                maxLines = 2,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp)
            )
        }

        // Provider only when the CLI actually reported one.
        val detail = listOfNotNull(account.provider, account.accountType).joinToString(" · ")
        if (detail.isNotEmpty() && account.isSignedIn) {
            item {
                Text(
                    text = detail,
                    style = MaterialTheme.typography.caption3,
                    color = MaterialTheme.colors.onSurface.copy(alpha = 0.5f)
                )
            }
        }

        when (account.state) {
            "authenticated" -> {
                if (!confirming) {
                    item {
                        Chip(
                            onClick = { confirming = true },
                            label = {
                                Text("Sign out", textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                            },
                            colors = ChipDefaults.secondaryChipColors(),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp)
                                .padding(top = 10.dp)
                        )
                    }
                } else {
                    item {
                        Text(
                            text = "Sign out? The agent stops working until you sign in again.",
                            style = MaterialTheme.typography.caption3,
                            color = Color(0xFFF59E0B),
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 8.dp)
                        )
                    }
                    item {
                        Chip(
                            onClick = {
                                confirming = false
                                onSignOut()
                            },
                            label = {
                                Text("Confirm", textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                            },
                            colors = ChipDefaults.chipColors(backgroundColor = Color(0xFFDC2626)),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp)
                                .padding(top = 6.dp)
                        )
                    }
                    item {
                        CompactChip(
                            onClick = { confirming = false },
                            label = { Text("Keep signed in", fontSize = 11.sp) },
                            colors = ChipDefaults.secondaryChipColors(),
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                }

                item {
                    Text(
                        text = "Stays signed in until you sign out here.",
                        style = MaterialTheme.typography.caption3,
                        color = MaterialTheme.colors.onSurface.copy(alpha = 0.4f),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            }

            "unauthenticated", "unavailable" -> {
                item {
                    Text(
                        // Honest about where the flow has to happen.
                        text = "Sign in from the Aibou web app on your computer, or run: kiro-cli login",
                        style = MaterialTheme.typography.caption3,
                        color = MaterialTheme.colors.onSurface.copy(alpha = 0.6f),
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            }

            "authenticating" -> {
                item {
                    Text(
                        text = account.userCode ?: "Waiting for confirmation…",
                        style = MaterialTheme.typography.body2,
                        color = MaterialTheme.colors.onSurface,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
                item {
                    Text(
                        text = account.verificationUri ?: "Finish in your browser",
                        style = MaterialTheme.typography.caption3,
                        color = MaterialTheme.colors.onSurface.copy(alpha = 0.5f),
                        textAlign = TextAlign.Center,
                        maxLines = 2
                    )
                }
            }

            else -> {
                account.reason?.let { reason ->
                    item {
                        Text(
                            text = reason,
                            style = MaterialTheme.typography.caption3,
                            color = MaterialTheme.colors.onSurface.copy(alpha = 0.6f),
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 8.dp)
                        )
                    }
                }
            }
        }
    }
}
