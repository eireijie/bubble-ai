import SwiftUI

/**
 * An agent's avatar: a bubble (Bubble.swift) in its own shape and colour. The name stays from the
 * ghost days so every screen that drew a ghost now draws a bubble. Eyes glance around and look
 * toward your finger; a tap spins it once. Reduce Motion (the system's or Wisp's) stills it.
 */
struct GhostView: View {
  var look: GhostLook?
  var seed: String
  var asleep = false
  /** the agent's device is disconnected: drawn drowsy */
  var offline = false
  var size: CGFloat = 36
  var mood: GhostMood = .awake
  var interactive = false
  var animate = true
  @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
  @AppStorage(ThemeSettings.motionKey, store: WispPreferences.standard) private var motionSetting = false
  private var reduceMotion: Bool { systemReduceMotion || motionSetting }
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.colorScheme) private var colorScheme
  @State private var spunAt: Date?
  @State private var gaze = BubbleGaze()

  private var animated: Bool { animate && !reduceMotion && scenePhase == .active && size >= 12 }

  var body: some View {
    let currentMood = asleep || offline ? GhostMood.asleep : mood
    let shape = BubbleForm(look)
    let color = BubbleColors.color(look, seed: seed)
    let phase = Double(GhostLook.hash(seed) % 10_000) / 1000
    let overflow = max(8, size * 0.3)
    let dark = colorScheme == .dark
    let rendered = TimelineView(.animation(minimumInterval: size >= 60 ? 1.0 / 60 : 1.0 / 30, paused: !animated)) { timeline in
      Canvas { context, _ in
        var context = context
        context.translateBy(x: overflow, y: overflow)
        let now = timeline.date.timeIntervalSinceReferenceDate
        BubblePainter(shape: shape, color: color, mood: currentMood, size: size, dark: dark,
          time: animated ? now + phase : 0, animated: animated, gaze: animated ? eyes(now) : nil,
          spin: animated ? spunAt.map { timeline.date.timeIntervalSince($0) } : nil,
          ground: Palette.ground).draw(context)
      }
      .frame(width: size + overflow * 2, height: size + overflow * 2)
    }
    .frame(width: size, height: size)
    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { gaze.frame = $0 }
    if interactive && size >= 24 {
      rendered
        .contentShape(Rectangle())
        .onTapGesture(perform: react)
        .accessibilityLabel("Bubble, \(currentMood.rawValue)")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction(.default, react)
    } else {
      rendered.allowsHitTesting(false).accessibilityHidden(true)
    }
  }

  /** Where the eyes look while a finger is on the screen (the web's pointer follow), eased. */
  private func eyes(_ now: TimeInterval) -> CGPoint? {
    let f = gaze.frame
    var target = CGPoint.zero
    let touching = BubbleTouch.point != nil && f.width > 0
    if let p = BubbleTouch.point, f.width > 0 {
      let dx = (p.x - f.midX) / (f.width / 2), dy = (p.y - (f.minY + f.height * 0.45)) / (f.height / 2)
      let d = hypot(dx, dy), k = d > 1 ? 1 / d : 1
      target = CGPoint(x: dx * k * size * 0.08, y: dy * k * size * 0.06)
    }
    let dt = gaze.last == 0 ? 1 : min(1, now - gaze.last)
    gaze.last = now
    let a = CGFloat(1 - exp(-dt / 0.09))
    gaze.offset = CGPoint(x: gaze.offset.x + (target.x - gaze.offset.x) * a, y: gaze.offset.y + (target.y - gaze.offset.y) * a)
    if touching { gaze.following = true }
    else if gaze.following, hypot(gaze.offset.x, gaze.offset.y) < 0.05 { gaze.following = false }
    return gaze.following ? gaze.offset : nil
  }

  private func react() {
    guard animated else { return }
    spunAt = Date()
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
  }
}

struct AgentAvatar: View {
  @Environment(Store.self) private var store
  var agent: Agent?
  var size: CGFloat = 36
  var showStatus = true
  var interactive = false

  var body: some View {
    let current = agent.flatMap { store.agent($0.id) } ?? agent
    GhostView(look: current?.settings?.appearance, seed: current?.handle ?? "agent", size: size,
      mood: store.mood(for: current), interactive: interactive)
      .overlay(alignment: .bottomTrailing) {
        if showStatus, let s = current?.status, s != .offline {
          StatusDot(status: s).offset(x: 2, y: 1)
        }
      }
  }
}

struct StatusDot: View {
  var status: Agent.Status
  var body: some View {
    Circle()
      .fill(status == .busy ? Color.blue : Color.green)
      .frame(width: 9, height: 9)
      .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 2))
      .shadow(color: (status == .busy ? Color.blue : Color.green).opacity(0.6), radius: 3)
  }
}

struct PersonAvatar: View {
  var name: String
  var size: CGFloat = 36
  var body: some View {
    Text(initials)
      .font(.system(size: size * 0.38, weight: .semibold))
      .foregroundStyle(Color(.systemBackground))
      .frame(width: size, height: size)
      .background(Circle().fill(Color.primary.opacity(0.85)))
      .accessibilityHidden(true)
  }
  private var initials: String {
    let parts = name.split(separator: " ").prefix(2)
    return parts.map { String($0.prefix(1)) }.joined().uppercased()
  }
}

extension Color {
  init(hex: String) {
    var v: UInt64 = 0
    Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&v)
    self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
  }
}


