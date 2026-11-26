package ai.wisp.android

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.SweepGradient
import android.util.AttributeSet
import android.view.Choreographer
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

/**
 * The welcome screen's stage (2026-11-26, canvas "Phone welcome", round 2): the Calm background, about 30
 * soap bubbles rising at three depths, and the big bubble with eyes in the middle, all in one view drawn on
 * Choreographer frames. Frames stop when the view is hidden, detached or the app is in the background.
 * Gradients are made once at a fixed size and scaled into place, so a frame allocates nothing. Bubbles
 * drift away from a finger; tapping one pops it, tapping the big bubble makes it hop. With animations
 * turned off (Remove animations) everything holds still and only the big bubble's eyes blink.
 */
class BubbleFieldView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {
    private class Bubble {
        var z = 0f; var r = 0f
        var x0 = 0f; var x = 0f; var y = 0f
        var vy = 0f; var amp = 0f; var freq = 0f; var phase = 0f; var hue = 0f
        var dx = 0f; var vx = 0f; var dvy = 0f
        var life = 0f; var age = 0f
        /** seconds into popping, or -1 */
        var pop = -1f
        /** the easter egg: two of them have tiny eyes */
        var face = false
        val front get() = z > 0.86f
    }

    private val dp = resources.displayMetrics.density
    private val mascot = 200 * dp
    private val bubbles = List(COUNT) { Bubble() }
    private var seed = 11L
    private var finger: Float? = null
    private var fingerY = 0f
    private var lastNanos = 0L
    private var clock = 0.0
    private var now = 0.0
    private var started = -1.0
    private var hopAt = -10.0
    private var gx = 0.7f; private var gy = -0.2f
    private var tx = 0.7f; private var ty = -0.2f
    private var nextGlance = 0.0
    private var seeded = false
    private var running = false

    /** false while something covers the screen, so frames stop */
    var active = true
        set(v) { field = v; update() }

    /** play the opening: the big bubble rises into place and the small ones fade in */
    var opening = false

    private val dark get() = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    private val still get() = !ValueAnimator.areAnimatorsEnabled()

    init {
        isClickable = true
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    private fun rnd(): Float {
        seed = (seed * 16807) % 2147483647
        return (seed - 1).toFloat() / 2147483646f
    }

    private val homeX get() = width / 2f
    private val homeY get() = height * 0.42f
    private val mascotY get() = homeY + 6 * dp * sin(clock * 0.33).toFloat()

    private fun spawn(b: Bubble, first: Boolean, clear: Boolean = false) {
        repeat(9) {
            val z = rnd()
            b.z = z
            b.r = dp * (if (z > 0.9f) 26 + rnd() * 18 else 3 + z.pow(1.4f) * 22 + rnd() * 3)
            if (b.face) b.r = max(b.r, 10 * dp)
            b.x0 = rnd() * width
            b.y = if (first) rnd() * (height + 60 * dp) else height + b.r + rnd() * 80 * dp
            b.vy = dp * (8 + z * 26 + rnd() * 6)
            b.amp = dp * (6 + rnd() * 12)
            b.freq = 0.25f + rnd() * 0.35f
            b.phase = rnd() * 6.28f
            b.hue = rnd() * 360f
            b.vx = 0f; b.dvy = 0f; b.dx = 0f
            b.life = 8 + rnd() * 32
            b.age = if (first) rnd() * b.life * 0.8f else 0f
            b.pop = -1f
            b.x = b.x0
            // the first ones, and still ones, start clear of the big bubble, the words and the buttons
            if (!clear) return
            val onMascot = hypot(b.x0 - homeX, b.y - homeY) < mascot / 2 + b.r + 6 * dp
            val onWords = b.y > wordsTop - b.r - 6 * dp && b.y < wordsBottom + b.r + 6 * dp && abs(b.x0 - homeX) < wordsHalf + b.r
            if (!onMascot && !onWords && b.y < height - buttons) return
        }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w == 0 || h == 0) return
        if (!seeded) {
            bubbles[4].face = true
            bubbles[17].face = true
            bubbles.forEach { spawn(it, true, true) }
            bubbles[4].r = max(bubbles[4].r, 13 * dp)
            bubbles[17].r = max(bubbles[17].r, 10 * dp)
            seeded = true
        } else if (oldw > 0) {
            bubbles.forEach { it.x0 *= w.toFloat() / oldw }
        }
        groundPaint.shader = RadialGradient(w / 2f, h * 0.4f, max(1f, h * 0.5f), color(LIFT), color(GROUND), Shader.TileMode.CLAMP)
    }

    // ---------------------------------------------------------------- frames

    private val frame = object : Choreographer.FrameCallback {
        override fun doFrame(nanos: Long) {
            if (!running) return
            step(nanos)
            invalidate()
            // with animations off only the blink moves: a few frames a second is plenty
            if (still) Choreographer.getInstance().postFrameCallbackDelayed(this, 66) else Choreographer.getInstance().postFrameCallback(this)
        }
    }

    private fun update() {
        val go = active && isAttachedToWindow && windowVisibility == VISIBLE && isShown
        if (go == running) return
        running = go
        if (go) {
            lastNanos = 0L
            Choreographer.getInstance().postFrameCallback(frame)
        } else Choreographer.getInstance().removeFrameCallback(frame)
    }

    override fun onAttachedToWindow() { super.onAttachedToWindow(); update() }
    override fun onDetachedFromWindow() { super.onDetachedFromWindow(); update() }
    override fun onWindowVisibilityChanged(visibility: Int) { super.onWindowVisibilityChanged(visibility); update() }
    override fun onVisibilityChanged(changedView: View, visibility: Int) { super.onVisibilityChanged(changedView, visibility); update() }

    private fun step(nanos: Long) {
        // a frame after a pause carries on instead of jumping
        val dt = if (lastNanos == 0L) 0f else min(0.05f, (nanos - lastNanos) / 1e9f)
        lastNanos = nanos
        now = nanos / 1e9
        if (started < 0) started = now
        val still = still
        if (!still) clock += dt
        for (b in bubbles) {
            if (b.pop >= 0) {
                b.pop += dt
                if (b.pop > 0.25f) { spawn(b, still, still); if (still) b.age = 0f }
                continue
            }
            b.age += dt
            if (still) { b.x = b.x0; continue }
            finger?.let { fx ->
                val ddx = b.x - fx; val ddy = b.y - fingerY
                val d = max(0.001f, hypot(ddx, ddy)); val reach = 90 * dp + b.r
                if (d < reach) {
                    val f = (1 - d / reach) * 700 * dp * (0.6f + b.z * 0.4f)
                    b.vx += ddx / d * f * dt
                    b.dvy += ddy / d * f * dt
                }
            }
            avoid(b, dt)
            val damp = exp(-1.4f * dt)
            b.vx *= damp; b.dvy *= damp
            b.dx += b.vx * dt
            b.y += (-b.vy + b.dvy) * dt
            b.x = b.x0 + b.dx + b.amp * sin(clock * b.freq + b.phase).toFloat()
            if (b.age > b.life) b.pop = 0f
            if (b.y < -b.r - 20 * dp || b.x < -60 * dp || b.x > width + 60 * dp) spawn(b, false)
        }
        if (!still) {
            // the big bubble's eyes: at the finger, otherwise a glance to one side every few seconds
            val f = finger
            if (f != null) {
                tx = (f - homeX) / (100 * dp); ty = (fingerY - (mascotY - 10 * dp)) / (100 * dp)
            } else if (now > nextGlance) {
                tx = (if (Random.nextBoolean()) -1 else 1) * Random.nextDouble(0.5, 0.9).toFloat()
                ty = -Random.nextDouble(0.0, 0.4).toFloat()
                nextGlance = now + Random.nextDouble(3.0, 7.0)
            }
            val len = max(1f, hypot(tx, ty))
            val k = 1 - exp(-dt / (if (f == null) 0.12f else 0.06f))
            gx += (tx / len - gx) * k
            gy += (ty / len - gy) * k
        }
    }

    /** the words under the big bubble, as a box to keep clear, and how far up the buttons reach */
    private val wordsTop get() = homeY + 108 * dp
    private val wordsBottom get() = homeY + 188 * dp
    private val wordsHalf = 165 * dp
    private val buttons = 170 * dp

    /**
     * Bubbles steer sideways around the big bubble's face and the words under it, starting a little before
     * they reach them, so nothing rises across the eyes or the text.
     */
    private fun avoid(b: Bubble, dt: Float) {
        val side = if (b.x > homeX || (b.x == homeX && b.phase > 3.14f)) 1f else -1f
        val reach = mascot / 2 + b.r + 10 * dp
        val ddy = b.y - homeY
        if (ddy > -reach && ddy < reach + 40 * dp) {
            val dy = min(reach, abs(ddy))
            val wide = max(sqrt(max(0f, reach * reach - dy * dy)), reach * 0.6f)
            val ddx = abs(b.x - homeX)
            if (ddx < wide) b.vx += side * (1 - ddx / wide) * 520 * dp * dt
        }
        // soft walls: a bubble pushed aside stays on the screen instead of leaving it
        if (b.x < b.r + 4 * dp && b.vx < 0) b.vx *= -0.3f
        if (b.x > width - b.r - 4 * dp && b.vx > 0) b.vx *= -0.3f
        val half = wordsHalf + b.r + 6 * dp
        if (b.y > wordsTop - b.r - 6 * dp && b.y < wordsBottom + b.r + 50 * dp) {
            val ddx = abs(b.x - homeX)
            if (ddx < half) b.vx += side * (1 - ddx / half) * 520 * dp * dt
        }
    }

    /** Bubbles show above the buttons only: they fade out as they go behind them. */
    private fun overButtons(y: Float): Float = ((height - buttons + 40 * dp - y) / (50 * dp)).coerceIn(0f, 1f)

    // ---------------------------------------------------------------- touch

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touchDown(e.x, e.y)
                finger = e.x; fingerY = e.y
            }
            MotionEvent.ACTION_MOVE -> { finger = e.x; fingerY = e.y }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> finger = null
        }
        return true
    }

    private fun touchDown(x: Float, y: Float) {
        val onMascot = hypot(x - homeX, y - mascotY) < mascot / 2
        val hit = bubbles.filter { it.pop < 0 && hypot(x - it.x, y - it.y) < it.r + 8 * dp }.maxByOrNull { it.z }
        if (hit != null && (hit.front || !onMascot)) {
            hit.pop = 0f
            performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
        } else if (onMascot && !still) {
            hopAt = now
        }
    }

    // ---------------------------------------------------------------- drawing

    private val groundPaint = Paint()
    private val art = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val grainPaint = Paint().apply { shader = BitmapShader(grainBitmap(), Shader.TileMode.REPEAT, Shader.TileMode.REPEAT) }
    private val glow by lazy { glowBitmap() }
    private val ripples by lazy { ripplesBitmap() }
    private val artRect = RectF()

    override fun onDraw(canvas: Canvas) {
        if (width == 0 || !seeded) return
        val dark = dark
        val still = still
        val t = if (still) 0.0 else clock
        // Calm: the ground, a rainbow glow that turns once a minute, faint ripples of light, fine grain
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), groundPaint)
        canvas.save()
        canvas.rotate((360 * (t / 60 % 1)).toFloat(), homeX, homeY)
        val g = 400 * dp
        artRect.set(homeX - g, homeY - g, homeX + g, homeY + g)
        art.alpha = if (dark) 87 else 128
        canvas.drawBitmap(glow, null, artRect, art)
        canvas.restore()
        canvas.save()
        val drift = sin(t * PI / 38).toFloat()
        canvas.translate(12 * dp * drift, 8 * dp * drift)
        canvas.rotate(3 * drift + 3, homeX, height * 0.44f)
        val rr = 280 * dp
        artRect.set(homeX - rr, height * 0.44f - rr, homeX + rr, height * 0.44f + rr)
        art.alpha = if (dark) 26 else 140
        canvas.drawBitmap(ripples, null, artRect, art)
        canvas.restore()
        grainPaint.alpha = if (dark) 18 else 13
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), grainPaint)

        val elapsed = if (started < 0) 0.0 else now - started
        val fieldAlpha = if (opening) min(1.0, elapsed / 1.4).toFloat() else 1f
        for (b in bubbles) if (!b.front) drawOne(canvas, b, t, dark, fieldAlpha)
        drawMascot(canvas, dark, still, elapsed)
        for (b in bubbles) if (b.front) drawOne(canvas, b, t, dark, fieldAlpha)
    }

    private fun drawOne(c: Canvas, b: Bubble, t: Double, dark: Boolean, fade: Float) =
        if (b.pop >= 0) drawPop(c, b, dark, fade) else drawBubble(c, b, t, dark, fade)

    // shapes at a unit radius of U, scaled into place
    private val bodyLight = radial(floatArrayOf(0f, 0.5f, 0.8f, 0.97f, 1f), intArrayOf(0, 0, argb(0.10, 165, 180, 225), argb(0.28, 70, 82, 125), argb(0.04, 70, 82, 125)))
    private val bodyDark = radial(floatArrayOf(0f, 0.5f, 0.8f, 0.97f, 1f), intArrayOf(0, 0, argb(0.06, 205, 215, 255), argb(0.32, 235, 240, 255), argb(0.04, 235, 240, 255)))
    private val softLight = radial(floatArrayOf(0f, 0.5f, 0.8f, 0.97f, 1f), intArrayOf(0, 0, argb(0.10, 165, 180, 225), argb(0.18, 70, 82, 125), argb(0.04, 70, 82, 125)))
    private val softDark = radial(floatArrayOf(0f, 0.5f, 0.8f, 0.97f, 1f), intArrayOf(0, 0, argb(0.06, 205, 215, 255), argb(0.2, 235, 240, 255), argb(0.04, 235, 240, 255)))
    private val film = SweepGradient(0f, 0f, FILM, null)
    private val highlight = RadialGradient(0f, 0f, 0.38f * U, intArrayOf(argb(0.9, 255, 255, 255), argb(0.3, 255, 255, 255), 0), floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP)
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val oval = RectF()

    private fun drawBubble(c: Canvas, b: Bubble, t: Double, dark: Boolean, fade: Float) {
        val a = (0.4f + 0.6f * b.z) * min(1f, b.age / 0.8f) * fade * overButtons(b.y)
        if (a < 0.01f) return
        val k = b.r / U
        val squash = 0.03f * sin(t * 1.9 + b.phase).toFloat()
        c.save()
        c.translate(b.x, b.y)
        c.scale(k * (1 + squash), k * (1 - squash))
        val soft = b.z < 0.28f
        // body: a clear middle; the edge darkens where light bends (light) or catches the light (dark)
        fill.shader = if (soft) (if (dark) softDark else softLight) else (if (dark) bodyDark else bodyLight)
        fill.alpha = alpha(a)
        c.drawCircle(0f, 0f, U, fill)
        if (soft) { c.restore(); return }
        // the iridescent film along the rim, turning
        val turn = (b.hue + Math.toDegrees(t * 0.35)).toFloat()
        c.save()
        c.rotate(turn)
        line.shader = film
        line.alpha = alpha(a * if (dark) 0.7f else 0.55f)
        line.strokeWidth = max(0.8f / k, U * 0.09f)
        c.drawCircle(0f, 0f, U * 0.94f, line)
        if (b.r > 9 * dp) {
            // a swirl of film inside the lower right
            line.alpha = alpha(a * if (dark) 0.3f else 0.22f)
            line.strokeWidth = U * 0.2f
            val wob = Math.toDegrees(sin(t * 0.4 + b.phase) * 0.2).toFloat()
            oval.set(-U * 0.74f, -U * 0.74f, U * 0.74f, U * 0.74f)
            c.rotate(-turn)
            c.drawArc(oval, 8.6f + wob, 77.4f, false, line)
        }
        c.restore()
        line.shader = null
        // a window's reflection, lower right
        line.color = Color.WHITE
        line.alpha = alpha(a * 0.45f)
        line.strokeWidth = max(0.6f / k, U * 0.05f)
        oval.set(-U * 0.8f, -U * 0.8f, U * 0.8f, U * 0.8f)
        c.drawArc(oval, 20f, 46f, false, line)
        // a soft highlight, upper left, and a small glint
        c.save()
        c.translate(-U * 0.36f, -U * 0.42f)
        c.rotate(-37f)
        c.scale(1f, 0.48f)
        fill.shader = highlight
        fill.alpha = alpha(a)
        c.drawCircle(0f, 0f, U * 0.38f, fill)
        c.restore()
        fill.shader = null
        if (b.r > 6 * dp) {
            fill.color = Color.WHITE
            fill.alpha = alpha(a)
            c.drawCircle(-U * 0.2f, -U * 0.5f, max(0.7f / k, U * 0.055f), fill)
        }
        if (b.face) {
            fill.color = if (dark) 0xFFF4F4F2.toInt() else 0xFF141414.toInt()
            fill.alpha = alpha(a)
            for (side in floatArrayOf(-1f, 1f)) {
                oval.set(side * U * 0.2f - U * 0.08f, -U * 0.19f, side * U * 0.2f + U * 0.08f, U * 0.11f)
                c.drawOval(oval, fill)
            }
        }
        c.restore()
    }

    /** A pop: a thin ring opening out and a few droplets, over a quarter of a second. */
    private fun drawPop(c: Canvas, b: Bubble, dark: Boolean, fade: Float) {
        val k = min(1f, b.pop / 0.25f)
        line.shader = null
        line.color = if (dark) argb(0.9, 235, 240, 255) else argb(0.6, 90, 100, 150)
        line.alpha = alpha((1 - k) * 0.7f * fade * overButtons(b.y) * Color.alpha(line.color) / 255f)
        line.strokeWidth = dp
        c.drawCircle(b.x, b.y, b.r * (1 + k * 0.45f), line)
        fill.shader = null
        fill.color = if (dark) 0xFFE8ECFF.toInt() else 0xFF8F9AC0.toInt()
        fill.alpha = alpha(fade * overButtons(b.y))
        val dr = max(0.6f * dp, b.r * 0.05f) * (1 - k)
        for (i in 0 until 7) {
            val ang = i * 0.9 + b.phase; val d = b.r * (1 + k * 0.9f)
            c.drawCircle(b.x + cos(ang).toFloat() * d, b.y + sin(ang).toFloat() * d, dr, fill)
        }
    }

    // the big bubble, at a unit size of U (centre at 0,0)
    private val edgeLight = radial(floatArrayOf(0.62f, 0.8f, 0.96f, 1f), intArrayOf(0, argb(0.10, 160, 175, 220), argb(0.26, 70, 80, 120), argb(0.06, 70, 80, 120)), 0.5f)
    private val edgeDark = radial(floatArrayOf(0.62f, 0.8f, 0.96f, 1f), intArrayOf(0, argb(0.07, 200, 210, 255), argb(0.30, 235, 240, 255), argb(0.05, 235, 240, 255)), 0.5f)
    private val ringMask = RadialGradient(0f, 0f, 0.52f * U, intArrayOf(0, Color.BLACK, Color.BLACK, 0), floatArrayOf(0.78f, 0.91f, 0.96f, 1f), Shader.TileMode.CLAMP)
    private val shadowLight = RadialGradient(0f, 0f, U, argb(0.16, 120, 110, 200), 0, Shader.TileMode.CLAMP)
    private val shadowDark = RadialGradient(0f, 0f, U, argb(0.18, 160, 150, 255), 0, Shader.TileMode.CLAMP)
    private val mask = Paint(Paint.ANTI_ALIAS_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN) }
    private val clip = Path().apply { addCircle(0f, 0f, U * 0.5f, Path.Direction.CW) }
    private val layer = RectF(-U * 0.52f, -U * 0.52f, U * 0.52f, U * 0.52f)
    private val local = Matrix()

    private fun key(p: Double, vararg f: Pair<Double, Double>): Float {
        if (p <= f[0].first) return f[0].second.toFloat()
        for (i in 1 until f.size) if (p <= f[i].first) {
            val (a0, a1) = f[i - 1]; val (b0, b1) = f[i]
            val x = (p - a0) / (b0 - a0); val e = x * x * (3 - 2 * x)
            return (a1 + (b1 - a1) * e).toFloat()
        }
        return f.last().second.toFloat()
    }

    private fun drawMascot(c: Canvas, dark: Boolean, still: Boolean, elapsed: Double) {
        val s = mascot / U
        val t = clock
        val cx = homeX; val cy = mascotY
        // opening: rises 160 dp from smaller and fades in over 1.2 s (a fade alone with animations off)
        var rise = 0f; var grow = 1f; var alpha = 1f
        if (opening && elapsed < 1.2) {
            val e = (1 - (1 - elapsed / 1.2).pow(3)).toFloat()
            alpha = min(1.0, elapsed).toFloat()
            if (!still) { rise = 160 * dp * (1 - e); grow = 0.7f + 0.3f * e }
        }
        // the soft shadow under it stays on the ground
        c.save()
        c.translate(cx, cy + mascot * 0.56f)
        c.scale(mascot * 0.28f / U, mascot * 0.04f / U)
        fill.shader = if (dark) shadowDark else shadowLight
        fill.alpha = alpha(alpha)
        c.drawCircle(0f, 0f, U, fill)
        c.restore()

        // wobble and hop about a point 85% down
        var sx = 1f; var sy = 1f; var ty = 0f
        if (!still) {
            val p = t / 5.2 % 1
            sx = key(p, 0.0 to 1.0, 0.25 to 1.02, 0.5 to 0.985, 0.75 to 1.01, 1.0 to 1.0)
            sy = key(p, 0.0 to 1.0, 0.25 to 0.98, 0.5 to 1.018, 0.75 to 0.99, 1.0 to 1.0)
            ty = key(p, 0.0 to 0.0, 0.25 to 0.0, 0.5 to -0.015, 0.75 to 0.0, 1.0 to 0.0) * mascot
            val h = now - hopAt
            if (h in 0.0..0.62) {
                val q = h / 0.62
                ty += key(q, 0.0 to 0.0, 0.4 to -0.1, 0.75 to 0.0, 1.0 to 0.0) * mascot
                sx *= key(q, 0.0 to 1.0, 0.4 to 0.97, 0.75 to 1.04, 1.0 to 1.0)
                sy *= key(q, 0.0 to 1.0, 0.4 to 1.04, 0.75 to 0.96, 1.0 to 1.0)
            }
        }
        c.save()
        c.translate(cx, cy + mascot * 0.35f + ty + rise)
        c.scale(sx * grow * s, sy * grow * s)
        c.translate(0f, -U * 0.35f)
        val a = alpha(alpha)

        // glass: the edge, darker where light bends (in dark mode it catches the light)
        c.save()
        c.clipPath(clip)
        fill.shader = if (dark) edgeDark else edgeLight
        fill.alpha = a
        c.drawCircle(0f, 0f, U * 0.5f, fill)
        c.restore()

        // the rainbow film at the rim: clear inside, strongest just inside the edge
        val fl = c.saveLayer(layer, null)
        local.setRotate((40 + 360 * (t / 16 % 1)).toFloat())
        film.setLocalMatrix(local)
        fill.shader = film
        fill.alpha = alpha(alpha * if (dark) 0.8f else 0.6f)
        c.drawCircle(0f, 0f, U * 0.5f, fill)
        film.setLocalMatrix(null)
        mask.shader = ringMask
        c.drawRect(layer, mask)
        c.restoreToCount(fl)

        // a soft highlight, upper left, and a small glint
        c.save()
        c.translate(-U * 0.14f, -U * 0.275f)
        c.rotate(-36f)
        c.scale(0.5f, 0.25f)
        fill.shader = highlight
        fill.alpha = a
        c.drawCircle(0f, 0f, U * 0.38f, fill)
        c.restore()
        fill.shader = null
        fill.color = Color.WHITE
        fill.alpha = a
        c.drawCircle(-U * 0.225f, -U * 0.185f, U * 0.025f, fill)

        // the eyes: blink every 5.4 s (even held still), look around or at your finger
        val p = ((now - if (started < 0) now else started) / 5.4) % 1
        val blink = key(p, 0.0 to 1.0, 0.93 to 1.0, 0.95 to 0.12, 1.0 to 1.0)
        val lx = (if (still) 0.7f else gx) * 0.08f * U
        val ly = (if (still) -0.2f else gy) * 0.06f * U
        val ew = U * 0.10f; val eh = U * 0.17f * blink
        fill.color = if (dark) 0xFFF4F4F2.toInt() else 0xFF141414.toInt()
        fill.alpha = a
        for (left in floatArrayOf(0.33f, 0.57f)) {
            val ex = -U * 0.5f + U * left + ew / 2 + lx
            val ey = -U * 0.5f + U * (0.37f + 0.085f) + ly
            oval.set(ex - ew / 2, ey - eh / 2, ex + ew / 2, ey + eh / 2)
            c.drawOval(oval, fill)
        }
        c.restore()
    }

    // ---------------------------------------------------------------- the background's images, made once

    private fun color(pair: IntArray) = if (dark) pair[1] else pair[0]

    /** a soft rainbow, already blurred, so turning it is just a rotation */
    private fun glowBitmap(): Bitmap {
        val n = 160
        val stops = intArrayOf(0xC7B6FF, 0xA9D2FF, 0xB6F0DC, 0xFFF0B8, 0xFFC6D4, 0xC7B6FF)
        val px = IntArray(n * n)
        for (y in 0 until n) for (x in 0 until n) {
            val dx = (x - n / 2f) / (n / 2f); val dy = (y - n / 2f) / (n / 2f)
            val d = sqrt(dx * dx + dy * dy)
            // 520 of 800: the circle's edge, softened like a 70 pt blur
            val a = (1 / (1 + exp((d - 0.62f) / 0.11f))).coerceIn(0f, 1f)
            var ang = (kotlin.math.atan2(dy, dx) / (2 * PI)).toFloat()
            if (ang < 0) ang += 1f
            val f = ang * (stops.size - 1); val i = f.toInt().coerceAtMost(stops.size - 2); val m = f - i
            fun ch(sh: Int) = (((stops[i] shr sh) and 255) * (1 - m) + ((stops[i + 1] shr sh) and 255) * m).toInt()
            px[y * n + x] = Color.argb((a * 255).toInt(), ch(16), ch(8), ch(0))
        }
        return Bitmap.createBitmap(px, n, n, Bitmap.Config.ARGB_8888)
    }

    /** caustic ripples: thin bright lines where waves of light cross, fading out towards the edge */
    private fun ripplesBitmap(): Bitmap {
        val n = 240
        val px = IntArray(n * n)
        for (y in 0 until n) for (x in 0 until n) {
            val u = x.toDouble() / n * 9; val v = y.toDouble() / n * 9
            val a = sin(u * 1.3 + sin(v * 0.9) * 1.8 + 0.7)
            val b = sin(v * 1.1 + sin(u * 1.2) * 1.6 + 2.1)
            val l = max(0.0, 1 - abs(a + b) * 0.9).pow(6)
            val dx = (x - n / 2.0) / (n / 2.0); val dy = (y - n / 2.0) / (n / 2.0)
            val m = max(0.0, 1 - sqrt(dx * dx + dy * dy))
            px[y * n + x] = Color.argb(min(255.0, l * m * m * 120).toInt(), 255, 255, 255)
        }
        return Bitmap.createBitmap(px, n, n, Bitmap.Config.ARGB_8888)
    }

    private fun grainBitmap(): Bitmap {
        val n = 128
        val r = Random(7)
        val px = IntArray(n * n) { val v = r.nextInt(256); Color.argb(255, v, v, v) }
        return Bitmap.createBitmap(px, n, n, Bitmap.Config.ARGB_8888)
    }

    companion object {
        private const val COUNT = 30
        /** the size shapes are made at before scaling */
        private const val U = 100f
        private val GROUND = intArrayOf(0xFFF5F5F7.toInt(), 0xFF0E0E11.toInt())
        private val LIFT = intArrayOf(0xFFFBFBFD.toInt(), 0xFF17161C.toInt())
        private val FILM = intArrayOf(0xFFFF8FD0.toInt(), 0xFF8FB8FF.toInt(), 0xFF7FECC8.toInt(), 0xFFFFE98A.toInt(), 0xFFFFAB8F.toInt(), 0xFFC49BFF.toInt(), 0xFFFF8FD0.toInt())

        private fun argb(a: Double, r: Int, g: Int, b: Int) = Color.argb((a * 255).toInt(), r, g, b)
        private fun alpha(a: Float) = (a.coerceIn(0f, 1f) * 255).toInt()
        private fun radial(stops: FloatArray, colors: IntArray, radius: Float = 1f) =
            RadialGradient(0f, 0f, radius * U, colors, stops, Shader.TileMode.CLAMP)
    }
}
