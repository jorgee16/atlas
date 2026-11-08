package com.atlas.nativeapp

import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.text.Layout
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.RelativeSizeSpan
import org.json.JSONObject
import kotlin.math.max

/** One selectable route. Financial evidence stays in the details dialog. */
internal class RouteOptionView(
    private val ui: AtlasUi,
    route: JSONObject,
    label: String,
    selected: Boolean,
    onSelect: () -> Unit
) : LinearLayout(ui.context) {
    private val duration = AtlasPages.formatTime(route.optDouble("durationSeconds"))
    private val roads = RouteChoices.roadSummary(route)
    private val time = ui.text("", 20f, ui.ink, true).apply {
        text = SpannableString("$duration  $label").apply {
            setSpan(RelativeSizeSpan(.6f), duration.length + 2, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            setSpan(ForegroundColorSpan(ui.muted), duration.length + 2, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }
    private val summary = ui.text("${AtlasPages.formatDistance(route.optDouble("distanceMeters"))} · $roads", 12f, ui.muted)
    private val price = RouteChoices.previewPrice(route)
    private val value = ui.text(price.value, 17f, if (selected) ui.blue else ui.ink, true)
    private val status = ui.text(price.status, 11f, ui.muted)
    private val journey = ui.column().apply {
        addView(time, LayoutParams(-2, -2))
        addView(ui.space(4))
        addView(summary, LayoutParams(-2, -2))
    }
    private val cost = ui.column().apply {
        // MATCH_PARENT text inside a WRAP_CONTENT column gets a uniform-width
        // remeasure with its previous exact height. A rounding-induced extra
        // line (notably the approximation glyph) can then be clipped.
        addView(value, LayoutParams(-2, -2))
        addView(ui.space(4))
        addView(status, LayoutParams(-2, -2))
    }
    private val header = ui.row().apply {
        addView(journey)
        addView(cost)
    }
    private var previousStacked: Boolean? = null

    init {
        orientation = VERTICAL
        tag = "route-option"
        ui.ripple(this, if (selected) ui.soft else ui.surface, 13)
        setPadding(ui.dp(12), ui.dp(11), ui.dp(12), ui.dp(11))
        minimumHeight = ui.dp(72)
        isSelected = selected
        addView(header, LayoutParams(-1, -2))
        // Announce the whole choice once; retain the individual visible labels.
        contentDescription = "$label, $duration, ${AtlasPages.formatDistance(route.optDouble("distanceMeters"))}, ${RouteChoices.previewTollLabel(route)}, $roads"
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        descendantFocusability = FOCUS_BLOCK_DESCENDANTS
        setOnClickListener { onSelect() }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        // This is a full-width planner choice. Resolve AT_MOST to that width
        // before deciding how the text flows; otherwise wrap-content can shrink
        // the header after its height was measured inside a ScrollView/Dialog.
        val widthSpec = if (MeasureSpec.getMode(widthMeasureSpec) == MeasureSpec.AT_MOST)
            MeasureSpec.makeMeasureSpec(MeasureSpec.getSize(widthMeasureSpec), MeasureSpec.EXACTLY)
            else widthMeasureSpec
        // Use the actual text size and available width, including large fonts,
        // rather than truncating a price or letting it cover the journey time.
        val available = MeasureSpec.getSize(widthSpec) - paddingLeft - paddingRight
        val leftWidth = max(Layout.getDesiredWidth(time.text, time.paint), Layout.getDesiredWidth(summary.text, summary.paint))
        val rightWidth = max(value.paint.measureText(value.text.toString()), status.paint.measureText(status.text.toString()))
        val stacked = MeasureSpec.getMode(widthSpec) != MeasureSpec.UNSPECIFIED &&
            leftWidth + rightWidth + ui.dp(12) > available
        if (previousStacked != stacked) {
            previousStacked = stacked
            header.orientation = if (stacked) VERTICAL else HORIZONTAL
            header.gravity = if (stacked) Gravity.START else Gravity.CENTER_VERTICAL
            journey.layoutParams = if (stacked) LayoutParams(-1, -2) else LayoutParams(0, -2, 1f)
            cost.layoutParams = LayoutParams(if (stacked) -1 else -2, -2).apply {
                if (stacked) topMargin = ui.dp(8) else marginStart = ui.dp(12)
            }
            cost.gravity = if (stacked) Gravity.START else Gravity.END
        }
        super.onMeasure(widthSpec, heightMeasureSpec)
    }
}
