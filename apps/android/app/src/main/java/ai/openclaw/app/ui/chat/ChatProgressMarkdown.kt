package ai.openclaw.app.ui.chat

import ai.openclaw.app.i18n.nativeString
import ai.openclaw.app.ui.design.ClawTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.commonmark.node.HtmlBlock
import org.commonmark.node.Node
import org.commonmark.node.Paragraph
import java.util.Locale

private val progressElementRegex = Regex("""(?i)^<progress\b([^<>]*)>\s*</progress>$""")
private val progressAttributeRegex =
  Regex("""([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')""")
private val progressNumberRegex = Regex("""^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$""")

internal data class ChatProgressElement(
  val value: Double,
  val max: Double,
  val label: String?,
) {
  val fraction: Float = (value.coerceIn(0.0, max) / max).toFloat()
}

internal fun parseChatProgressElement(
  node: Node,
  source: String,
): ChatProgressElement? {
  if (node !is HtmlBlock && node !is Paragraph) return null
  val start = node.sourceSpans.minOfOrNull { span -> span.inputIndex } ?: return null
  val end = node.sourceSpans.maxOfOrNull { span -> span.inputIndex + span.length } ?: return null
  val element = progressElementRegex.matchEntire(source.substring(start, end).trim()) ?: return null
  val rawAttributes = element.groupValues[1]
  val attributes = mutableMapOf<String, String>()
  var cursor = 0
  for (match in progressAttributeRegex.findAll(rawAttributes)) {
    if (rawAttributes.substring(cursor, match.range.first).isNotBlank()) return null
    val name = match.groupValues[1].lowercase(Locale.ROOT)
    val value = match.groupValues[2].ifEmpty { match.groupValues[3] }
    if (attributes.put(name, value) != null) return null
    cursor = match.range.last + 1
  }
  if (rawAttributes.substring(cursor).isNotBlank()) return null
  val value = attributes["value"]?.parseChatProgressNumber()
  val max = attributes["max"]?.parseChatProgressNumber()
  if (value == null || max == null || max <= 0.0) return null
  return ChatProgressElement(
    value = value.coerceIn(0.0, max),
    max = max,
    label = attributes["aria-label"]?.trim()?.takeIf(String::isNotEmpty),
  )
}

private fun String.parseChatProgressNumber(): Double? = takeIf(progressNumberRegex::matches)?.toDoubleOrNull()?.takeIf(Double::isFinite)

private fun formatChatProgressNumber(value: Double): String =
  if (value >= Long.MIN_VALUE && value <= Long.MAX_VALUE && value % 1.0 == 0.0) {
    value.toLong().toString()
  } else {
    value.toString()
  }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChatProgressBar(progress: ChatProgressElement) {
  val label =
    progress.label
      ?: "${nativeString("Task progress")} · ${formatChatProgressNumber(progress.value)}/${formatChatProgressNumber(progress.max)}"
  Column(
    modifier = Modifier.fillMaxWidth(),
    verticalArrangement = Arrangement.spacedBy(5.dp),
  ) {
    Text(text = label, style = ClawTheme.type.caption, color = ClawTheme.colors.textMuted)
    LinearProgressIndicator(
      progress = { progress.fraction },
      modifier =
        Modifier
          .fillMaxWidth()
          .height(8.dp)
          .clip(RoundedCornerShape(999.dp))
          .semantics { contentDescription = label },
      color = ClawTheme.colors.accent,
      trackColor = ClawTheme.colors.borderStrong,
      strokeCap = StrokeCap.Butt,
      gapSize = 0.dp,
      drawStopIndicator = {},
    )
  }
}
