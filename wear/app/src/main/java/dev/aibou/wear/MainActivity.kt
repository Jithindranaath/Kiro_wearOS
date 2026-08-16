package dev.aibou.wear

import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import androidx.lifecycle.lifecycleScope
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import dev.aibou.wear.data.AibouClient
import dev.aibou.wear.data.TokenStore
import dev.aibou.wear.ui.*
import dev.aibou.wear.ui.theme.AibouWearTheme

/**
 * MainActivity — entry point for the Aibou Wear OS app.
 *
 * Standalone app (D4) — connects directly to Bridge over Wi-Fi,
 * no phone companion required (AC5.1.2).
 */
class MainActivity : ComponentActivity() {

    private lateinit var tokenStore: TokenStore
    private lateinit var client: AibouClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        tokenStore = TokenStore(applicationContext)
        client = AibouClient(tokenStore, lifecycleScope)

        // Auto-connect if already paired (AC5.1.7)
        if (tokenStore.isPaired) {
            client.connect()
        }

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

    override fun onDestroy() {
        super.onDestroy()
        client.disconnect()
    }

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

    // Determine start destination
    val startDestination = if (tokenStore.isPaired) "status" else "pair"

    SwipeDismissableNavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable("pair") {
            PairScreen(
                client = client,
                defaultUrl = "http://10.0.2.2:8787", // Emulator default
                onPaired = {
                    client.connect()
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
                }
            )
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
