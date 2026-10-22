package com.atlas.nativeapp

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/** Shared native design tokens and controls. No platform-default button chrome. */
class AtlasUi(val context: Context, val dark: Boolean = false) {
    val ink = Color.parseColor(if (dark) "#F0F3FA" else "#18202F")
    val muted = Color.parseColor(if (dark) "#A1AEC2" else "#728095")
    val surface = Color.parseColor(if (dark) "#182231" else "#FFFFFF")
    val canvas = Color.parseColor(if (dark) "#101824" else "#F6F8FA")
    val line = Color.parseColor(if (dark) "#2A384A" else "#E5EAF2")
    val blue = Color.parseColor(if (dark) "#6686FF" else "#4668C9")
    val soft = Color.parseColor(if (dark) "#24345B" else "#E8EDF9")
    val green = Color.parseColor(if (dark) "#50D6AC" else "#11875D")
    val greenSoft = Color.parseColor(if (dark) "#193B35" else "#EAF7F0")
    val red = Color.parseColor(if (dark) "#FF9393" else "#CB414B")
    fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    fun shape(color: Int = surface, radius: Int = 22, stroke: Boolean = false) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat()
        if (stroke) setStroke(dp(1), line)
    }
    fun ripple(view: View, color: Int = surface, radius: Int = 18) {
        view.background = RippleDrawable(ColorStateList.valueOf(Color.argb(24, Color.red(blue), Color.green(blue), Color.blue(blue))), shape(color, radius), shape(Color.WHITE, radius))
        view.isClickable = true; view.isFocusable = true
    }
    fun column() = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
    fun row() = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    fun text(value: String, size: Float = 14f, color: Int = ink, bold: Boolean = false) = TextView(context).apply {
        text = value; textSize = size; setTextColor(color)
        typeface = Typeface.create(if (bold) "sans-serif-medium" else "sans-serif", Typeface.NORMAL)
        includeFontPadding = false
    }
    fun space(height: Int) = View(context).apply { layoutParams = LinearLayout.LayoutParams(1, dp(height)) }
    fun rule() = View(context).apply { setBackgroundColor(line); layoutParams = LinearLayout.LayoutParams(-1, dp(1)) }
    fun card(padding: Int = 18, floating: Boolean = false) = column().apply {
        setPadding(dp(padding), dp(padding), dp(padding), dp(padding))
        background = shape(stroke = !floating)
        if (floating) elevation = dp(5).toFloat()
        clipToOutline = true
    }
    fun icon(name: String, color: Int = ink, size: Int = 22) = AtlasIcon(context, name, color).apply {
        layoutParams = LinearLayout.LayoutParams(dp(size), dp(size))
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    fun iconButton(name: String, description: String, selected: Boolean = false, click: () -> Unit): FrameLayout = FrameLayout(context).apply {
        contentDescription = description
        minimumWidth = dp(48); minimumHeight = dp(48)
        ripple(this, if (selected) blue else surface, 17)
        elevation = dp(4).toFloat()
        addView(icon(name, if (selected) Color.WHITE else ink, 22), FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER))
        setOnClickListener { click() }
    }
    fun action(label: String, icon: String? = null, primary: Boolean = true, click: () -> Unit) = row().apply {
        gravity = Gravity.CENTER; minimumHeight = dp(50)
        setPadding(dp(16), dp(10), dp(16), dp(10))
        ripple(this, if (primary) blue else soft, 16)
        contentDescription = label
        if (icon != null) addView(this@AtlasUi.icon(icon, if (primary) Color.WHITE else blue), LinearLayout.LayoutParams(dp(20), dp(20)).apply { rightMargin = dp(9) })
        addView(text(label, 15f, if (primary) Color.WHITE else blue, true))
        setOnClickListener { click() }
    }
    fun chip(label: String, icon: String? = null, selected: Boolean = false, click: () -> Unit) = row().apply {
        gravity = Gravity.CENTER; minimumHeight = dp(40)
        setPadding(dp(13), dp(9), dp(13), dp(9))
        ripple(this, if (selected) blue else surface, 20)
        contentDescription = label; elevation = dp(2).toFloat()
        if (icon != null) addView(this@AtlasUi.icon(icon, if (selected) Color.WHITE else muted, 18), LinearLayout.LayoutParams(dp(18), dp(18)).apply { rightMargin = dp(7) })
        addView(text(label, 13f, if (selected) Color.WHITE else ink, selected))
        setOnClickListener { click() }
    }
    fun badge(label: String, positive: Boolean = false) = text(label, 11f, if (positive) green else blue, true).apply {
        background = shape(if (positive) greenSoft else soft, 10)
        setPadding(dp(9), dp(5), dp(9), dp(5))
    }
    fun heading(title: String, subtitle: String? = null) = column().apply {
        addView(text(title, 25f, bold = true))
        if (subtitle != null) { addView(space(7)); addView(text(subtitle, 13f, muted)) }
    }
    fun stat(value: String, label: String) = column().apply {
        gravity = Gravity.CENTER
        addView(text(value, 23f, bold = true).apply { gravity = Gravity.CENTER }); addView(space(5)); addView(text(label, 11f, muted).apply { gravity = Gravity.CENTER })
    }
    fun tileIcon(name: String, tint: Int = blue) = FrameLayout(context).apply {
        background = shape(if (tint == green) greenSoft else soft, 15)
        addView(icon(name, tint, 22), FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER))
    }
}

/** Small consistent stroke icons, rendered at device density. */
class AtlasIcon(context: Context, var name: String, var tint: Int) : View(context) {
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.save(); canvas.translate(width * .08f, height * .08f); canvas.scale(width * .84f / 24f, height * .84f / 24f)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = tint; style = Paint.Style.STROKE; strokeWidth = 1.8f; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
        fun line(vararg points: Float) { val path = Path(); path.moveTo(points[0], points[1]); for (i in 2 until points.size step 2) path.lineTo(points[i], points[i + 1]); canvas.drawPath(path, p) }
        fun circle(x: Float, y: Float, r: Float) = canvas.drawCircle(x, y, r, p)
        fun rect(a: Float, b: Float, c: Float, d: Float, r: Float = 2f) = canvas.drawRoundRect(a, b, c, d, r, r, p)
        when (name) {
            "search" -> { circle(10.5f, 10.5f, 6.5f); line(15f, 15f, 21f, 21f) }
            "close" -> { line(6f, 6f, 18f, 18f); line(18f, 6f, 6f, 18f) }
            "back" -> { line(14f, 5f, 7f, 12f, 14f, 19f); line(7f, 12f, 21f, 12f) }
            "chevron" -> line(9f, 6f, 15f, 12f, 9f, 18f)
            "down" -> line(6f, 9f, 12f, 15f, 18f, 9f)
            "menu" -> { circle(5f, 12f, .8f); circle(12f, 12f, .8f); circle(19f, 12f, .8f) }
            "locate" -> { circle(12f, 12f, 7f); circle(12f, 12f, 2f); line(12f, 2f, 12f, 5f); line(12f, 19f, 12f, 22f); line(2f, 12f, 5f, 12f); line(19f, 12f, 22f, 12f) }
            "follow", "navigate" -> line(12f, 3f, 20f, 21f, 12f, 16f, 4f, 21f, 12f, 3f)
            "compass", "explore" -> { circle(12f, 12f, 9f); line(16f, 7f, 14f, 14f, 7f, 17f, 10f, 10f, 16f, 7f) }
            "diagnostics" -> { rect(3f,4f,21f,20f,3f);line(6f,15f,9f,15f);line(11f,11f,14f,11f);line(16f,8f,19f,8f);line(7.5f,15f,7.5f,17f);line(12.5f,11f,12.5f,17f);line(17.5f,8f,17.5f,17f) }
            "bookmark" -> line(6f, 3f, 18f, 3f, 18f, 21f, 12f, 17f, 6f, 21f, 6f, 3f)
            "pin" -> { val path = Path(); path.moveTo(12f, 22f); path.cubicTo(8f, 17f, 5f, 13f, 5f, 9f); path.cubicTo(5f, 0f, 19f, 0f, 19f, 9f); path.cubicTo(19f, 13f, 16f, 17f, 12f, 22f); canvas.drawPath(path, p); circle(12f, 9f, 2.5f) }
            "download" -> { line(12f, 3f, 12f, 15f); line(7f, 10f, 12f, 15f, 17f, 10f); line(4f, 16f, 4f, 21f, 20f, 21f, 20f, 16f) }
            "upload" -> { line(12f, 16f, 12f, 3f); line(7f, 8f, 12f, 3f, 17f, 8f); line(4f, 16f, 4f, 21f, 20f, 21f, 20f, 16f) }
            "check" -> line(5f, 12f, 10f, 17f, 20f, 6f)
            "plus" -> { line(4f, 12f, 20f, 12f); line(12f, 4f, 12f, 20f) }
            "layers" -> { rect(5f, 5f, 19f, 9f, 2f); rect(3f, 10f, 21f, 14f, 2f); rect(5f, 16f, 19f, 20f, 2f) }
            "expand" -> { line(9f,3f,3f,3f,3f,9f);line(15f,3f,21f,3f,21f,9f);line(3f,15f,3f,21f,9f,21f);line(15f,21f,21f,21f,21f,15f) }
            "map" -> { line(3f, 5f, 9f, 3f, 15f, 6f, 21f, 3f, 21f, 19f, 15f, 22f, 9f, 19f, 3f, 22f, 3f, 5f); line(9f, 3f, 9f, 19f); line(15f, 6f, 15f, 22f) }
            "trail" -> { line(3f, 19f, 8f, 9f, 13f, 15f, 19f, 4f, 22f, 10f); line(3f, 19f, 8f, 21f, 14f, 16f, 19f, 18f, 22f, 10f) }
            "trip", "route" -> { circle(6f, 5f, 2f); circle(18f, 19f, 2f); val path = Path(); path.moveTo(8f, 5f); path.lineTo(17f, 5f); path.cubicTo(24f, 5f, 23f, 12f, 17f, 12f); path.lineTo(7f, 12f); path.cubicTo(0f, 12f, 1f, 19f, 6f, 19f); path.lineTo(16f, 19f); canvas.drawPath(path, p) }
            "car" -> { line(4f, 10f, 6f, 4f, 18f, 4f, 20f, 10f); rect(3f, 10f, 21f, 18f); line(5f, 18f, 5f, 21f); line(19f, 18f, 19f, 21f); line(6f, 14f, 8f, 14f); line(16f, 14f, 18f, 14f) }
            "walk" -> { circle(14f, 3f, 2f); line(7f, 21f, 11f, 13f, 13f, 7f, 17f, 12f, 21f, 12f); line(12f, 14f, 17f, 21f); line(12f, 8f, 7f, 12f, 4f, 12f) }
            "transit" -> { rect(5f, 2f, 19f, 19f, 4f); line(5f, 11f, 19f, 11f); line(12f, 2f, 12f, 11f); line(8f, 19f, 6f, 22f); line(16f, 19f, 18f, 22f); circle(9f, 15f, .6f); circle(15f, 15f, .6f) }
            "clock" -> { circle(12f, 12f, 9f); line(12f, 6f, 12f, 12f, 16f, 14f) }
            "volume", "mute" -> { line(3f, 9f, 7f, 9f, 12f, 5f, 12f, 19f, 7f, 15f, 3f, 15f, 3f, 9f); if (name == "volume") { val path = Path(); path.moveTo(16f, 7f); path.quadTo(22f, 12f, 16f, 17f); canvas.drawPath(path, p) } else { line(16f, 9f, 22f, 15f); line(22f, 9f, 16f, 15f) } }
            "arrow-right" -> { line(5f, 21f, 5f, 11f, 19f, 11f); line(13f, 5f, 19f, 11f, 13f, 17f) }
            "arrow-left" -> { line(19f, 21f, 19f, 11f, 5f, 11f); line(11f, 5f, 5f, 11f, 11f, 17f) }
            "arrow" -> { line(12f, 21f, 12f, 3f); line(6f, 9f, 12f, 3f, 18f, 9f) }
            "roundabout" -> { val path = Path(); path.addArc(4f, 4f, 20f, 20f, 90f, 285f); canvas.drawPath(path, p); line(16f, 2f, 21f, 5f, 18f, 10f) }
            "flag" -> { line(5f, 22f, 5f, 3f, 19f, 3f, 17f, 8f, 19f, 13f, 5f, 13f) }
            "trash" -> { line(4f, 6f, 20f, 6f); line(9f, 3f, 15f, 3f); line(6f, 6f, 7f, 21f, 17f, 21f, 18f, 6f); line(10f, 10f, 10f, 17f); line(14f, 10f, 14f, 17f) }
            "sun" -> { circle(12f, 12f, 4f); for (i in 0..7) { val a = i * Math.PI / 4; line((12 + 7 * kotlin.math.cos(a)).toFloat(), (12 + 7 * kotlin.math.sin(a)).toFloat(), (12 + 10 * kotlin.math.cos(a)).toFloat(), (12 + 10 * kotlin.math.sin(a)).toFloat()) } }
            "cafe" -> { line(4f, 8f, 17f, 8f, 16f, 18f, 6f, 18f, 4f, 8f); val path = Path(); path.moveTo(17f, 9f); path.cubicTo(24f, 8f, 23f, 16f, 17f, 15f); canvas.drawPath(path, p); line(3f, 21f, 19f, 21f); line(8f, 3f, 8f, 5f); line(13f, 3f, 13f, 5f) }
            "food" -> { line(5f, 3f, 5f, 10f, 9f, 10f, 9f, 3f); line(7f, 3f, 7f, 21f); line(18f, 21f, 18f, 3f, 14f, 10f, 18f, 10f) }
            else -> { circle(12f, 12f, 8f); circle(12f, 12f, 2f) }
        }
        canvas.restore()
    }
}
