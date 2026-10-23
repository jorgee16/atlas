package com.atlas.nativeapp

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.View

/** Independent vector arrows; unlike font glyphs, lane arrows align on every Android. */
internal class AtlasLaneIcon(context:Context,private val directions:String,
                             private val ink:Int) : View(context) {
    override fun onDraw(canvas:Canvas) {
        super.onDraw(canvas)
        val arrows=directions.filter { it!='·' }.take(3)
        if(arrows.isEmpty())return
        canvas.save()
        val unit=height/24f
        val span=width/arrows.length.toFloat()
        val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style=Paint.Style.STROKE
            strokeWidth=(2.15f*unit).coerceAtLeast(1.8f)
            strokeCap=Paint.Cap.ROUND
            strokeJoin=Paint.Join.ROUND
            color=ink
        }
        fun draw(vararg xy:Float) {
            val path=Path()
            path.moveTo(xy[0]*unit,xy[1]*unit)
            for(i in 2 until xy.size step 2)path.lineTo(xy[i]*unit,xy[i+1]*unit)
            canvas.drawPath(path,paint)
        }
        arrows.forEachIndexed { n, arrow ->
            canvas.save()
            canvas.translate(n*span+span/2-12*unit,0f)
            when(arrow) {
                '↑' -> {draw(12f,20f,12f,5f);draw(7f,10f,12f,5f,17f,10f)}
                '→','↱' -> {draw(8f,20f,8f,12f,18f,12f);draw(13f,7f,18f,12f,13f,17f)}
                '←','↰' -> {draw(16f,20f,16f,12f,6f,12f);draw(11f,7f,6f,12f,11f,17f)}
                '↗' -> {draw(8f,20f,17f,6f);draw(10f,7f,17f,6f,17f,13f)}
                '↖' -> {draw(16f,20f,7f,6f);draw(7f,13f,7f,6f,14f,7f)}
                '↶' -> {draw(17f,20f,17f,11f,7f,11f);draw(12f,6f,7f,11f,12f,16f)}
            }
            canvas.restore()
        }
        canvas.restore()
    }
}
