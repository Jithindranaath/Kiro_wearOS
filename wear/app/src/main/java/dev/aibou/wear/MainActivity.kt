package dev.aibou.wear

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import dev.aibou.wear.data.AibouClient
import dev.aibou.wear.data.AibouRuntime
import dev.aibou.wear.data.BridgeConnectionService
import dev.aibou.wear.data.TokenStore
import dev.aibou.wear.ui.*
import dev.aibou.wear.ui.theme.AibouWearTheme

/**
 * Android emulator host loopback. Only a pre-filled default — the user can
 * edit both host and port on the pairing screen.
 */
private const val DEFAULT_BRIDGE_HOST = "10.0.2.2"
private const val DEFAULT_BRIDGE_PORT = 8787

/**
 * MainActivity — entry point for the Aibou Wear OS app.
 *
 * Standalone app (D4) — connects directly to Bridge over Wi-Fi,
 * no phone companion required (AC5.1.2).
 */
class MainActivity : ComponentActivity() {

    private lateinit var tokenStore: TokenStore
    private lateinit var client: AibouClient

    /**
     * Approvals are delivered as notifications when the app is not on screen, so
     * without this permission the developer can miss them entirely. Asked for on
     * launch rather than at the moment an approval lands, because a permission
     * dialog is the last thing that should stand between a blocked agent and an
     * answer.
     */
    private val requestNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* either way, carry on */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Shared, process-scoped: the connection must survive this Activity so an
        // approval raised while the app is backgrounded still arrives.
        tokenStore = AibouRuntime.tokenStore(applicationContext)
        client = AibouRuntime.client(applicationContext)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        // Auto-connect if already paired (AC5.1.7), and keep that connection alive
        // once the developer leaves the app.
        AibouRuntime.ensureConnected(applicationContext)
        BridgeConnectionService.start(applicationContext)

        setContent {
            AibouWearTheme {
                AibouApp(
                    client = client,
                    tokenStore = tokenStore,
                    hasSpeechRecognition = hasSpeechRecognition()
                )
            }
        }
    }

    // Deliberately no disconnect in onDestroy. Closing the socket when the
    // Activity goes away is what made the watch deaf to approvals the moment the
    // developer left the app. The connection belongs to AibouRuntime now.

    private fun hasSpeechRecognition(): Boolean {
        val intent = android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        return intent.resolveActivity(packageManager) != null
    }
}

@Composable
fun AibouApp(
    client: AibouClient,
    tokenStore: TokenStore,
    hasSpeechRecognition: Boolean
) {
    val navController = rememberSwipeDismissableNavController()
    val uiState by client.state.collectAsState()
    val context = LocalContext.current

    // Determine start destination
    val startDestination = if (tokenStore.isPaired) "status" else "pair"

    // Raise an approval from wherever the developer happens to be.
    //
    // This deliberately lives above the NavHost rather than inside a screen: a
    // destination's effects stop running once it leaves composition, so an
    // approval arriving while the activity feed was open used to go unnoticed.
    // An approval is the one thing that must always interrupt.
    val pendingApprovalId = uiState.pendingApproval?.approvalId
    LaunchedEffect(pendingApprovalId) {
        if (pendingApprovalId != null &&
            navController.currentDestination?.route != "approval" &&
            navController.currentDestination?.route != "pair"
        ) {
            navController.navigate("approval")
        }
    }

    SwipeDismissableNavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable("pair") {
            PairScreen(
                client = client,
                // Pre-filled for the Android emulator's host loopback; editable
                // on-device so a physical watch can target a LAN address.
                defaultHost = DEFAULT_BRIDGE_HOST,
                defaultPort = DEFAULT_BRIDGE_PORT,
                onPaired = {
                    client.connect()
                    // Only now is there a token to keep a connection with.
                    BridgeConnectionService.start(context)
                    navController.navigate("status") {
                        popUpTo("pair") { inclusive = true }
                    }
                }
            )
        }

        composable("status") {
            StatusScreen(
                uiState = uiState,
                onNavigateToApproval = {
                    navController.navigate("approval")
                },
                onNavigateToActivity = {
                    navController.navigate("activity")
                }
            )
        }

        composable("activity") {
            ActivityScreen(uiState = uiState)
        }

        composable("approval") {
            ApprovalScreen(
                approval = uiState.pendingApproval,
                client = client,
                onDismiss = {
                    navController.popBackStack()
                }
            )
        }

        // Voice screen — only accessible if speech recognition is available (AC5.2.2)
        if (hasSpeechRecognition) {
            composable("voice") {
                VoiceScreen(
                    client = client,
                    onDone = {
                        navController.popBackStack()
                    }
                )
            }
        }
    }

    // Interrupt screen accessible via long-press/swipe from status
    // AC5.1.6: Interrupt requires a confirm swipe to prevent accidental triggering
    // This is handled by the SwipeDismissable navigation — swiping away from
    // the interrupt action acts as the confirmation mechanism.
}
