package dev.aibou.wear.ui

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.*
import dev.aibou.wear.data.AibouClient
import kotlinx.coroutines.delay

/**
 * Voice screen — capture a prompt via RecognizerIntent and show the transcript
 * for confirmation before sending (AC5.2.1).
 *
 * The screen is only reachable when speech recognition is available; the caller
 * removes the route entirely otherwise (AC5.2.2).
 */
@Composable
fun VoiceScreen(
    client: AibouClient,
    onDone: () -> Unit,
) {
    var phase by remember { mutableStateOf(VoicePhase.LISTENING) }
    var transcript by remember { mutableStateOf<String?>(null) }

    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val spoken = if (result.resultCode == Activity.RESULT_OK) {
            result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
                ?.trim()
        } else {
            null
        }

        if (spoken.isNullOrEmpty()) {
            // Cancelled or nothing recognised — go straight back.
            onDone()
        } else {
            transcript = spoken
            phase = VoicePhase.CONFIRMING
        }
    }

    // Launch recognition once, on first composition.
    LaunchedEffect(Unit) {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
            )
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak your prompt")
        }
        runCatching { speechLauncher.launch(intent) }.onFailure { onDone() }
    }

    // Auto-dismiss shortly after sending. Declared here, at composable scope —
    // not inside a lazy-list item scope, which is not a @Composable context.
    LaunchedEffect(phase) {
        if (phase == VoicePhase.SENT) {
            delay(1200)
            onDone()
        }
    }

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 28.dp),
    ) {
        when (phase) {
            VoicePhase.LISTENING -> {
                item {
                    Text(
                        text = "Listening…",
                        style = MaterialTheme.typography.body1,
                        textAlign = TextAlign.Center,
                    )
                }
                item {
                    Spacer(modifier = Modifier.height(10.dp))
                    CircularProgressIndicator(
                        modifier = Modifier.size(32.dp),
                        strokeWidth = 3.dp,
                    )
                }
            }

            VoicePhase.CONFIRMING -> {
                item {
                    Text(
                        text = "Send this?",
                        style = MaterialTheme.typography.caption1,
                        color = MaterialTheme.colors.onSurface.copy(alpha = 0.7f),
                    )
                }
                item {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "\u201C${transcript.orEmpty()}\u201D",
                        style = MaterialTheme.typography.body1,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(horizontal = 6.dp),
                    )
                }
                item {
                    Spacer(modifier = Modifier.height(12.dp))
                    Chip(
                        onClick = {
                            transcript?.let { client.sendPrompt(it) }
                            phase = VoicePhase.SENT
                        },
                        label = {
                            Text("Send", textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                        },
                        colors = ChipDefaults.primaryChipColors(),
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    )
                }
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Chip(
                        onClick = onDone,
                        label = {
                            Text("Cancel", textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                        },
                        colors = ChipDefaults.secondaryChipColors(),
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    )
                }
            }

            VoicePhase.SENT -> {
                item {
                    Text(
                        text = "Sent",
                        style = MaterialTheme.typography.body1,
                        color = MaterialTheme.colors.primary,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}

private enum class VoicePhase { LISTENING, CONFIRMING, SENT }
