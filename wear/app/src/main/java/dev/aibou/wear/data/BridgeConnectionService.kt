package dev.aibou.wear.data

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import dev.aibou.wear.MainActivity

/**
 * Keeps the Bridge connection alive while the app is not on screen.
 *
 * Measured behaviour without this: within about a minute of leaving the app,
 * ActivityManager froze the process ("sync unfroze ... for 10" in logcat), the
 * socket missed its heartbeats, the Bridge dropped the client, and a frozen
 * process could not reconnect. Approvals then never reached the wrist at all —
 * the agent simply sat blocked.
 *
 * A foreground service is the only reliable way to hold a live socket on Wear.
 * The cost is an ongoing notification, which is a fair trade: it is also the
 * honest signal that the watch is listening.
 */
class BridgeConnectionService : Service() {

    override fun onCreate() {
        super.onCreate()
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Bridge connection",
            // Silent and collapsed: this must not compete with real approvals.
            NotificationManager.IMPORTANCE_MIN,
        ).apply { description = "Keeps Aibou listening for approvals" }
        NotificationManagerCompat.from(this).createNotificationChannel(channel)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // A rejected foreground type throws, and an uncaught throw here takes the
        // whole app down with it — including the UI that can still show approvals
        // while it is open. Degrade instead: give up the service and let the app
        // keep working in the foreground.
        val started = runCatching {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                buildNotification(),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                } else {
                    0
                },
            )
        }.isSuccess

        if (!started) {
            stopSelf()
            return START_NOT_STICKY
        }

        AibouRuntime.ensureConnected(applicationContext)

        // Restart if the system reclaims us; a dropped connection means missed
        // approvals, which is the one failure this app cannot tolerate.
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun buildNotification() = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
        .setContentTitle("Aibou is listening")
        .setContentText("Approvals will appear here")
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setOngoing(true)
        .setSilent(true)
        .setContentIntent(
            PendingIntent.getActivity(
                this,
                0,
                Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            ),
        )
        .build()

    companion object {
        private const val CHANNEL_ID = "aibou_connection"
        private const val NOTIFICATION_ID = 1002

        /** Start the service if the watch is paired. Safe to call repeatedly. */
        fun start(context: Context) {
            if (!AibouRuntime.tokenStore(context).isPaired) return
            val intent = Intent(context, BridgeConnectionService::class.java)
            runCatching { context.startForegroundService(intent) }
        }

        fun stop(context: Context) {
            runCatching { context.stopService(Intent(context, BridgeConnectionService::class.java)) }
        }
    }
}
