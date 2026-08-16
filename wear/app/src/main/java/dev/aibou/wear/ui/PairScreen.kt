package dev.aibou.wear.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.*
import dev.aibou.wear.data.AibouClient

/**
 * Pairing screen — 6-digit keypad entry (AC5.1.1).
 * Pairs by entering the code shown on the Bridge terminal.
 */
@Composable
fun PairScreen(
    client: AibouClient,
    defaultUrl: String,
    onPaired: () -> Unit
) {
    var code by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 32.dp)
    ) {
        item {
            Text(
                text = "⛩️ Aibou",
                style = MaterialTheme.typography.title2,
                textAlign = TextAlign.Center
            )
        }

        item {
            Spacer(modifier = Modifier.height(8.dp))
        }

        item {
            Text(
                text = "Enter pairing code",
                style = MaterialTheme.typography.body2,
                color = MaterialTheme.colors.onSurface.copy(alpha = 0.7f),
                textAlign = TextAlign.Center
            )
        }

        item {
            Spacer(modifier = Modifier.height(12.dp))
        }

        // Code display
        item {
            Text(
                text = if (code.isEmpty()) "------" else code.padEnd(6, '-'),
                style = MaterialTheme.typography.display3.copy(
                    letterSpacing = 4.sp
                ),
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        }

        item {
            Spacer(modifier = Modifier.height(12.dp))
        }

        // Number pad (3x3 + 0 + actions)
        item {
            NumberPad(
                onDigit = { digit ->
                    if (code.length < 6) {
                        code += digit
                    }
                },
                onBackspace = {
                    if (code.isNotEmpty()) {
                        code = code.dropLast(1)
                    }
                },
                onSubmit = {
                    if (code.length == 6 && !loading) {
                        loading = true
                        error = null
                        kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
                            val success = client.pair(defaultUrl, code)
                            loading = false
                            if (success) {
                                onPaired()
                            } else {
                                error = "Invalid code"
                                code = ""
                            }
                        }
                    }
                }
            )
        }

        if (error != null) {
            item {
                Text(
                    text = error!!,
                    color = MaterialTheme.colors.error,
                    style = MaterialTheme.typography.caption3,
                    textAlign = TextAlign.Center
                )
            }
        }

        if (loading) {
            item {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    strokeWidth = 2.dp
                )
            }
        }
    }
}

@Composable
private fun NumberPad(
    onDigit: (String) -> Unit,
    onBackspace: () -> Unit,
    onSubmit: () -> Unit
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        for (row in listOf(listOf("1","2","3"), listOf("4","5","6"), listOf("7","8","9"))) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for (digit in row) {
                    CompactChip(
                        onClick = { onDigit(digit) },
                        label = { Text(digit, fontSize = 16.sp) },
                        modifier = Modifier.size(40.dp)
                    )
                }
            }
            Spacer(modifier = Modifier.height(4.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            CompactChip(
                onClick = onBackspace,
                label = { Text("⌫", fontSize = 14.sp) },
                modifier = Modifier.size(40.dp)
            )
            CompactChip(
                onClick = { onDigit("0") },
                label = { Text("0", fontSize = 16.sp) },
                modifier = Modifier.size(40.dp)
            )
            CompactChip(
                onClick = onSubmit,
                label = { Text("✓", fontSize = 14.sp) },
                modifier = Modifier.size(40.dp),
                colors = ChipDefaults.chipColors(
                    backgroundColor = MaterialTheme.colors.primary
                )
            )
        }
    }
}
