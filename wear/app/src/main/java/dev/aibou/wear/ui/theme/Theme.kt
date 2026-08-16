package dev.aibou.wear.ui.theme

import androidx.compose.runtime.Composable
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Colors
import androidx.compose.ui.graphics.Color

private val AibouColors = Colors(
    primary = Color(0xFF60A5FA),      // Blue-400
    primaryVariant = Color(0xFF3B82F6), // Blue-500
    secondary = Color(0xFF34D399),     // Emerald-400
    error = Color(0xFFF87171),         // Red-400
    onPrimary = Color.Black,
    onSecondary = Color.Black,
    onError = Color.Black,
    surface = Color(0xFF1F2937),       // Gray-800
    onSurface = Color.White,
    background = Color.Black,
    onBackground = Color.White
)

@Composable
fun AibouWearTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = AibouColors,
        content = content
    )
}
