package dev.aibou.wear.data

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dev.aibou.wear.MainActivity

/**
 * Surfaces a pending approval as a Wear notification so it reaches the developer
 * when the app is not on screen.
 *
 * Without this the approval only existed inside a running Compose screen: the
 * Bridge would hold the agent blocked while the watch showed a clock face and
 * said nothing. The notification carries Approve and Deny actions, so answering
 * takes one tap from wherever the developer is.
 *
 * Nothing here invents content — the title and body are the summary and command
 * the Bridge actually sent.
 */
class ApprovalNotifier(private val context: Context) {

    private val manager = NotificationManagerCompat.from(context)

    init {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Approvals",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Kiro is asking permission to do something"
            enableVibration(true)
            setShowBadge(true)
        }
        manager.createNotificationChannel(channel)
    }

    fun show(approval: PermissionRequest) {
        // Checked inline rather than in a helper so the guard is verifiable at the
        // call site. POST_NOTIFICATIONS only became a runtime permission in API 33;
        // below that, posting needs no grant, and asking would report it denied.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        if (!manager.areNotificationsEnabled()) return

        val command = approval.toolInput
            ?.let { runCatching { it.toString() }.getOrNull() }
            ?.takeIf { it.length in 1..300 }

        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(riskLabel(approval.riskTier))
            .setContentText(approval.summary)
            .setStyle(NotificationCompat.BigTextStyle().bigText(command ?: approval.summary))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(Notification.CATEGORY_CALL) // demands an answer now
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .addAction(
                android.R.drawable.ic_menu_send,
                "Approve",
                actionIntent(approval.approvalId, DECISION_ALLOW),
            )
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "Deny",
                actionIntent(approval.approvalId, DECISION_DENY),
            )
            .build()

        try {
            manager.notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // The grant can be revoked between the check above and here. Losing the
            // notification is bad but survivable; crashing the app would mean the
            // in-app approval screen is lost too.
        }
    }

    /** Clear the notification once the approval is answered, by anyone. */
    fun clear() {
        try {
            manager.cancel(NOTIFICATION_ID)
        } catch (_: SecurityException) {
            // Nothing to do; a stale notification is preferable to a crash.
        }
    }

    private fun riskLabel(riskTier: String): String = when (riskTier) {
        "high" -> "High risk — approve?"
        "medium" -> "Kiro needs approval"
        else -> "Kiro needs approval"
    }

    private fun actionIntent(approvalId: String, decision: String): PendingIntent {
        val intent = Intent(context, ApprovalActionReceiver::class.java).apply {
            action = ACTION_RESPOND
            putExtra(EXTRA_APPROVAL_ID, approvalId)
            putExtra(EXTRA_DECISION, decision)
        }
        return PendingIntent.getBroadcast(
            context,
            // Distinct request codes, or the two actions collapse into one.
            decision.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        const val CHANNEL_ID = "aibou_approvals"
        const val NOTIFICATION_ID = 1001
        const val ACTION_RESPOND = "dev.aibou.wear.RESPOND"
        const val EXTRA_APPROVAL_ID = "approvalId"
        const val EXTRA_DECISION = "decision"
        const val DECISION_ALLOW = "allow"
        const val DECISION_DENY = "deny"
    }
}
