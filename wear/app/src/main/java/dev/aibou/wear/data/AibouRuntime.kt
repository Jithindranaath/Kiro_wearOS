package dev.aibou.wear.data

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers

/**
 * Process-wide holder for the single Bridge connection.
 *
 * The client used to be owned by MainActivity and torn down in onDestroy, which
 * meant leaving the app severed the WebSocket: an approval raised while the
 * developer was on the watch face never arrived at all. Approvals are the whole
 * point of the app, so the connection outlives any one screen.
 *
 * Deliberately not a foreground service. That would keep the process alive
 * indefinitely at the cost of a permanent ongoing notification; this keeps the
 * connection for as long as the process lives, which covers backgrounding and a
 * dark screen. If the system reclaims the process the client reconnects on next
 * launch, and the Bridge replays anything still pending on subscribe.
 */
object AibouRuntime {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @Volatile
    private var instance: AibouClient? = null

    @Volatile
    private var tokenStoreInstance: TokenStore? = null

    /** The shared client, created on first use. */
    fun client(context: Context): AibouClient =
        instance ?: synchronized(this) {
            instance ?: AibouClient(
                tokenStore = tokenStore(context),
                scope = scope,
                notifier = ApprovalNotifier(context.applicationContext),
            ).also { instance = it }
        }

    fun tokenStore(context: Context): TokenStore =
        tokenStoreInstance ?: synchronized(this) {
            tokenStoreInstance ?: TokenStore(context.applicationContext).also {
                tokenStoreInstance = it
            }
        }

    /** Connect if paired and not already connected. Safe to call repeatedly. */
    fun ensureConnected(context: Context) {
        val client = client(context)
        if (tokenStore(context).isPaired &&
            client.state.value.connectionState == ConnectionState.DISCONNECTED
        ) {
            client.connect()
        }
    }
}
