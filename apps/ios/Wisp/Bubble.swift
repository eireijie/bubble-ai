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
  /** eyes toward the finger, in points from where they rest (already eased) */
  var gaze: CGPoint?
  /** where the eyes rest, as fractions of one eye's width and height (`BubblePainter.rest`) */
  var rest: CGPoint = .zero
  /** seconds since a tap made it spin */
  var spin: Double?
  /** the colour behind the bubble, for the ring around the orange dot */
  var ground: Color
  /** eyes, mouth, hat, wear and idle motion picked in Look (`BubbleWorn`); plain for looks saved before them */
  var worn = BubbleWorn.plain

  /**
   * Where idle eyes rest: never dead centre, but to one side or to the side and a little up (owner,
   * 2026-11-25). Picked steadily from the agent's id with FNV-1a 32-bit, the same hash and table as
   * the web's `restingGaze`, so an agent looks the same way on both. Fractions of one eye's size.
   */
  static let restingGaze: [CGPoint] = [
    CGPoint(x: 0.60, y: 0), CGPoint(x: 0.55, y: -0.30), CGPoint(x: -0.60, y: 0), CGPoint(x: -0.55, y: -0.30),
  ]
  static func rest(_ seed: String) -> CGPoint {
    var h: UInt32 = 0x811c_9dc5
    for c in seed.utf16 { h = (h ^ UInt32(c)) &* 0x0100_0193 }
    return restingGaze[Int(h % UInt32(restingGaze.count))]
  }
  /** One eye's width and height in points for a mood. */
  static func eyeSize(_ mood: GhostMood, size s: CGFloat) -> CGSize {
    let height: CGFloat
    switch mood {
    case .waiting: height = 0.21
    case .listening: height = 0.20
    case .asleep: height = 0.12
    default: height = 0.17
    }
    return CGSize(width: s * 0.11, height: s * height)
  }

  private static let rimHex = ["#ff7cc4", "#7fb0ff", "#6fe8c0", "#ffe27a", "#ff9c80", "#bf86ff", "#ff7cc4"]
  /** the rainbow rim leaned towards the bubble's own colour, so a warm bubble's edge doesn't mix green and blue into brown */
  private var rim: [Color] {
    let own = GhostColor.rgb(GhostColor.safe(color, fallback: "#a59bff"))
    return Self.rimHex.map { hex in
      let v = zip(GhostColor.rgb(hex), own).map { ($0 * 0.55 + $1 * 0.45) / 255 }
      return Color(red: v[0], green: v[1], blue: v[2])
    }
  }
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
    if worn.hatted {
      // with a hat on, the body steps down and in so the hat fits inside the same square (web .bub-hatted)
      body.translateBy(x: s * 0.105, y: s * 0.21)
      body.scaleBy(x: 0.79, y: 0.79)
    }
    body.translateBy(x: s * 0.5 + dx * s, y: s * 0.9 + dy * s)
    body.rotate(by: .degrees(bodyTilt()))
    body.scaleBy(x: sx, y: sy)
    body.translateBy(x: -s * 0.5, y: -s * 0.9)
    for part in shape.parts { drawPart(part, body) }
    drawEyes(body)
    // worn things are drawn in the body's own box, so they wobble, hop and spin with it
    drawWear(body)
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
    case .awake, .done:
      // the idle motion picked in Look: float (the wobble), bounce, sway or still
      switch worn.motion {
      case "bounce":
        let p = GhostAnimation.phase(time, 2.2)
        let ty = GhostAnimation.key(p, [(0, 0), (0.45, -0.07), (0.6, 0), (1, 0)])
        let x = GhostAnimation.key(p, [(0, 1), (0.45, 0.98), (0.6, 1.03), (0.7, 1), (1, 1)])
        let y = GhostAnimation.key(p, [(0, 1), (0.45, 1.02), (0.6, 0.97), (0.7, 1), (1, 1)])
        return (0, ty, x, y)
      case "sway", "still": return (0, 0, 1, 1)
      default: return wob(4.2)
      }
    default: return wob(4.2)
    }
  }

  /** degrees the body leans for the "sway" idle motion (web bub-sway-body) */
  private func bodyTilt() -> Double {
    guard animated, mood == .awake || mood == .done, worn.motion == "sway" else { return 0 }
    return -4 + 8 * GhostAnimation.wave(time, 3.6)
  }

  // MARK: the glass

  private func radii(_ part: BubbleForm.Part) -> BubbleForm.Radii {
    guard animated, shape.morphs, worn.motion != "still" else { return part.radii }
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
    // dark: lifted further towards white, so a warm colour reads as peach on black instead of brown
    let tint = dark ? Self.mixWhite(color, 0.5) : base
    // light: 8% in the middle, 16%, 36% at the edge; dark: frosted 56%, 60%, 68%
    let (core, mid, edge): (Double, Double, Double) = dark ? (0.62, 0.68, 0.78) : (0.08, 0.16, 0.36)
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
    let conic = GraphicsContext.Shading.conicGradient(Gradient(colors: rim), center: CGPoint(x: box.midX, y: box.midY), angle: angle)
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
    var w = s * 0.11, lefts: [CGFloat] = [0.31, 0.58]
    if worn.eyes == "big" { top = 0.365; height = 0.20; w = s * 0.14; lefts = [0.295, 0.565] }
    let h = s * height
    var blink: CGFloat = 1
    // everything starts and ends where the eyes rest
    var look = CGPoint(x: rest.x * w, y: rest.y * h)
    if animated {
      let blinkD = mood == .asleep ? 7.0 : 5.2
      let p = GhostAnimation.phase(time, blinkD)
      let working = mood == .working || mood == .thinking
      if !working { blink = CGFloat(GhostAnimation.key(p, [(0, 1), (0.93, 1), (0.95, 0.12), (1, 1)])) }
      if working {
        // scan from the resting side across to the other and back
        look.x = rest.x * w * CGFloat(1 - 2 * GhostAnimation.wave(time, 1.8))
      } else if gaze == nil, mood == .awake || mood == .done || mood == .asleep {
        // a glance across to the other side, then a little down, then back to rest (web: LOOK)
        let q = GhostAnimation.phase(time, mood == .asleep ? 16 : 12)
        look.x += CGFloat(GhostAnimation.key(q, [(0, 0), (0.38, 0), (0.44, -1.8), (0.56, -1.8), (0.62, 0), (1, 0)])) * rest.x * w
        look.y += CGFloat(GhostAnimation.key(q, [(0, 0), (0.38, 0), (0.44, 0.08), (0.56, 0.08), (0.62, 0.14), (0.74, 0.14), (1, 0)])) * h
      }
    }
    if let gaze { look.x += gaze.x; look.y += gaze.y }
    let eye = ink
    let fx = shape.face.x * s, fy = shape.face.y * s
    for (i, left) in lefts.enumerated() {
      if worn.eyes == "happy" || (worn.eyes == "wink" && i == 1) {
        // a closed, happy arc (web: 13% wide, 9% tall, 42% down, 1% further left)
        let k = s * 0.013
        let cx = (left - 0.01 + 0.065) * s + fx + look.x, cy = 0.465 * s + fy + look.y
        var arc = Path()
        arc.move(to: CGPoint(x: cx - 3.8 * k, y: cy + 2 * k))
        arc.addQuadCurve(to: CGPoint(x: cx + 3.8 * k, y: cy + 2 * k), control: CGPoint(x: cx, y: cy - 4.2 * k))
        ctx.stroke(arc, with: .color(eye), style: StrokeStyle(lineWidth: 1.8 * k, lineCap: .round))
        continue
      }
      let cx = left * s + w / 2 + fx + look.x
      let cy = top * s + h / 2 + fy + look.y
      let eh = h * blink
      let r = CGRect(x: cx - w / 2, y: cy - eh / 2, width: w, height: eh)
      ctx.fill(Path(ellipseIn: r), with: .color(eye))
      // big and sparkly eyes catch the light (web: radial-gradient shines)
      var shines: [(CGFloat, CGFloat, CGFloat, Double)] = []
      if worn.eyes == "big" { shines = [(0.64, 0.30, hypot(0.64 * w, 0.70 * h) * 0.16, 1)] }
      if worn.eyes == "sparkle" { shines = [(0.66, 0.27, hypot(0.66 * w, 0.73 * h) * 0.18, 1), (0.34, 0.72, hypot(0.66 * w, 0.72 * h) * 0.10, 0.8)] }
      guard !shines.isEmpty else { continue }
      var lit = ctx
      lit.clip(to: Path(ellipseIn: r))
      for (x, y, rad, a) in shines {
        let c = CGPoint(x: r.minX + x * w, y: r.minY + y * eh)
        lit.fill(Path(ellipseIn: CGRect(x: c.x - rad, y: c.y - rad * blink, width: rad * 2, height: rad * 2 * blink)), with: .color(.white.opacity(a)))
      }
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

// MARK: what a bubble wears (web: BubbleParts.tsx, bubbleParts() in Bubble.tsx)

/**
 * A look's eyes, mouth, hat, accessory and idle motion. Looks saved before these came back
 * (no `parts`) get plain eyes and nothing worn, so they draw exactly as before.
 */
struct BubbleWorn: Equatable {
  var eyes = "dots"
  var mouth = "none"
  var hat = "none"
  var accessory = "none"
  var motion = "float"
  static let plain = BubbleWorn()

  init() {}
  init(_ look: GhostLook?) {
    guard let look, look.parts == true else { return }
    func pick(_ v: String?, _ fallback: String) -> String { v.flatMap { $0.isEmpty ? nil : $0 } ?? fallback }
    eyes = pick(look.eyes, "dots")
    mouth = pick(look.mouth, "none")
    hat = pick(look.hat, "none")
    accessory = pick(look.accessory, "none")
    motion = pick(look.motion, "float")
  }

  /** A hat or something to wear needs some size to read; tiny bubbles keep just their eyes. */
  func sized(_ size: CGFloat) -> BubbleWorn {
    var w = self
    if size < 20 { w.hat = "none"; w.accessory = "none" }
    if size < 24 { w.mouth = "none" }
    return w
  }

  var hatted: Bool { hat != "none" }
}

extension BubbleForm {
  /** Where hats sit (top), neckwear hangs (bottom) and how wide the head is, in the bubble's 100×100 box (web ShapeDef). */
  var anchor: (top: CGPoint, bottom: CGPoint, width: CGFloat) {
    switch self {
    case .round: (CGPoint(x: 50, y: 0), CGPoint(x: 50, y: 100), 100)
    case .squircle: (CGPoint(x: 50, y: 2), CGPoint(x: 50, y: 98), 96)
    case .egg: (CGPoint(x: 50, y: 0), CGPoint(x: 50, y: 100), 86)
    case .drop: (CGPoint(x: 50, y: 10), CGPoint(x: 50, y: 94), 72)
    case .blob: (CGPoint(x: 50, y: 4), CGPoint(x: 50, y: 96), 100)
    case .capsule: (CGPoint(x: 50, y: 16), CGPoint(x: 50, y: 86), 90)
    case .double: (CGPoint(x: 41, y: 18), CGPoint(x: 41, y: 100), 82)
    case .cluster: (CGPoint(x: 38, y: 26), CGPoint(x: 38, y: 98), 72)
    }
  }
}

extension BubblePainter {
  /** the eyes' ink, also used for the mouth */
  var ink: Color { dark ? Color(hex: "#141414") : Color(hex: "#1c1c1c") }

  private static let wearInk = Color(hex: "#262330")
  private static func E(_ cx: CGFloat, _ cy: CGFloat, _ rx: CGFloat, _ ry: CGFloat) -> Path {
    Path(ellipseIn: CGRect(x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2))
  }
  private static func R(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat = 0) -> Path {
    Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: r, style: .circular)
  }
  private static func poly(_ pts: [(CGFloat, CGFloat)]) -> Path {
    var p = Path()
    p.addLines(pts.map { CGPoint(x: $0.0, y: $0.1) })
    p.closeSubpath()
    return p
  }
  private static func quad(_ x0: CGFloat, _ y0: CGFloat, _ cx: CGFloat, _ cy: CGFloat, _ x1: CGFloat, _ y1: CGFloat) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: x0, y: y0))
    p.addQuadCurve(to: CGPoint(x: x1, y: y1), control: CGPoint(x: cx, y: cy))
    return p
  }
  private static func line(_ w: CGFloat) -> StrokeStyle {
    StrokeStyle(lineWidth: w, lineCap: .round, lineJoin: .round)
  }

  /** Mouth and face wear in the face, neckwear and hats on the body; `body` is the body's context in points. */
  func drawWear(_ body: GraphicsContext) {
    guard worn.mouth != "none" || worn.accessory != "none" || worn.hatted else { return }
    var u = body
    u.scaleBy(x: size / 100, y: size / 100)
    var face = u
    face.translateBy(x: shape.face.x * 100, y: shape.face.y * 100)
    drawMouth(face)
    drawFaceWear(face)
    drawNeckwear(u)
    drawHat(u)
  }

  private func drawMouth(_ c: GraphicsContext) {
    let x: CGFloat = 50, y: CGFloat = 62
    let pink = Color(hex: "#ff7a93")
    switch worn.mouth {
    case "smile":
      c.stroke(Self.quad(x - 5.5, y, x, y + 5, x + 5.5, y), with: .color(ink), style: Self.line(2.6))
    case "open":
      c.fill(Self.E(x, y + 1.5, 4, 4.6), with: .color(ink))
      c.fill(Self.E(x, y + 4, 2.6, 1.5), with: .color(pink))
    case "cat":
      var p = Self.quad(x - 6.5, y, x - 3.25, y + 4.2, x, y)
      p.addQuadCurve(to: CGPoint(x: x + 6.5, y: y), control: CGPoint(x: x + 3.25, y: y + 4.2))
      c.stroke(p, with: .color(ink), style: Self.line(2.6))
    case "fangs":
      c.stroke(Self.quad(x - 6.5, y, x, y + 5, x + 6.5, y), with: .color(ink), style: Self.line(2.6))
      var teeth = Self.poly([(x - 4.2, y + 2), (x - 2.7, y + 5.6), (x - 1.2, y + 2.5)])
      teeth.addPath(Self.poly([(x + 1.2, y + 2.3), (x + 2.7, y + 5.4), (x + 4.2, y + 1.8)]))
      c.fill(teeth, with: .color(.white))
    case "tongue":
      c.stroke(Self.quad(x - 5.5, y, x, y + 4.6, x + 5.5, y), with: .color(ink), style: Self.line(2.6))
      var t = Self.quad(x + 0.4, y + 2, x + 0.4, y + 7, x + 3.8, y + 7)
      t.addQuadCurve(to: CGPoint(x: x + 6.6, y: y + 1), control: CGPoint(x: x + 7.2, y: y + 7))
      t.closeSubpath()
      c.fill(t, with: .color(pink))
    default: break
    }
  }

  private func drawFaceWear(_ c: GraphicsContext) {
    let a: CGFloat = 36.5, b: CGFloat = 63.5, y: CGFloat = 46.5
    switch worn.accessory {
    case "glasses":
      for x in [a, b] {
        c.fill(Self.E(x, y, 9, 9), with: .color(.white.opacity(0.16)))
        c.stroke(Self.E(x, y, 9, 9), with: .color(Self.wearInk), lineWidth: 2.2)
      }
      c.stroke(Self.quad(a + 9, y - 1, 50, y - 4, b - 9, y - 1), with: .color(Self.wearInk), lineWidth: 2.2)
    case "sunglasses":
      let lens = Color(hex: "#16141d")
      c.fill(Self.R(a - 10.5, y - 7, 21, 14, 5), with: .color(lens))
      c.fill(Self.R(b - 10.5, y - 7, 21, 14, 5), with: .color(lens))
      var bridge = Path()
      bridge.move(to: CGPoint(x: a + 10, y: y - 3))
      bridge.addLine(to: CGPoint(x: b - 10, y: y - 3))
      c.stroke(bridge, with: .color(lens), lineWidth: 2.4)
      var glint = Path()
      for x in [a, b] {
        glint.move(to: CGPoint(x: x - 6, y: y - 3.5))
        glint.addLine(to: CGPoint(x: x - 2, y: y - 5.5))
      }
      c.stroke(glint, with: .color(.white.opacity(0.7)), style: Self.line(1.5))
    case "monocle":
      let gold = Color(hex: "#c9a227")
      c.fill(Self.E(b, y, 9, 9), with: .color(.white.opacity(0.18)))
      c.stroke(Self.E(b, y, 9, 9), with: .color(gold), lineWidth: 2.4)
      c.stroke(Self.quad(b + 6.5, y + 6.5, b + 14, y + 15, b + 9, y + 27), with: .color(gold), lineWidth: 1.3)
    case "mustache":
      let m: CGFloat = 59
      let curves: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
        (41, m - 5.5, 34, m - 1), (32, m + 4, 37, m + 3.4), (43.5, m + 1.8, 50, m + 2.5),
        (56.5, m + 1.8, 63, m + 3.4), (68, m + 4, 66, m - 1), (59, m - 5.5, 50, m),
      ]
      var p = Path()
      p.move(to: CGPoint(x: 50, y: m))
      for (cx, cy, x, y) in curves { p.addQuadCurve(to: CGPoint(x: x, y: y), control: CGPoint(x: cx, y: cy)) }
      p.closeSubpath()
      c.fill(p, with: .color(Color(hex: "#3a2a20")))
    default: break
    }
  }

  private func drawNeckwear(_ c: GraphicsContext) {
    let d = shape.anchor
    let x = d.bottom.x, y = d.top.y + (d.bottom.y - d.top.y) * 0.79
    let half = d.width / 2 * 0.78
    var c = c
    switch worn.accessory {
    case "bowtie":
      c.translateBy(x: x, y: y)
      c.scaleBy(x: 1.25, y: 1.25)
      var wings = Self.poly([(0, 0), (-11, -6.5), (-11, 6.5)])
      wings.addPath(Self.poly([(0, 0), (11, -6.5), (11, 6.5)]))
      c.fill(wings, with: .color(Color(hex: "#e5484d")))
      c.fill(Self.R(-3, -3.2, 6, 6.4, 1.6), with: .color(Color(hex: "#c2333a")))
    case "scarf":
      let wool = Color(hex: "#ff8f5a")
      c.fill(Self.R(x - half, y - 5, half * 2, 10, 5), with: .color(wool))
      var stripes = Path()
      for sx in [x - half + 9, x - half + 18, x + half - 11] {
        stripes.move(to: CGPoint(x: sx, y: y - 5))
        stripes.addLine(to: CGPoint(x: sx, y: y + 5))
      }
      c.stroke(stripes, with: .color(Color(hex: "#ffd166")), lineWidth: 2.4)
      var tail = c
      tail.translateBy(x: x + half * 0.3, y: y)
      tail.rotate(by: .degrees(-10))
      tail.fill(Self.R(0, 2, 9, max(8, min(14, d.bottom.y - y - 4)), 4), with: .color(wool))
    case "tie":
      let len = max(10, min(18, d.bottom.y - y - 3))
      c.translateBy(x: x, y: y - 4)
      c.fill(Self.poly([(-4, 0), (4, 0), (2.4, 5.5), (-2.4, 5.5)]), with: .color(Color(hex: "#2563eb")))
      c.fill(Self.poly([(-2.4, 5.5), (2.4, 5.5), (5.2, len - 4), (0, len + 1), (-5.2, len - 4)]), with: .color(Color(hex: "#3b82f6")))
    default: break
    }
  }

  /** how far each hat sits down into the head, in the hat's own units */
  private static let hatSink: [String: CGFloat] = ["tophat": 3, "party": 2, "beanie": 5, "crown": 2.5, "witch": 3, "propeller": 4]

  private func drawHat(_ c: GraphicsContext) {
    guard worn.hatted else { return }
    let d = shape.anchor
    let kind = worn.hat
    let clipped = kind == "bow" || kind == "flower"
    let k = (kind == "headphones" ? 1.62 : clipped ? 1.25 : 1.15) * (d.width / 100)
    var c = c
    if clipped {
      c.translateBy(x: d.top.x + d.width * 0.31, y: d.top.y + d.width * 0.15)
    } else {
      c.translateBy(x: d.top.x, y: d.top.y + (Self.hatSink[kind] ?? 0) * k)
    }
    c.scaleBy(x: k, y: k)
    let felt = Color(hex: "#2b2735"), gold = Color(hex: "#ffd166")
    switch kind {
    case "tophat":
      c.fill(Self.R(-13, -25, 26, 25, 3), with: .color(felt))
      c.fill(Self.R(-13, -9, 26, 5), with: .color(Color(hex: "#e5484d")))
      c.fill(Self.R(-21, -2, 42, 5.5, 2.75), with: .color(felt))
    case "party":
      c.fill(Self.poly([(-12, 3), (12, 3), (0, -27)]), with: .color(Color(hex: "#ff8fab")))
      var stripes = Path()
      stripes.move(to: CGPoint(x: -8.4, y: -6))
      stripes.addLine(to: CGPoint(x: 6.6, y: -6.4))
      stripes.move(to: CGPoint(x: -4.5, y: -15.6))
      stripes.addLine(to: CGPoint(x: 3.2, y: -15.8))
      c.stroke(stripes, with: .color(gold), style: Self.line(3))
      c.fill(Self.E(0, -28, 4, 4), with: .color(gold))
    case "beanie":
      var top = Self.quad(-21, 6, -21, -16, 0, -16)
      top.addQuadCurve(to: CGPoint(x: 21, y: 6), control: CGPoint(x: 21, y: -16))
      top.closeSubpath()
      c.fill(top, with: .color(Color(hex: "#5b8def")))
      c.fill(Self.R(-22.5, 0, 45, 8, 4), with: .color(Color(hex: "#3f6fd8")))
      c.fill(Self.E(0, -17, 5, 5), with: .color(Color(hex: "#f8fafc")))
    case "crown":
      let crown = Self.poly([(-15, 3), (-15, -12), (-7.5, -4.5), (0, -17), (7.5, -4.5), (15, -12), (15, 3)])
      c.fill(crown, with: .color(Color(hex: "#ffcf3f")))
      c.stroke(crown, with: .color(Color(hex: "#e0a800")), style: Self.line(1.5))
      c.fill(Self.E(0, -4, 2.4, 2.4), with: .color(Color(hex: "#ff5d73")))
      c.fill(Self.E(-9, -1.5, 1.7, 1.7), with: .color(Color(hex: "#4dabf7")))
      c.fill(Self.E(9, -1.5, 1.7, 1.7), with: .color(Color(hex: "#4dabf7")))
    case "witch":
      let purple = Color(hex: "#4b2e83")
      var cone = Path()
      cone.move(to: CGPoint(x: -13, y: 1))
      cone.addLine(to: CGPoint(x: -2, y: -30))
      cone.addQuadCurve(to: CGPoint(x: 13, y: -30), control: CGPoint(x: 4, y: -36))
      cone.addQuadCurve(to: CGPoint(x: 3, y: -22), control: CGPoint(x: 5, y: -27))
      cone.addLine(to: CGPoint(x: 13, y: 1))
      cone.closeSubpath()
      c.fill(cone, with: .color(purple))
      c.fill(Self.R(-13, -5, 26, 4.5), with: .color(Color(hex: "#ffb703")))
      c.fill(Self.E(0, 2, 27, 5), with: .color(purple))
    case "headphones":
      var band = Path()
      band.move(to: CGPoint(x: -29, y: 24))
      band.addCurve(to: CGPoint(x: 29, y: 24), control1: CGPoint(x: -31, y: -9), control2: CGPoint(x: 31, y: -9))
      c.stroke(band, with: .color(felt), style: Self.line(4))
      c.fill(Self.R(-35, 17, 10, 16, 4.5), with: .color(Color(hex: "#ff6b6b")))
      c.fill(Self.R(25, 17, 10, 16, 4.5), with: .color(Color(hex: "#ff6b6b")))
    case "bow":
      c.rotate(by: .degrees(18))
      var wings = Self.poly([(0, 0), (-10, -7), (-10, 7)])
      wings.addPath(Self.poly([(0, 0), (10, -7), (10, 7)]))
      c.fill(wings, with: .color(Color(hex: "#ff6fa3")))
      c.fill(Self.E(0, 0, 3, 3), with: .color(Color(hex: "#ff3d7f")))
    case "halo":
      c.stroke(Self.E(0, -9, 16, 4.5), with: .color(Color(hex: "#ffd84d")), lineWidth: 3.4)
    case "flower":
      for a in stride(from: 0.0, to: 360.0, by: 72.0) {
        let petal = Self.E(CGFloat(cos(a * .pi / 180)) * 4.2, CGFloat(sin(a * .pi / 180)) * 4.2, 3.6, 3.6)
        c.fill(petal, with: .color(.white))
        c.stroke(petal, with: .color(Color(hex: "#e9e1f7")), lineWidth: 0.6)
      }
      c.fill(Self.E(0, 0, 2.9, 2.9), with: .color(Color(hex: "#ffc83d")))
    case "propeller":
      var cap = Self.quad(-19, 6, -19, -13, 0, -13)
      cap.addQuadCurve(to: CGPoint(x: 19, y: 6), control: CGPoint(x: 19, y: -13))
      cap.closeSubpath()
      c.fill(cap, with: .color(Color(hex: "#ff5d73")))
      var side = Self.quad(-19, 6, -19, -13, 0, -13)
      side.addLine(to: CGPoint(x: 0, y: 6))
      side.closeSubpath()
      c.fill(side, with: .color(gold))
      c.fill(Self.R(-1.2, -21, 2.4, 9), with: .color(felt))
      // the blades flip around the stem (web bub-prop, 1.2s linear)
      var blades = c
      blades.translateBy(x: 0, y: -21)
      if animated {
        let p = CGFloat(GhostAnimation.phase(time, 1.2))
        blades.scaleBy(x: p < 0.5 ? 1 - 4 * p : -3 + 4 * p, y: 1)
      }
      blades.fill(Self.E(-7, 0, 7, 2.2), with: .color(Color(hex: "#4dabf7")))
      blades.fill(Self.E(7, 0, 7, 2.2), with: .color(Color(hex: "#22c55e")))
    default: break
    }
  }
}

#Preview("Worn") {
  let looks: [(String, String, String, String, String)] = [
    ("big", "smile", "tophat", "glasses", "bounce"), ("sparkle", "cat", "crown", "bowtie", "sway"),
    ("happy", "open", "party", "scarf", "still"), ("wink", "tongue", "propeller", "tie", "float"),
    ("dots", "fangs", "witch", "sunglasses", "float"), ("big", "smile", "headphones", "monocle", "float"),
    ("sparkle", "none", "bow", "mustache", "float"), ("dots", "smile", "halo", "none", "float"),
    ("big", "none", "flower", "none", "float"), ("dots", "none", "beanie", "none", "float"),
  ]
  ScrollView {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 90))]) {
      ForEach(Array(looks.enumerated()), id: \.offset) { i, l in
        GhostView(look: GhostLook(color: "#6cc4ff", eyes: l.0, mouth: l.1, hat: l.2, accessory: l.3, motion: l.4,
                                  bubble: BubbleForm.allCases[i % BubbleForm.allCases.count].rawValue, parts: true),
                  seed: "w\(i)", size: 80)
      }
    }.padding()
  }
}
