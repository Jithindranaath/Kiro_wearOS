package dev.aibou.wear.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.material.*
import dev.aibou.wear.data.AibouClient
import kotlinx.coroutines.launch

/**
 * Pairing screen — two steps (AC5.1.1):
 *
 *  1. Host entry:  the Bridge address. Defaults to the emulator loopback but is
 *     fully editable so a physical watch can reach a Bridge on the LAN.
 *  2. Code entry:  the 6-digit pairing code printed by the Bridge.
 *
 * The token is persisted in EncryptedSharedPreferences by AibouClient.pair().
 */
@Composable
fun PairScreen(
    client: AibouClient,
    defaultHost: String,
    defaultPort: Int,
    onPaired: () -> Unit
) {
    var step by remember { mutableStateOf(PairStep.HOST) }
    var host by remember { mutableStateOf(defaultHost) }
    var port by remember { mutableStateOf(defaultPort.toString()) }
    var code by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val scope = rememberCoroutineScope()

    when (step) {
        PairStep.HOST -> HostEntry(
            host = host,
            port = port,
            onHostDigit = { d -> if (host.length < 15) host += d },
            onHostDot = { if (host.length < 15) host += "." },
            onHostBackspace = { if (host.isNotEmpty()) host = host.dropLast(1) },
            onPortDigit = { d -> if (port.length < 5) port += d },
            onPortBackspace = { if (port.isNotEmpty()) port = port.dropLast(1) },
            onNext = {
                if (host.isNotBlank() && port.isNotBlank()) {
                    error = null
                    step = PairStep.CODE
                }
            }
        )

        PairStep.CODE -> CodeEntry(
            host = host,
            port = port,
            code = code,
            loading = loading,
            error = error,
            onDigit = { d -> if (code.length < 6) code += d },
            onBackspace = { if (code.isNotEmpty()) code = code.dropLast(1) },
            onBack = {
                error = null
                code = ""
                step = PairStep.HOST
            },
            onSubmit = {
                if (code.length == 6 && !loading) {
                    loading = true
                    error = null
                    val baseUrl = "http://$host:$port"
                    scope.launch {
                        // pair() returns null on success, or a reason to show.
                        val failure = client.pair(baseUrl, code)
                        loading = false
                        if (failure == null) {
                            onPaired()
                        } else {
                            error = failure
                            code = ""
                        }
                    }
                }
            }
        )
    }
}

private enum class PairStep { HOST, CODE }

@Composable
private fun HostEntry(
    host: String,
    port: String,
    onHostDigit: (String) -> Unit,
    onHostDot: () -> Unit,
    onHostBackspace: () -> Unit,
    onPortDigit: (String) -> Unit,
    onPortBackspace: () -> Unit,
    onNext: () -> Unit
) {
    var editingPort by remember { mutableStateOf(false) }

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 28.dp)
    ) {
        item {
            Text(
                text = "Bridge address",
                style = MaterialTheme.typography.caption1,
                color = MaterialTheme.colors.onSurface.copy(alpha = 0.7f)
            )
        }

        item {
            Text(
                text = if (host.isEmpty()) "—" else host,
                style = MaterialTheme.typography.body1,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 2.dp)
            )
        }

        item {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                ToggleChip(
                    checked = !editingPort,
                    onCheckedChange = { editingPort = false },
                    label = { Text("host", fontSize = 11.sp) },
                    toggleControl = {},
                    modifier = Modifier.height(28.dp)
                )
                ToggleChip(
                    checked = editingPort,
                    onCheckedChange = { editingPort = true },
                    label = { Text(":$port", fontSize = 11.sp) },
                    toggleControl = {},
                    modifier = Modifier.height(28.dp)
                )
            }
        }

        item { Spacer(modifier = Modifier.height(6.dp)) }

        item {
            KeyPad(
                showDot = !editingPort,
                onDigit = { if (editingPort) onPortDigit(it) else onHostDigit(it) },
                onDot = onHostDot,
                onBackspace = { if (editingPort) onPortBackspace() else onHostBackspace() },
                onConfirm = onNext
            )
        }

        item {
            Text(
                text = "Emulator: 10.0.2.2\nPhysical watch: your PC's LAN IP",
                style = MaterialTheme.typography.caption3,
                color = MaterialTheme.colors.onSurface.copy(alpha = 0.5f),
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp)
            )
        }
    }
}

@Composable
private fun CodeEntry(
    host: String,
    port: String,
    code: String,
    loading: Boolean,
    error: String?,
    onDigit: (String) -> Unit,
    onBackspace: () -> Unit,
    onBack: () -> Unit,
    onSubmit: () -> Unit
) {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 28.dp)
    ) {
        item {
            Text(
                text = "$host:$port",
                style = MaterialTheme.typography.caption3,
                color = MaterialTheme.colors.onSurface.copy(alpha = 0.5f),
                textAlign = TextAlign.Center
            )
        }

        item {
            Text(
                text = "Pairing code",
                style = MaterialTheme.typography.caption1,
                color = MaterialTheme.colors.onSurface.copy(alpha = 0.7f)
            )
        }

        item {
            Text(
                text = code.padEnd(6, '·'),
                style = MaterialTheme.typography.title2.copy(letterSpacing = 4.sp),
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp)
            )
        }

        if (loading) {
            item {
                CircularProgressIndicator(
                    modifier = Modifier.size(24.dp),
                    strokeWidth = 2.dp
                )
            }
        } else {
            item {
                KeyPad(
                    showDot = false,
                    onDigit = onDigit,
                    onDot = {},
                    onBackspace = onBackspace,
                    onConfirm = onSubmit
                )
            }
        }

        if (error != null) {
            item {
                Text(
                    text = error,
                    color = MaterialTheme.colors.error,
                    style = MaterialTheme.typography.caption2,
                    textAlign = TextAlign.Center
                )
            }
        }

        item {
            CompactChip(
                onClick = onBack,
                label = { Text("← address", fontSize = 11.sp) },
                colors = ChipDefaults.secondaryChipColors(),
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}

/**
 * Shared numeric keypad. Renders a dot key for IP entry and a confirm key.
 */
@Composable
private fun KeyPad(
    showDot: Boolean,
    onDigit: (String) -> Unit,
    onDot: () -> Unit,
    onBackspace: () -> Unit,
    onConfirm: () -> Unit
) {
    val rows = listOf(
        listOf("1", "2", "3"),
        listOf("4", "5", "6"),
        listOf("7", "8", "9")
    )

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                row.forEach { digit ->
                    CompactChip(
                        onClick = { onDigit(digit) },
                        label = { Text(digit, fontSize = 15.sp) },
                        modifier = Modifier.size(38.dp)
                    )
                }
            }
            Spacer(modifier = Modifier.height(4.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            CompactChip(
                onClick = if (showDot) onDot else onBackspace,
                label = { Text(if (showDot) "." else "⌫", fontSize = 14.sp) },
                modifier = Modifier.size(38.dp)
            )
            CompactChip(
                onClick = { onDigit("0") },
                label = { Text("0", fontSize = 15.sp) },
                modifier = Modifier.size(38.dp)
            )
            CompactChip(
                onClick = onConfirm,
                label = { Text("✓", fontSize = 14.sp) },
                colors = ChipDefaults.primaryChipColors(),
                modifier = Modifier.size(38.dp)
            )
        }
        if (showDot) {
            Spacer(modifier = Modifier.height(4.dp))
            CompactChip(
                onClick = onBackspace,
                label = { Text("⌫ delete", fontSize = 11.sp) },
                colors = ChipDefaults.secondaryChipColors(),
                modifier = Modifier.height(30.dp)
            )
        }
    }
}
