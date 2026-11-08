package com.atlas.nativeapp

import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
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
    private val time = ui.text(AtlasPages.formatTime(route.optDouble("durationSeconds")), 20f, ui.ink, true)
    private val summary = ui.text("$label · ${AtlasPages.formatDistance(route.optDouble("distanceMeters"))}", 12f, ui.muted)
    private val price = RouteChoices.previewPrice(route)
    private val value = ui.text(price.value, 17f, if (selected) ui.blue else ui.ink, true)
    private val status = ui.text(price.status, 11f, ui.muted)
    private val journey = ui.column().apply {
        addView(time)
        addView(ui.space(4))
        addView(summary)
    }
    private val cost = ui.column().apply {
        addView(value)
        addView(ui.space(4))
        addView(status)
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
        addView(ui.space(7))
        val roads = RouteChoices.roadSummary(route)
        addView(ui.text("Via $roads", 12f, ui.muted))
        // Announce the whole choice once; retain the individual visible labels.
        contentDescription = "$label, ${time.text}, ${AtlasPages.formatDistance(route.optDouble("distanceMeters"))}, ${RouteChoices.previewTollLabel(route)}, $roads"
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        descendantFocusability = FOCUS_BLOCK_DESCENDANTS
        setOnClickListener { onSelect() }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        // Use the actual text size and available width, including large fonts,
        // rather than truncating a price or letting it cover the journey time.
        val available = MeasureSpec.getSize(widthMeasureSpec) - paddingLeft - paddingRight
        val leftWidth = max(time.paint.measureText(time.text.toString()), summary.paint.measureText(summary.text.toString()))
        val rightWidth = max(value.paint.measureText(value.text.toString()), status.paint.measureText(status.text.toString()))
        val stacked = MeasureSpec.getMode(widthMeasureSpec) != MeasureSpec.UNSPECIFIED &&
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
        super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    }
}
