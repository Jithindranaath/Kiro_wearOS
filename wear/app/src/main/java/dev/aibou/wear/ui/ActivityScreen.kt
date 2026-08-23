package dev.aibou.wear.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.*
import dev.aibou.wear.data.ActivityItem
import dev.aibou.wear.data.UiState

/**
 * Activity feed — what the agent is actually doing, on the wrist.
 *
 * Newest at the bottom, matching a terminal, and the list follows new lines as
 * they stream in so the wrist shows the present moment without scrolling.
 * Every line originates in an AWP `event` frame; nothing is inferred here.
 */
@Composable
fun ActivityScreen(uiState: UiState) {
    val activity = uiState.activity
    val listState = rememberScalingLazyListState()

    // Follow the tail as the agent talks.
    LaunchedEffect(activity.size) {
        if (activity.isNotEmpty()) {
            listState.animateScrollToItem(activity.size) // +1 header item
        }
    }

    if (activity.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize().padding(20.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = if (uiState.session == null) {
                    "No session yet"
                } else {
                    "Nothing yet.\nActivity appears as the agent works."
                },
                style = MaterialTheme.typography.caption1,
                color = MaterialTheme.colors.onSurface.copy(alpha = 0.6f),
                textAlign = TextAlign.Center
            )
        }
        return
    }

    ScalingLazyColumn(
        state = listState,
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 26.dp)
    ) {
        item {
            Text(
                text = "Activity",
                style = MaterialTheme.typography.caption1,
                color = MaterialTheme.colors.onSurface.copy(alpha = 0.7f)
            )
        }

        items(activity.size) { index ->
            ActivityRow(activity[index])
        }
    }
}

@Composable
private fun ActivityRow(item: ActivityItem) {
    val accent = when (item.kind) {
        "agent.text" -> MaterialTheme.colors.onSurface
        "agent.thought" -> Color(0xFF9CA3AF)
        "tool.start" -> Color(0xFF60A5FA)
        "tool.end" -> Color(0xFF34D399)
        "task.update" -> Color(0xFFA78BFA)
        else -> Color(0xFF9CA3AF)
    }

    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        verticalAlignment = Alignment.Top
    ) {
        Text(
            text = item.glyph,
            fontSize = 11.sp,
            modifier = Modifier.padding(end = 5.dp, top = 1.dp)
        )
        Text(
            text = item.text,
            style = MaterialTheme.typography.caption2,
            color = accent,
            // Tool commands and results read best unwrapped and monospaced-ish;
            // prose can run longer.
            maxLines = if (item.kind == "agent.text") 6 else 3,
            modifier = Modifier.weight(1f)
        )
    }
}
