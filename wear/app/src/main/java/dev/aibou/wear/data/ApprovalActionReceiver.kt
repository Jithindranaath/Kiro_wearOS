package dev.aibou.wear.data

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Handles Approve / Deny tapped directly on the notification.
 *
 * Routes the decision through the shared client so the answer reaches the Bridge
 * without the app having to come to the foreground. The notification is cleared
 * optimistically; the authoritative confirmation is the Bridge's
 * `permission.resolved` frame, which clears it again and is what the UI trusts.
 */
class ApprovalActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ApprovalNotifier.ACTION_RESPOND) return

        val approvalId = intent.getStringExtra(ApprovalNotifier.EXTRA_APPROVAL_ID) ?: return
        val decision = intent.getStringExtra(ApprovalNotifier.EXTRA_DECISION) ?: return
        if (decision != ApprovalNotifier.DECISION_ALLOW && decision != ApprovalNotifier.DECISION_DENY) {
            return
        }

        // The process may have been reclaimed since the notification was posted,
        // so make sure the socket is up before trying to answer over it.
        AibouRuntime.ensureConnected(context)
        AibouRuntime.client(context).respondToPermission(approvalId, decision)
        ApprovalNotifier(context.applicationContext).clear()
    }
}
