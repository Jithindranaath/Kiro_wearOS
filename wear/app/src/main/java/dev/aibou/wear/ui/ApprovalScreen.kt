package dev.aibou.wear.ui

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.WindowManager
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.*
import dev.aibou.wear.data.AibouClient
import dev.aibou.wear.data.PermissionRequest

/**
 * Approval screen — vibrate + wake screen, ≥48dp Approve/Deny buttons (AC5.1.4).
 * Dismisses when resolved by another client (AC5.1.5).
 */
@Composable
fun ApprovalScreen(
    approval: PermissionRequest?,
    client: AibouClient,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current

    // Vibrate and wake screen on arrival (AC5.1.4)
    LaunchedEffect(approval?.approvalId) {
        if (approval != null) {
            vibrateForRisk(context, approval.riskTier)
            wakeScreen(context)
        }
    }

    // Dismiss when resolved externally (AC5.1.5)
    LaunchedEffect(approval) {
        if (approval == null) {
            onDismiss()
        }
    }

    if (approval == null) {
        // Already resolved
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "✓ Resolved",
                style = MaterialTheme.typography.body1,
                color = MaterialTheme.colors.primary
            )
        }
        return
    }

    val riskColor = when (approval.riskTier) {
        "high" -> Color(0xFFEF4444)
        "medium" -> Color(0xFFF59E0B)
        else -> Color(0xFF10B981)
    }

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(horizontal = 8.dp, vertical = 24.dp)
    ) {
        // Risk indicator
        item {
            Text(
                text = when (approval.riskTier) {
                    "high" -> "⚠️ HIGH RISK"
                    "medium" -> "⚡ APPROVAL"
                    else -> "ℹ️ APPROVAL"
                },
                style = MaterialTheme.typography.caption1,
                color = riskColor,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        }

        item { Spacer(modifier = Modifier.height(8.dp)) }

        // Summary — the key glanceable info (≤80 chars, ≥16sp, AC5.1.4)
        item {
            Text(
                text = approval.summary,
                style = MaterialTheme.typography.body1.copy(fontSize = 16.sp),
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp),
                maxLines = 3
            )
        }

        item { Spacer(modifier = Modifier.height(16.dp)) }

        // Approve button — full width, ≥48dp tall (AC5.1.4)
        item {
            Chip(
                onClick = {
                    client.respondToPermission(approval.approvalId, "allow")
                },
                label = { Text("✓ Approve", textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) },
                colors = ChipDefaults.chipColors(backgroundColor = Color(0xFF059669)),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
            )
        }

        item { Spacer(modifier = Modifier.height(8.dp)) }

        // Deny button — full width, ≥48dp tall (AC5.1.4)
        item {
            Chip(
                onClick = {
                    client.respondToPermission(approval.approvalId, "deny")
                },
                label = { Text("✗ Deny", textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) },
                colors = ChipDefaults.chipColors(backgroundColor = Color(0xFFDC2626)),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
            )
        }
    }
}

/**
 * Vibrate with intensity based on risk tier.
 * Gentle = low risk, Strong = high risk (architecture constraint).
 */
private fun vibrateForRisk(context: Context, riskTier: String) {
    val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val manager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        manager.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }

    val effect = when (riskTier) {
        "high" -> VibrationEffect.createWaveform(longArrayOf(0, 200, 100, 200, 100, 300), -1)
        "medium" -> VibrationEffect.createWaveform(longArrayOf(0, 150, 100, 150), -1)
        else -> VibrationEffect.createOneShot(100, VibrationEffect.DEFAULT_AMPLITUDE)
    }
    vibrator.vibrate(effect)
}

/**
 * Wake the screen to show the approval (AC5.1.4).
 */
@Suppress("DEPRECATION")
private fun wakeScreen(context: Context) {
    try {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        val wakeLock = powerManager.newWakeLock(
            android.os.PowerManager.FULL_WAKE_LOCK or
                android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or
                android.os.PowerManager.ON_AFTER_RELEASE,
            "aibou:approval_wake"
        )
        wakeLock.acquire(5000) // 5 seconds
    } catch (_: Exception) {
        // Non-critical if wake fails
    }
}
