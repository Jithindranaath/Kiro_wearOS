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
import androidx.wear.compose.material.*
import dev.aibou.wear.data.AibouClient

/**
 * Voice screen — capture prompt via RecognizerIntent, show transcript
 * for confirmation before sending (AC5.2.1).
 * Hidden if speech recognition is unavailable (AC5.2.2).
 */
@Composable
fun VoiceScreen(
    client: AibouClient,
    onDone: () -> Unit
) {
    var transcript by remember { mutableStateOf<String?>(null) }
    var sent by remember { mutableStateOf(false) }

    val speechLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val matches = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            transcript = matches?.firstOrNull()
        }
    }

    // Launch speech recognition immediately
    LaunchedEffect(Unit) {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak your prompt to the agent")
        }
        try {
            speechLauncher.launch(intent)
        } catch (_: Exception) {
            // Speech recognition unavailable — screen will show nothing useful
            onDone()
        }
    }

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(16.dp)
    ) {
        if (transcript == null) {
            item {
                Text(
                    text = "🎤 Listening...",
                    style = MaterialTheme.typography.body1,
                    textAlign = TextAlign.Center
                )
            }
            item {
                CircularProgressIndicator(
                    modifier = Modifier.size(32.dp),
                    strokeWidth = 3.dp
                )
            }
        } else if (!sent) {
            // Show transcript for confirmation (AC5.2.1)
            item {
                Text(
                    text = "Send this?",
                    style = MaterialTheme.typography.caption1,
                    color = MaterialTheme.colors.onSurface.copy(alpha = 0.7f)
                )
            }

            item {
                Spacer(modifier = Modifier.height(8.dp))
            }

            item {
                Text(
                    text = "\"${transcript}\"",
                    style = MaterialTheme.typography.body1,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 8.dp)
                )
            }

            item {
                Spacer(modifier = Modifier.height(16.dp))
            }

            item {
                Chip(
                    onClick = {
                        client.sendPrompt(transcript!!)
                        sent = true
                    },
                    label = { Text("✓ Send") },
                    colors = ChipDefaults.primaryChipColors(),
                    modifier = Modifier.fillMaxWidth().height(48.dp)
                )
            }

            item {
                Spacer(modifier = Modifier.height(8.dp))
            }

            item {
                Chip(
                    onClick = onDone,
                    label = { Text("✗ Cancel") },
                    colors = ChipDefaults.secondaryChipColors(),
                    modifier = Modifier.fillMaxWidth().height(48.dp)
                )
            }
        } else {
            item {
                Text(
                    text = "✓ Sent!",
                    style = MaterialTheme.typography.body1,
                    color = MaterialTheme.colors.primary,
                    textAlign = TextAlign.Center
                )
            }
            // Auto-navigate back after short delay
            LaunchedEffect(Unit) {
                kotlinx.coroutines.delay(1500)
                onDone()
            }
        }
    }
}
