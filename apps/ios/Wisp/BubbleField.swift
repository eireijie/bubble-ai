import SwiftUI
import UIKit

/**
 * The welcome screen's stage (2026-11-26, canvas "Phone welcome", round 2): about 30 soap bubbles rising
 * at three depths around the big bubble with eyes. Everything is drawn in one Canvas on a TimelineView,
 * capped at 60 frames a second and paused when the screen is covered, the app is in the background or
 * the view is gone. Bubbles drift away from a finger; tapping one pops it, tapping the big bubble makes
 * it hop. With Reduce Motion everything holds still and only the big bubble's eyes blink.
 */
struct WelcomeStage: View {
  /** false while something covers the screen (the scanner) */
  var running = true
  /** play the opening: the big bubble rises into place and the small ones fade in */
  var opening = true
  @ReduceMotion private var reduceMotion
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.scenePhase) private var scenePhase
  @State private var sim = SoapBubbles()
  @State private var onScreen = false

  var body: some View {
    let live = running && onScreen && scenePhase == .active
    // Reduce Motion only needs enough frames for a blink
    TimelineView(.animation(minimumInterval: reduceMotion ? 1.0 / 15 : 1.0 / 60, paused: !live)) { tl in
      Canvas { ctx, size in
        sim.frame(tl.date.timeIntervalSinceReferenceDate, size: size, still: reduceMotion, opening: opening)
        sim.draw(ctx, dark: colorScheme == .dark, still: reduceMotion)
      }
    }
    .contentShape(Rectangle())
    .gesture(
      DragGesture(minimumDistance: 0, coordinateSpace: .local)
        .onChanged { g in
          if sim.finger == nil, let hit = sim.touchDown(g.startLocation, still: reduceMotion) {
            if hit == .popped { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
          }
          sim.finger = g.location
        }
        .onEnded { _ in sim.finger = nil }
    )
    .onAppear { onScreen = true }
    .onDisappear { onScreen = false }
    .accessibilityHidden(true)
  }
}

/** The bubbles and the big bubble's state, stepped once a frame. A class so drawing can move it on without redrawing SwiftUI. */
final class SoapBubbles {
  struct Bubble {
    /** depth: 0 at the back (small, soft, faint) to 1 in front of the big bubble */
    var z: CGFloat = 0
    var r: CGFloat = 0
    var x0: CGFloat = 0, x: CGFloat = 0, y: CGFloat = 0
    /** rising speed in points a second, side-to-side sway (amplitude, frequency, phase) */
    var vy: CGFloat = 0, amp: CGFloat = 0, freq: Double = 0, phase: Double = 0
    var hue: Double = 0
    /** pushed by a finger: sideways offset and its speed, extra vertical speed */
    var dx: CGFloat = 0, vx: CGFloat = 0, dvy: CGFloat = 0
    var life: Double = 0, age: Double = 0
    /** seconds into popping, or -1 */
    var pop: Double = -1
    /** the easter egg: two of them have tiny eyes */
    var face = false
    var front: Bool { z > 0.86 }
  }

  enum Hit { case popped, hopped }

  static let count = 30
  static let mascot: CGFloat = 200
  /** the rainbow film, the canvas's FILM */
  static let film: [Color] = ["#ff8fd0", "#8fb8ff", "#7fecc8", "#ffe98a", "#ffab8f", "#c49bff", "#ff8fd0"].map { Color(hex: $0) }

  var bubbles: [Bubble] = []
  var finger: CGPoint?
  private var size: CGSize = .zero
  private var seed: Int64 = 11
  private var last: Double = 0
  private var start: Double = 0
  /** what time the bubbles move by: stands still with Reduce Motion */
  private var clock: Double = 0
  private var now: Double = 0
  private var hopAt: Double = -10
  private var gaze: CGPoint = CGPoint(x: 0.7, y: -0.2)
  private var gazeTarget: CGPoint = CGPoint(x: 0.7, y: -0.2)
  private var nextGlance: Double = 0
  private var openingPlays = true

  private func rnd() -> CGFloat {
    seed = (seed * 16807) % 2_147_483_647
    return CGFloat(seed - 1) / 2_147_483_646
  }

  /** Centre of the big bubble at rest: the middle, 42% of the way down. */
  var home: CGPoint { CGPoint(x: size.width / 2, y: size.height * 0.42) }

  private func spawn(_ b: inout Bubble, first: Bool) {
    let z = rnd()
    b.z = z
    b.r = z > 0.9 ? 26 + rnd() * 18 : 3 + pow(z, 1.4) * 22 + rnd() * 3
    if b.face { b.r = max(b.r, 10) }
    b.x0 = rnd() * size.width
    b.y = first ? rnd() * (size.height + 60) : size.height + b.r + rnd() * 80
    b.vy = 8 + z * 26 + rnd() * 6
    b.amp = 6 + rnd() * 12
    b.freq = Double(0.25 + rnd() * 0.35)
    b.phase = Double(rnd() * 6.28)
    b.hue = Double(rnd() * 6.28)
    b.vx = 0; b.dvy = 0; b.dx = 0
    b.life = Double(8 + rnd() * 32)
    b.age = first ? Double(rnd()) * b.life * 0.8 : 0
    b.pop = -1
    b.x = b.x0
  }

  /** With Reduce Motion the bubbles stand still, so keep them off the big bubble and the words under it. */
  private func spawn(_ b: inout Bubble, first: Bool, clear: Bool) {
    spawn(&b, first: first)
    guard clear else { return }
    for _ in 0..<8 {
      let h = home
      let onMascot = hypot(b.x0 - h.x, b.y - h.y) < Self.mascot / 2 + b.r + 6
      let onWords = abs(b.y - (h.y + 150)) < 50 + b.r && abs(b.x0 - h.x) < 150
      if !onMascot && !onWords { return }
      spawn(&b, first: first)
    }
  }

  /** Moves everything on to this frame. */
  func frame(_ t: Double, size: CGSize, still: Bool, opening: Bool) {
    if !bubbles.isEmpty, size != self.size, self.size.width > 0 {
      // turned or resized: keep each bubble at the same place across the screen
      let k = size.width / self.size.width
      for i in bubbles.indices { bubbles[i].x0 *= k }
    }
    self.size = size
    if bubbles.isEmpty, size.width > 0 {
      bubbles = (0..<Self.count).map { _ in Bubble() }
      bubbles[4].face = true
      bubbles[17].face = true
      for i in bubbles.indices { spawn(&bubbles[i], first: true, clear: still) }
      bubbles[4].r = max(bubbles[4].r, 13)
      bubbles[17].r = max(bubbles[17].r, 10)
      start = t
      openingPlays = opening
    }
    // a frame after a pause (backgrounded, covered) carries on instead of jumping
    let dt = last == 0 ? 0 : min(0.05, max(0, t - last))
    last = t
    now = t
    if !still { clock += dt }

    for i in bubbles.indices {
      var b = bubbles[i]
      defer { bubbles[i] = b }
      if b.pop >= 0 {
        b.pop += dt
        // with Reduce Motion a popped bubble comes back where it can be seen, not from below the screen
        if b.pop > 0.25 { spawn(&b, first: still, clear: still); if still { b.age = 0 } }
        continue
      }
      b.age += dt
      if still {
        b.x = b.x0
        continue
      }
      if let p = finger {
        // drift away from the finger
        let ddx = b.x - p.x, ddy = b.y - p.y, d = max(0.001, hypot(ddx, ddy)), reach = 90 + b.r
        if d < reach {
          let f = (1 - d / reach) * 700 * (0.6 + b.z * 0.4)
          b.vx += ddx / d * f * dt
          b.dvy += ddy / d * f * dt
        }
      }
      let damp = CGFloat(exp(-1.4 * dt))
      b.vx *= damp; b.dvy *= damp
      b.dx += b.vx * dt
      b.y += (-b.vy + b.dvy) * dt
      b.x = b.x0 + b.dx + b.amp * CGFloat(sin(clock * b.freq + b.phase))
      if b.age > b.life { b.pop = 0 }
      if b.y < -b.r - 20 || b.x < -60 || b.x > size.width + 60 { spawn(&b, first: false) }
    }

    // where the big bubble's eyes look: at the finger, otherwise a glance to one side every few seconds
    if !still {
      if let p = finger {
        let c = mascotCenter
        gazeTarget = CGPoint(x: (p.x - c.x) / 100, y: (p.y - (c.y - 10)) / 100)
      } else if t > nextGlance {
        let side: CGFloat = Bool.random() ? -1 : 1
        gazeTarget = CGPoint(x: side * CGFloat.random(in: 0.5...0.9), y: -CGFloat.random(in: 0...0.4))
        nextGlance = t + Double.random(in: 3...7)
      }
      let len = max(1, hypot(gazeTarget.x, gazeTarget.y))
      let goal = CGPoint(x: gazeTarget.x / len, y: gazeTarget.y / len)
      // eased like the canvas's transition: 0.22 s on a finger, 0.45 s otherwise
      let k = CGFloat(1 - exp(-dt / (finger == nil ? 0.12 : 0.06)))
      gaze.x += (goal.x - gaze.x) * k
      gaze.y += (goal.y - gaze.y) * k
    }
  }

  /** The big bubble's centre now: home, plus its slow sway. */
  var mascotCenter: CGPoint {
    var c = home
    c.y += 6 * CGFloat(sin(clock * 0.33))
    return c
  }

  /** A finger came down: pop the bubble under it, or make the big bubble hop. */
  func touchDown(_ p: CGPoint, still: Bool) -> Hit? {
    let c = mascotCenter
    let onMascot = hypot(p.x - c.x, p.y - c.y) < Self.mascot / 2
    let hit = bubbles.indices
      .filter { bubbles[$0].pop < 0 && hypot(p.x - bubbles[$0].x, p.y - bubbles[$0].y) < bubbles[$0].r + 8 }
      .max { bubbles[$0].z < bubbles[$1].z }
    if let i = hit, bubbles[i].front || !onMascot {
      bubbles[i].pop = 0
      return .popped
    }
    if onMascot, !still {
      hopAt = now
      return .hopped
    }
    return nil
  }

  // MARK: drawing

  func draw(_ ctx: GraphicsContext, dark: Bool, still: Bool) {
    let elapsed = now - start
    // opening: the small bubbles fade in over 1.4 s
    var field = ctx
    if openingPlays { field.opacity = min(1, max(0, elapsed / 1.4)) }
    let t = still ? 0 : clock
    for b in bubbles where !b.front { b.pop >= 0 ? drawPop(field, b, dark) : drawBubble(field, b, t, dark) }
    drawMascot(ctx, dark: dark, still: still, elapsed: elapsed)
    for b in bubbles where b.front { b.pop >= 0 ? drawPop(field, b, dark) : drawBubble(field, b, t, dark) }
  }

  private func drawBubble(_ base: GraphicsContext, _ b: Bubble, _ t: Double, _ dark: Bool) {
    let r = b.r
    let fade = min(1, b.age / 0.8)
    let a = Double(0.4 + 0.6 * b.z) * fade
    guard a > 0.01 else { return }
    var ctx = base
    ctx.translateBy(x: b.x, y: b.y)
    let squash = 0.03 * CGFloat(sin(t * 1.9 + b.phase))
    ctx.scaleBy(x: 1 + squash, y: 1 - squash)
    let circle = Path(ellipseIn: CGRect(x: -r, y: -r, width: r * 2, height: r * 2))
    let soft = b.z < 0.28

    // body: a clear middle; the edge darkens where light bends (light) or catches the light (dark)
    var body = ctx
    body.opacity = a
    let edge: [Gradient.Stop] = dark
      ? [.init(color: .clear, location: 0), .init(color: Color(red: 205 / 255, green: 215 / 255, blue: 1, opacity: 0.06), location: 0.6),
         .init(color: Color(red: 235 / 255, green: 240 / 255, blue: 1, opacity: soft ? 0.2 : 0.32), location: 0.94), .init(color: Color(red: 235 / 255, green: 240 / 255, blue: 1, opacity: 0.04), location: 1)]
      : [.init(color: .clear, location: 0), .init(color: Color(red: 165 / 255, green: 180 / 255, blue: 225 / 255, opacity: 0.10), location: 0.6),
         .init(color: Color(red: 70 / 255, green: 82 / 255, blue: 125 / 255, opacity: soft ? 0.18 : 0.28), location: 0.94), .init(color: Color(red: 70 / 255, green: 82 / 255, blue: 125 / 255, opacity: 0.04), location: 1)]
    body.fill(circle, with: .radialGradient(Gradient(stops: edge), center: .zero, startRadius: r * 0.5, endRadius: r))

    // the far-back bubbles are out of focus: no sharp film, glint or reflection, just a soft rim
    if soft { return }

    // the iridescent film along the rim, turning
    var film = ctx
    film.opacity = a * (dark ? 0.7 : 0.55)
    let turn = Angle.radians(b.hue + t * 0.35)
    let shading = GraphicsContext.Shading.conicGradient(Gradient(colors: Self.film), center: .zero, angle: turn)
    film.stroke(Path(ellipseIn: CGRect(x: -r * 0.94, y: -r * 0.94, width: r * 1.88, height: r * 1.88)), with: shading, lineWidth: max(0.8, r * 0.09))
    if r > 9 {
      // a swirl of film inside the lower right
      var swirl = ctx
      swirl.opacity = a * (dark ? 0.3 : 0.22)
      let wob = sin(t * 0.4 + b.phase) * 0.2
      var arc = Path()
      arc.addArc(center: .zero, radius: r * 0.74, startAngle: .radians(0.15 + wob), endAngle: .radians(1.5 + wob), clockwise: false)
      swirl.stroke(arc, with: shading, lineWidth: r * 0.2)
    }
    // a window's reflection, lower right
    var refl = ctx
    refl.opacity = a * 0.45
    var arc = Path()
    arc.addArc(center: .zero, radius: r * 0.8, startAngle: .radians(0.35), endAngle: .radians(1.15), clockwise: false)
    refl.stroke(arc, with: .color(.white), style: StrokeStyle(lineWidth: max(0.6, r * 0.05), lineCap: .round))
    // a soft highlight, upper left, and a small glint
    var hl = ctx
    hl.opacity = a
    hl.translateBy(x: -r * 0.36, y: -r * 0.42)
    hl.rotate(by: .radians(-0.65))
    hl.scaleBy(x: 1, y: 0.48)
    let hr = r * 0.38
    hl.fill(Path(ellipseIn: CGRect(x: -hr, y: -hr, width: hr * 2, height: hr * 2)), with: .radialGradient(
      Gradient(stops: [.init(color: .white.opacity(0.9), location: 0), .init(color: .white.opacity(0.3), location: 0.55), .init(color: .white.opacity(0), location: 1)]),
      center: .zero, startRadius: 0, endRadius: hr))
    if r > 6 {
      var g = ctx
      g.opacity = a
      let gr = max(0.7, r * 0.055)
      g.fill(Path(ellipseIn: CGRect(x: -r * 0.2 - gr, y: -r * 0.5 - gr, width: gr * 2, height: gr * 2)), with: .color(.white))
    }
    if b.face {
      var eyes = ctx
      eyes.opacity = a
      let ink = dark ? Color(hex: "#f4f4f2") : Color(hex: "#141414")
      for side: CGFloat in [-1, 1] {
        eyes.fill(Path(ellipseIn: CGRect(x: side * r * 0.2 - r * 0.08, y: -r * 0.04 - r * 0.15, width: r * 0.16, height: r * 0.3)), with: .color(ink))
      }
    }
  }

  /** A pop: a thin ring opening out and a few droplets, over a quarter of a second. */
  private func drawPop(_ base: GraphicsContext, _ b: Bubble, _ dark: Bool) {
    let k = CGFloat(min(1, b.pop / 0.25))
    var ctx = base
    ctx.translateBy(x: b.x, y: b.y)
    var ring = ctx
    ring.opacity = Double(1 - k) * 0.7
    let rr = b.r * (1 + k * 0.45)
    ring.stroke(Path(ellipseIn: CGRect(x: -rr, y: -rr, width: rr * 2, height: rr * 2)),
                with: .color(dark ? Color(red: 235 / 255, green: 240 / 255, blue: 1, opacity: 0.9) : Color(red: 90 / 255, green: 100 / 255, blue: 150 / 255, opacity: 0.6)), lineWidth: 1)
    let drop = dark ? Color(hex: "#e8ecff") : Color(hex: "#8f9ac0")
    let dr = max(0.6, b.r * 0.05) * (1 - k)
    for i in 0..<7 {
      let ang = Double(i) * 0.9 + b.phase, d = b.r * (1 + k * 0.9)
      let c = CGPoint(x: CGFloat(cos(ang)) * d, y: CGFloat(sin(ang)) * d)
      ctx.fill(Path(ellipseIn: CGRect(x: c.x - dr, y: c.y - dr, width: dr * 2, height: dr * 2)), with: .color(drop))
    }
  }

  // MARK: the big bubble

  /** Slight changes of shape as it floats, as CSS-style corner radii (the canvas's morph). */
  private static let round = BubbleForm.Radii.all(0.5)
  private static let morphA = BubbleForm.Radii(x: [0.52, 0.48, 0.51, 0.49], y: [0.48, 0.52, 0.48, 0.52])
  private static let morphB = BubbleForm.Radii(x: [0.48, 0.52, 0.49, 0.51], y: [0.52, 0.48, 0.52, 0.48])

  private func drawMascot(_ base: GraphicsContext, dark: Bool, still: Bool, elapsed: Double) {
    let s = Self.mascot
    let c = mascotCenter
    let t = clock
    var ctx = base

    // opening: rises 160 pt from smaller and fades in over 1.2 s (a fade alone with Reduce Motion)
    var rise: CGFloat = 0, grow: CGFloat = 1
    if openingPlays, elapsed < 1.2 {
      let p = elapsed / 1.2
      let e = CGFloat(1 - pow(1 - p, 3))
      ctx.opacity = min(1, elapsed / 1.0)
      if !still { rise = 160 * (1 - e); grow = 0.7 + 0.3 * e }
    }

    // the soft shadow under it stays on the ground
    var shadow = ctx
    let sw = s * 0.56, sh = s * 0.08
    let shadowRect = CGRect(x: c.x - sw / 2, y: c.y - s / 2 + s * 1.06, width: sw, height: sh)
    shadow.translateBy(x: shadowRect.midX, y: shadowRect.midY)
    shadow.scaleBy(x: sw / 2, y: sh / 2)
    let shade = dark ? Color(red: 160 / 255, green: 150 / 255, blue: 1, opacity: 0.18) : Color(red: 120 / 255, green: 110 / 255, blue: 200 / 255, opacity: 0.16)
    shadow.fill(Path(ellipseIn: CGRect(x: -1, y: -1, width: 2, height: 2)), with: .radialGradient(Gradient(colors: [shade, shade.opacity(0)]), center: .zero, startRadius: 0, endRadius: 1))

    // the box it's drawn in, with wobble and hop about a point 85% down (the canvas's transform-origin)
    var (sx, sy, ty): (CGFloat, CGFloat, CGFloat) = (1, 1, 0)
    if !still {
      let p = GhostAnimation.phase(t, 5.2)
      sx = CGFloat(GhostAnimation.key(p, [(0, 1), (0.25, 1.02), (0.5, 0.985), (0.75, 1.01), (1, 1)]))
      sy = CGFloat(GhostAnimation.key(p, [(0, 1), (0.25, 0.98), (0.5, 1.018), (0.75, 0.99), (1, 1)]))
      ty = CGFloat(GhostAnimation.key(p, [(0, 0), (0.25, 0), (0.5, -0.015), (0.75, 0), (1, 0)])) * s
      let h = now - hopAt
      if h >= 0, h < 0.62 {
        let q = h / 0.62
        ty += CGFloat(GhostAnimation.key(q, [(0, 0), (0.4, -0.1), (0.75, 0), (1, 0)])) * s
        sx *= CGFloat(GhostAnimation.key(q, [(0, 1), (0.4, 0.97), (0.75, 1.04), (1, 1)]))
        sy *= CGFloat(GhostAnimation.key(q, [(0, 1), (0.4, 1.04), (0.75, 0.96), (1, 1)]))
      }
    }
    var body = ctx
    body.translateBy(x: c.x, y: c.y - s / 2 + s * 0.85 + ty + rise)
    body.scaleBy(x: sx * grow, y: sy * grow)
    body.translateBy(x: -s / 2, y: -s * 0.85)
    let box = CGRect(x: 0, y: 0, width: s, height: s)
    let mid = CGPoint(x: s / 2, y: s / 2)

    var radii = Self.round
    if !still {
      let p = GhostAnimation.phase(t, 7)
      func ease(_ x: Double) -> CGFloat { CGFloat(x * x * (3 - 2 * x)) }
      if p < 1 / 3 { radii = Self.round.mix(Self.morphA, ease(p * 3)) }
      else if p < 2 / 3 { radii = Self.morphA.mix(Self.morphB, ease((p - 1 / 3) * 3)) }
      else { radii = Self.morphB.mix(Self.round, ease((p - 2 / 3) * 3)) }
    }
    let outline = BubblePainter.path(box, radii)

    var glass = body
    glass.clip(to: outline)
    // the edge, darker where the light bends (in dark mode it catches the light)
    let edge: [Gradient.Stop] = dark
      ? [.init(color: .clear, location: 0.62), .init(color: Color(red: 200 / 255, green: 210 / 255, blue: 1, opacity: 0.07), location: 0.8),
         .init(color: Color(red: 235 / 255, green: 240 / 255, blue: 1, opacity: 0.30), location: 0.96), .init(color: Color(red: 235 / 255, green: 240 / 255, blue: 1, opacity: 0.05), location: 1)]
      : [.init(color: .clear, location: 0.62), .init(color: Color(red: 160 / 255, green: 175 / 255, blue: 220 / 255, opacity: 0.10), location: 0.8),
         .init(color: Color(red: 70 / 255, green: 80 / 255, blue: 120 / 255, opacity: 0.26), location: 0.96), .init(color: Color(red: 70 / 255, green: 80 / 255, blue: 120 / 255, opacity: 0.06), location: 1)]
    glass.fill(Path(box), with: .radialGradient(Gradient(stops: edge), center: mid, startRadius: 0, endRadius: s / 2))

    // a swirl of film in the lower right, turning slowly the other way
    var swirlCtx = glass
    swirlCtx.blendMode = .screen
    swirlCtx.opacity = dark ? 0.45 : 0.32
    swirlCtx.drawLayer { layer in
      let swirl = Gradient(stops: [.init(color: .clear, location: 0), .init(color: Color(hex: "#ffb3e0"), location: 0.12), .init(color: Color(hex: "#9fd0ff"), location: 0.24),
                                   .init(color: Color(hex: "#a6f5d8"), location: 0.36), .init(color: .clear, location: 0.5), .init(color: .clear, location: 1)])
      layer.fill(Path(box), with: .conicGradient(swirl, center: CGPoint(x: s * 0.6, y: s * 0.7), angle: .degrees(200 - 360 * GhostAnimation.phase(t, 31))))
      // only a soft patch of it shows, fading out from the lower right (the canvas's ellipse mask)
      var mask = layer
      mask.blendMode = .destinationIn
      mask.translateBy(x: s * 0.64, y: s * 0.74)
      mask.scaleBy(x: s * 0.6, y: s * 0.4)
      mask.fill(Path(CGRect(x: -3, y: -3, width: 6, height: 6)), with: .radialGradient(
        Gradient(stops: [.init(color: .black, location: 0), .init(color: .clear, location: 0.7)]), center: .zero, startRadius: 0, endRadius: 1))
    }

    // the rainbow film at the rim: clear inside, strongest just inside the edge
    body.drawLayer { layer in
      layer.opacity = dark ? 0.8 : 0.6
      let film = GraphicsContext.Shading.conicGradient(Gradient(colors: Self.film), center: mid, angle: .degrees(40 + 360 * GhostAnimation.phase(t, 16)))
      layer.fill(outline, with: film)
      layer.blendMode = .destinationIn
      let ring = Gradient(stops: [.init(color: .clear, location: 0.78), .init(color: .black, location: 0.91), .init(color: .black, location: 0.96), .init(color: .clear, location: 1)])
      layer.fill(outline, with: .radialGradient(ring, center: mid, startRadius: 0, endRadius: s * 0.52))
    }

    // a faint window reflection, lower right
    var refl = body
    refl.translateBy(x: mid.x, y: mid.y)
    refl.rotate(by: .degrees(18))
    let rr = s * 0.39
    var bottom = Path(), right = Path()
    bottom.addArc(center: .zero, radius: rr, startAngle: .degrees(45), endAngle: .degrees(135), clockwise: false)
    right.addArc(center: .zero, radius: rr, startAngle: .degrees(-45), endAngle: .degrees(45), clockwise: false)
    refl.stroke(bottom, with: .color(.white.opacity(0.42)), style: StrokeStyle(lineWidth: 2, lineCap: .round))
    refl.stroke(right, with: .color(.white.opacity(0.26)), style: StrokeStyle(lineWidth: 2, lineCap: .round))

    // a soft highlight, upper left, and a small glint
    var hl = body
    hl.translateBy(x: s * (0.17 + 0.19), y: s * (0.13 + 0.095))
    hl.rotate(by: .degrees(-36))
    hl.scaleBy(x: s * 0.19, y: s * 0.095)
    hl.fill(Path(ellipseIn: CGRect(x: -1, y: -1, width: 2, height: 2)), with: .radialGradient(
      Gradient(stops: [.init(color: .white.opacity(0.92), location: 0), .init(color: .white.opacity(0.35), location: 0.55), .init(color: .white.opacity(0), location: 1)]),
      center: .zero, startRadius: 0, endRadius: 1))
    let glint = CGRect(x: s * 0.25, y: s * 0.29, width: s * 0.05, height: s * 0.05)
    body.fill(Path(ellipseIn: glint.insetBy(dx: -4, dy: -4)), with: .radialGradient(Gradient(colors: [.white.opacity(0.8), .white.opacity(0)]), center: CGPoint(x: glint.midX, y: glint.midY), startRadius: 0, endRadius: glint.width / 2 + 4))
    body.fill(Path(ellipseIn: glint), with: .color(.white))

    // the eyes: blink every 5.4 s (even with Reduce Motion), look around or at your finger
    let p = GhostAnimation.phase(now - start, 5.4)
    let blink = CGFloat(GhostAnimation.key(p, [(0, 1), (0.93, 1), (0.95, 0.12), (1, 1)]))
    let look = still ? CGPoint(x: 0.7 * 16, y: -0.2 * 12) : CGPoint(x: gaze.x * 16, y: gaze.y * 12)
    let ew = s * 0.10, eh = s * 0.17
    let ink = dark ? Color(hex: "#f4f4f2") : Color(hex: "#141414")
    for left in [0.33, 0.57] as [CGFloat] {
      let cx = s * left + ew / 2 + look.x, cy = s * 0.37 + eh / 2 + look.y
      body.fill(Path(ellipseIn: CGRect(x: cx - ew / 2, y: cy - eh * blink / 2, width: ew, height: eh * blink)), with: .color(ink))
    }
  }
}
