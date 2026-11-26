import SwiftUI
import UIKit

/**
 * Bubbles (2026-11-25, canvas "Bubble AI, bubbles" v20; web: components/Bubble.tsx and bubble.css).
 * Every agent is a clear bubble with a rainbow rim and highlights, tinted with its own colour, and
 * two eyes (no mouth) that blink, glance around and look toward your finger while you touch the
 * screen. Light mode keeps the glass thin; dark mode frosts it in the agent's colour, lifted
 * towards white, with dark eyes. Moods follow the web: idle wobbles, working bobs and sends up tiny
 * bubbles, needs you hops with an orange dot, offline is drowsy. Reduce Motion stills everything.
 */
enum BubbleForm: String, CaseIterable, Identifiable {
  case round, squircle, egg, drop, blob, capsule, double, cluster
  var id: String { rawValue }
  var name: String { rawValue.capitalized }

  /** A look's shape: looks saved before bubbles have none and are round. */
  init(_ look: GhostLook?) { self = look?.bubble.flatMap(BubbleForm.init(rawValue:)) ?? .round }

  /** CSS border-radius per corner as fractions of the part's width (x) and height (y): TL, TR, BR, BL. */
  struct Radii {
    var x: [CGFloat]
    var y: [CGFloat]
    static func all(_ r: CGFloat) -> Radii { Radii(x: [r, r, r, r], y: [r, r, r, r]) }
    static let pill = Radii(x: [-1, -1, -1, -1], y: [-1, -1, -1, -1])
    func mix(_ o: Radii, _ t: CGFloat) -> Radii {
      Radii(x: zip(x, o.x).map { $0 + ($1 - $0) * t }, y: zip(y, o.y).map { $0 + ($1 - $0) * t })
    }
  }

  struct Part {
    /** left, top, width, height in fractions of the bubble */
    var rect: CGRect
    var radii: Radii
    var rotation: Double = 0
  }

  private static func P(_ l: CGFloat, _ t: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: Radii, _ rot: Double = 0) -> Part {
    Part(rect: CGRect(x: l / 100, y: t / 100, width: w / 100, height: h / 100), radii: r, rotation: rot)
  }

  var parts: [Part] {
    switch self {
    case .round: [Self.P(0, 0, 100, 100, .all(0.5))]
    case .squircle: [Self.P(2, 2, 96, 96, .all(0.4))]
    case .egg: [Self.P(7, 0, 86, 100, Radii(x: [0.5, 0.5, 0.5, 0.5], y: [0.58, 0.58, 0.42, 0.42]))]
    case .drop: [Self.P(10, 14, 80, 80, Radii(x: [0.5, 0, 0.5, 0.5], y: [0.5, 0, 0.5, 0.5]), -45)]
    case .blob: [Self.P(0, 4, 100, 92, Self.blobRadii)]
    case .capsule: [Self.P(0, 16, 100, 70, .pill)]
    case .double: [Self.P(0, 18, 82, 82, .all(0.5)), Self.P(60, 0, 40, 40, .all(0.5))]
    case .cluster: [Self.P(2, 26, 72, 72, .all(0.5)), Self.P(50, 6, 44, 44, .all(0.5)), Self.P(64, 54, 34, 34, .all(0.5))]
    }
  }

  /** where the face sits, in fractions of the bubble, from the centre */
  var face: CGPoint {
    switch self {
    case .egg: CGPoint(x: 0, y: 0.04)
    case .drop: CGPoint(x: 0, y: 0.09)
    case .blob, .capsule: CGPoint(x: 0, y: 0.02)
    case .double: CGPoint(x: -0.09, y: 0.10)
    case .cluster: CGPoint(x: -0.12, y: 0.15)
    default: .zero
    }
  }

  /** round and blob shapes breathe: their edge never sits still */
  var morphs: Bool { self == .round || self == .blob }

  static let blobRadii = Radii(x: [0.58, 0.42, 0.54, 0.46], y: [0.46, 0.58, 0.42, 0.54])
  static let morph33 = Radii(x: [0.54, 0.46, 0.52, 0.48], y: [0.47, 0.54, 0.46, 0.53])
  static let morph66 = Radii(x: [0.47, 0.53, 0.46, 0.54], y: [0.53, 0.47, 0.54, 0.46])
}

/** The bubble colours offered in Look (any #rrggbb works too); core/appearance.ts BUBBLE_COLORS. */
enum BubbleColors {
  static let all: [(name: String, hex: String)] = [
    ("Violet", "#a59bff"), ("Blue", "#6cc4ff"), ("Pink", "#ff7d8f"),
    ("Amber", "#ffc04d"), ("Green", "#74dba6"), ("Orange", "#ff9d6b"),
  ]

  private static func hash(_ s: String) -> Int {
    var h = 7
    for c in s.utf16 { h = (h * 31 + Int(c)) % 99991 }
    return h
  }

  private static func rgb(_ hex: String) -> [Double]? {
    guard hex.count == 7, hex.first == "#", let n = UInt32(hex.dropFirst(), radix: 16) else { return nil }
    return [Double((n >> 16) & 255), Double((n >> 8) & 255), Double(n & 255)]
  }

  /**
   * The colour a bubble is tinted with (web: ghostFamily.familyColor): the look's more vivid
   * colour, or one picked from the seed for old white and grey looks, so no bubble comes out white.
   */
  static func color(_ look: GhostLook?, seed: String) -> String {
    let candidates = [look?.color, look?.color2].compactMap { $0?.lowercased() }.filter { rgb($0) != nil }
    func chroma(_ c: String) -> Double { let v = rgb(c)!; return v.max()! - v.min()! }
    func light(_ c: String) -> Double { let v = rgb(c)!; return (v[0] * 0.299 + v[1] * 0.587 + v[2] * 0.114) / 255 }
    if let best = candidates.sorted(by: { chroma($0) > chroma($1) }).first {
      if chroma(best) >= 40 && light(best) > 0.2 { return best }
      if chroma(best) < 40 && light(best) < 0.55 { return best }
    }
    let key = seed.isEmpty ? (look?.color ?? "agent") : seed
    return all[hash(key.isEmpty ? "agent" : key) % all.count].hex
  }
}

/**
 * Where a finger is on the screen right now, for the bubbles' eyes. A recognizer on the window
 * watches touches without taking them, so every button, list and gesture works as before.
 */
final class BubbleTouch: UIGestureRecognizer, UIGestureRecognizerDelegate {
  nonisolated(unsafe) static var point: CGPoint?
  private static var installed = Set<ObjectIdentifier>()

  /** Adds the watcher to every window of the app once. */
  @MainActor static func install() {
    for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
      for window in scene.windows where !installed.contains(ObjectIdentifier(window)) {
        installed.insert(ObjectIdentifier(window))
        let r = BubbleTouch(target: nil, action: nil)
        r.cancelsTouchesInView = false
        r.delaysTouchesBegan = false
        r.delaysTouchesEnded = false
        r.delegate = r
        window.addGestureRecognizer(r)
      }
    }
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) { Self.point = touches.first?.location(in: nil) }
  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) { Self.point = touches.first?.location(in: nil) }
  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { Self.point = nil; state = .failed }
  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { Self.point = nil; state = .failed }
  override func reset() { Self.point = nil }
  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}

/** The eyes' current offset, eased towards where they should look (the web's 0.3 s transition). */
final class BubbleGaze {
  var frame: CGRect = .zero
  var offset: CGPoint = .zero
  var following = false
  var last: TimeInterval = 0
}

/** Draws one bubble at a moment in time. Shared by `GhostView` and the Look editor's shape picker. */
struct BubblePainter {
  var shape: BubbleForm
  var color: String
  var mood: GhostMood
  var size: CGFloat
  var dark: Bool
  var time: Double
  var animated: Bool
  /** eyes toward the finger, in points (already eased) */
  var gaze: CGPoint?
  /** seconds since a tap made it spin */
  var spin: Double?
  /** the colour behind the bubble, for the ring around the orange dot */
  var ground: Color

  private static let rim: [Color] = ["#ff7cc4", "#7fb0ff", "#6fe8c0", "#ffe27a", "#ff9c80", "#bf86ff", "#ff7cc4"].map { Color(hex: $0) }
  private var small: Bool { size <= 80 }

  func draw(_ ctx: GraphicsContext) {
    var ctx = ctx
    let s = size
    // body motion, about 50% across and 90% down (the web's transform-origin)
    let (dx, dy, sx, sy) = bodyMotion()
    if let spin, spin < 0.9 {
      let t = spin / 0.9
      let e = t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
      ctx.translateBy(x: s / 2, y: s / 2)
      ctx.rotate(by: .degrees(360 * e))
      ctx.translateBy(x: -s / 2, y: -s / 2)
    }
    drawRing(ctx)
    var body = ctx
    body.translateBy(x: s * 0.5 + dx * s, y: s * 0.9 + dy * s)
    body.scaleBy(x: sx, y: sy)
    body.translateBy(x: -s * 0.5, y: -s * 0.9)
    for part in shape.parts { drawPart(part, body) }
    drawEyes(body)
    drawFlag(ctx)
  }

  // MARK: motion (bub-wob, bub-bob, bub-hop)

  private func bodyMotion() -> (CGFloat, CGFloat, CGFloat, CGFloat) {
    guard animated else { return (0, 0, 1, 1) }
    func wob(_ d: Double) -> (CGFloat, CGFloat, CGFloat, CGFloat) {
      let p = GhostAnimation.phase(time, d)
      let x = GhostAnimation.key(p, [(0, 1), (0.25, 1.03), (0.5, 0.98), (0.75, 1.015), (1, 1)])
      let y = GhostAnimation.key(p, [(0, 1), (0.25, 0.97), (0.5, 1.025), (0.75, 0.985), (1, 1)])
      let ty = GhostAnimation.key(p, [(0, 0), (0.25, 0), (0.5, -0.02), (0.75, 0), (1, 0)])
      return (0, ty, x, y)
    }
    switch mood {
    case .working, .thinking:
      return (0, -0.05 * GhostAnimation.wave(time, 1.3), 1, 1)
    case .waiting, .error:
      let p = GhostAnimation.phase(time, 2.4)
      let ty = GhostAnimation.key(p, [(0, 0), (0.58, 0), (0.68, -0.10), (0.8, 0), (1, 0)])
      let x = GhostAnimation.key(p, [(0, 1), (0.58, 1), (0.68, 0.97), (0.8, 1.04), (1, 1)])
      let y = GhostAnimation.key(p, [(0, 1), (0.58, 1), (0.68, 1.04), (0.8, 0.96), (1, 1)])
      return (0, ty, x, y)
    case .asleep: return wob(7)
    default: return wob(4.2)
    }
  }

  // MARK: the glass

  private func radii(_ part: BubbleForm.Part) -> BubbleForm.Radii {
    guard animated, shape.morphs else { return part.radii }
    let base = shape == .blob ? BubbleForm.blobRadii : .all(0.5)
    let p = GhostAnimation.phase(time + 1.7, 6)
    func ease(_ t: Double) -> CGFloat { CGFloat(t * t * (3 - 2 * t)) }
    if p < 1 / 3 { return base.mix(BubbleForm.morph33, ease(p * 3)) }
    if p < 2 / 3 { return BubbleForm.morph33.mix(BubbleForm.morph66, ease((p - 1 / 3) * 3)) }
    return BubbleForm.morph66.mix(base, ease((p - 2 / 3) * 3))
  }

  /** A box with CSS-style elliptical corners. */
  static func path(_ r: CGRect, _ radii: BubbleForm.Radii) -> Path {
    let w = r.width, h = r.height
    var rx = radii.x.map { $0 < 0 ? min(w, h) / 2 : $0 * w }
    var ry = radii.y.map { $0 < 0 ? min(w, h) / 2 : $0 * h }
    // CSS scales all radii down when two corners on one side would overlap
    let f = min(1, w / max(rx[0] + rx[1], 0.001), w / max(rx[3] + rx[2], 0.001), h / max(ry[0] + ry[3], 0.001), h / max(ry[1] + ry[2], 0.001))
    rx = rx.map { $0 * f }; ry = ry.map { $0 * f }
    let k: CGFloat = 0.5523
    var p = Path()
    p.move(to: CGPoint(x: r.minX + rx[0], y: r.minY))
    p.addLine(to: CGPoint(x: r.maxX - rx[1], y: r.minY))
    p.addCurve(to: CGPoint(x: r.maxX, y: r.minY + ry[1]), control1: CGPoint(x: r.maxX - rx[1] * (1 - k), y: r.minY), control2: CGPoint(x: r.maxX, y: r.minY + ry[1] * (1 - k)))
    p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - ry[2]))
    p.addCurve(to: CGPoint(x: r.maxX - rx[2], y: r.maxY), control1: CGPoint(x: r.maxX, y: r.maxY - ry[2] * (1 - k)), control2: CGPoint(x: r.maxX - rx[2] * (1 - k), y: r.maxY))
    p.addLine(to: CGPoint(x: r.minX + rx[3], y: r.maxY))
    p.addCurve(to: CGPoint(x: r.minX, y: r.maxY - ry[3]), control1: CGPoint(x: r.minX + rx[3] * (1 - k), y: r.maxY), control2: CGPoint(x: r.minX, y: r.maxY - ry[3] * (1 - k)))
    p.addLine(to: CGPoint(x: r.minX, y: r.minY + ry[0]))
    p.addCurve(to: CGPoint(x: r.minX + rx[0], y: r.minY), control1: CGPoint(x: r.minX, y: r.minY + ry[0] * (1 - k)), control2: CGPoint(x: r.minX + rx[0] * (1 - k), y: r.minY))
    p.closeSubpath()
    return p
  }

  private func drawPart(_ part: BubbleForm.Part, _ ctx: GraphicsContext) {
    let s = size
    let box = CGRect(x: part.rect.minX * s, y: part.rect.minY * s, width: part.rect.width * s, height: part.rect.height * s)
    var local = ctx
    if part.rotation != 0 {
      local.translateBy(x: box.midX, y: box.midY)
      local.rotate(by: .degrees(part.rotation))
      local.translateBy(x: -box.midX, y: -box.midY)
    }
    let outline = Self.path(box, radii(part))
    let base = Color(hex: color)
    let tint = dark ? Self.mixWhite(color, 0.42) : base
    // light: 8% in the middle, 16%, 36% at the edge; dark: frosted 56%, 60%, 68%
    let (core, mid, edge): (Double, Double, Double) = dark ? (0.56, 0.60, 0.68) : (0.08, 0.16, 0.36)
    let asleep = mood == .asleep
    var glass = local
    glass.clip(to: outline)
    if asleep { glass.addFilter(.saturation(0.7)) }
    var fill = glass
    fill.translateBy(x: box.midX, y: box.minY + box.height * 0.54)
    fill.scaleBy(x: box.width * 0.72, y: box.height * 0.72)
    fill.fill(Path(CGRect(x: -2, y: -2, width: 4, height: 4)), with: .radialGradient(
      Gradient(stops: [.init(color: tint.opacity(core), location: 0), .init(color: tint.opacity(mid), location: 0.72), .init(color: tint.opacity(edge), location: 1)]),
      center: .zero, startRadius: 0, endRadius: 1))
    // a soft shade of its colour along the bottom inside edge, and a pale lip
    glass.stroke(outline.offsetBy(dx: 0, dy: -max(0.6, s * 0.012)), with: .color(base.opacity(0.22)), lineWidth: max(1, s * 0.03))
    glass.stroke(outline, with: .color(.white.opacity(dark ? 0.28 : 0.35)), lineWidth: 2)

    // the rainbow rim
    let angle = Angle.degrees(-70 + (animated ? GhostAnimation.phase(time, 9) * 360 : 0))
    let conic = GraphicsContext.Shading.conicGradient(Gradient(colors: Self.rim), center: CGPoint(x: box.midX, y: box.midY), angle: angle)
    if shape == .round {
      // the soft, wide rim of a round bubble: transparent inside, fading in towards the edge
      let (from, to): (CGFloat, CGFloat) = small ? (0.62, 0.86) : (0.84, 0.96)
      local.drawLayer { layer in
        layer.opacity = asleep ? 0.8 : 1
        layer.fill(outline, with: conic)
        layer.blendMode = .destinationIn
        layer.fill(outline, with: .radialGradient(Gradient(stops: [.init(color: .clear, location: from), .init(color: .black, location: to)]),
          center: CGPoint(x: box.midX, y: box.midY), startRadius: 0, endRadius: min(box.width, box.height) / 2))
      }
    } else {
      let rim = small ? 2.4 : max(1.2, min(2.4, s * 0.03))
      var ring = local
      ring.clip(to: outline)
      ring.opacity = asleep ? 0.8 : 1
      ring.stroke(outline, with: conic, lineWidth: rim * 2)
    }

    // highlights, upright even on a tilted part
    var shine = ctx
    shine.clip(to: outline.applying(rotationTransform(part, box)))
    func spot(_ cx: CGFloat, _ cy: CGFloat, _ rx: CGFloat, _ ry: CGFloat, _ a: Double) {
      var c = shine
      c.translateBy(x: box.minX + box.width * cx, y: box.minY + box.height * cy)
      c.scaleBy(x: box.width * rx, y: box.height * ry)
      c.fill(Path(ellipseIn: CGRect(x: -1, y: -1, width: 2, height: 2)), with: .radialGradient(
        Gradient(colors: [.white.opacity(a), .white.opacity(0)]), center: .zero, startRadius: 0, endRadius: 1))
    }
    spot(0.34, 0.23, 0.21, 0.12, 0.95)
    spot(0.72, 0.78, 0.07, 0.05, 0.72)
  }

  private func rotationTransform(_ part: BubbleForm.Part, _ box: CGRect) -> CGAffineTransform {
    guard part.rotation != 0 else { return .identity }
    return CGAffineTransform(translationX: box.midX, y: box.midY).rotated(by: part.rotation * .pi / 180).translatedBy(x: -box.midX, y: -box.midY)
  }

  static func mixWhite(_ hex: String, _ t: Double) -> Color {
    let v = GhostColor.rgb(GhostColor.safe(hex, fallback: "#a59bff")).map { ($0 + (255 - $0) * t) / 255 }
    return Color(red: v[0], green: v[1], blue: v[2])
  }

  // MARK: the face

  private func drawEyes(_ ctx: GraphicsContext) {
    let s = size
    var top: CGFloat = 0.38, height: CGFloat = 0.17
    switch mood {
    case .waiting: top = 0.35; height = 0.21
    case .listening: top = 0.36; height = 0.20
    case .asleep: top = 0.41; height = 0.12
    default: break
    }
    let w = s * 0.11, h = s * height
    var blink: CGFloat = 1
    var look = CGPoint.zero
    if animated {
      let blinkD = mood == .asleep ? 7.0 : 5.2
      let p = GhostAnimation.phase(time, blinkD)
      let working = mood == .working || mood == .thinking
      if !working { blink = CGFloat(GhostAnimation.key(p, [(0, 1), (0.93, 1), (0.95, 0.12), (1, 1)])) }
      if working {
        look.x = CGFloat(-0.45 + 0.9 * GhostAnimation.wave(time, 1.8)) * w
      } else if gaze == nil, mood == .awake || mood == .done || mood == .asleep {
        let q = GhostAnimation.phase(time, mood == .asleep ? 16 : 12)
        look.x = CGFloat(GhostAnimation.key(q, [(0, 0), (0.38, 0), (0.44, -0.4), (0.56, -0.4), (0.62, 0.4), (0.74, 0.4), (1, 0)])) * w
        look.y = CGFloat(GhostAnimation.key(q, [(0, 0), (0.38, 0), (0.44, -0.15), (0.56, -0.15), (0.62, 0.1), (0.74, 0.1), (1, 0)])) * h
      }
    }
    if let gaze { look.x += gaze.x; look.y += gaze.y }
    let eye = dark ? Color(hex: "#141414") : Color(hex: "#1c1c1c")
    let fx = shape.face.x * s, fy = shape.face.y * s
    for left in [0.31, 0.58] as [CGFloat] {
      let cx = left * s + w / 2 + fx + look.x
      let cy = top * s + h / 2 + fy + look.y
      let eh = h * blink
      ctx.fill(Path(ellipseIn: CGRect(x: cx - w / 2, y: cy - eh / 2, width: w, height: eh)), with: .color(eye))
    }
  }

  // MARK: the dot and the tiny rising bubbles

  private func drawFlag(_ ctx: GraphicsContext) {
    guard mood == .waiting || mood == .error else { return }
    let s = size
    let d = max(7, s * 0.26)
    let r = CGRect(x: s * 1.03 - d, y: -s * 0.03, width: d, height: d)
    ctx.fill(Path(ellipseIn: r.insetBy(dx: -2, dy: -2)), with: .color(ground))
    ctx.fill(Path(ellipseIn: r), with: .color(mood == .error ? Color(hex: "#ff453a") : Color(hex: "#ff9f0a")))
  }

  private func drawRing(_ ctx: GraphicsContext) {
    guard mood == .working || mood == .thinking else { return }
    let s = size
    let d = max(4, s * 0.16)
    let base = CGRect(x: s * 1.06 - d, y: s * 0.78 - d, width: d, height: d)
    let line: Color = dark ? .white.opacity(0.85) : Color(hex: "#1c1c1c").opacity(0.32)
    func bubble(_ r: CGRect, _ t: Double) {
      guard animated else { return }
      let opacity = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8
      let scale = 0.4 + 0.7 * t
      let moved = r.offsetBy(dx: r.width * 0.7 * t, dy: -r.height * 2.8 * t)
      let c = CGRect(x: moved.midX - moved.width * scale / 2, y: moved.midY - moved.height * scale / 2, width: moved.width * scale, height: moved.height * scale)
      ctx.stroke(Path(ellipseIn: c), with: .color(line.opacity(opacity)), lineWidth: 1)
    }
    let t = GhostAnimation.phase(time, 1.7)
    bubble(base, t)
    let small = CGRect(x: base.minX - d * 1.6, y: base.minY + d * 1.4, width: d * 0.65, height: d * 0.65)
    bubble(small, t)
  }
}

#Preview("Bubbles") {
  ScrollView {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 90))]) {
      ForEach(BubbleForm.allCases) { shape in
        VStack {
          GhostView(look: GhostLook(color: "#a59bff", bubble: shape.rawValue), seed: shape.rawValue, size: 70)
          Text(shape.name).font(.caption)
        }
      }
      ForEach(GhostMood.allCases, id: \.self) { mood in
        VStack {
          GhostView(look: GhostLook(color: "#6cc4ff"), seed: "n", size: 70, mood: mood)
          Text(mood.rawValue).font(.caption)
        }
      }
    }.padding()
  }
}

extension Color {
  /** "#rrggbb" for a picked colour. */
  var hexString: String {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
    func c(_ v: CGFloat) -> String { String(format: "%02x", Int((min(1, max(0, v)) * 255).rounded())) }
    return "#" + c(r) + c(g) + c(b)
  }
}

/** Small clear bubbles drifting up behind a big one (Look, web BubbleField). Still with Reduce Motion. */
struct BubbleField: View {
  var count = 14
  var maxSize: CGFloat = 10
  @ReduceMotion private var reduceMotion
  @Environment(\.colorScheme) private var colorScheme

  private struct Drop { var left, size, duration, delay, opacity, sway: Double }
  private var drops: [Drop] {
    var seed: Int64 = 11
    func rnd() -> Double { seed = (seed * 16807) % 2_147_483_647; return Double(seed - 1) / 2_147_483_646 }
    return (0..<count).map { _ in
      let duration = 9 + rnd() * 9
      return Drop(left: 0.02 + rnd() * 0.96, size: 4 + pow(rnd(), 2) * Double(maxSize), duration: duration, delay: -rnd() * duration, opacity: 0.35 + rnd() * 0.5, sway: 2.5 + rnd() * 3)
    }
  }

  var body: some View {
    if reduceMotion { Color.clear } else {
      let all = drops
      let edge: Color = colorScheme == .dark ? .white.opacity(0.55) : Color(hex: "#1c1c1c").opacity(0.16)
      TimelineView(.animation(minimumInterval: 1.0 / 30)) { tl in
        Canvas { ctx, size in
          let t = tl.date.timeIntervalSinceReferenceDate
          for d in all {
            let p = ((t - d.delay) / d.duration).truncatingRemainder(dividingBy: 1)
            let alpha = p < 0.12 ? p / 0.12 : p > 0.82 ? (1 - p) / 0.18 : 1
            let sway = sin((t / d.sway) * .pi) * 8
            let r = CGRect(x: d.left * size.width + sway, y: size.height + 20 - p * (size.height + 100), width: d.size, height: d.size)
            var c = ctx
            c.opacity = alpha * d.opacity
            c.stroke(Path(ellipseIn: r), with: .color(edge), lineWidth: 1)
            c.fill(Path(ellipseIn: CGRect(x: r.minX + r.width * 0.2, y: r.minY + r.height * 0.18, width: r.width * 0.28, height: r.height * 0.28)), with: .color(.white.opacity(0.95)))
          }
        }
      }
      .allowsHitTesting(false).accessibilityHidden(true)
    }
  }
}
