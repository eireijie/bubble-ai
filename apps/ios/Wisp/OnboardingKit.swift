import AuthenticationServices
import SwiftUI

// The pieces every first-run page shares (the web's SetupShell, HostGhost and obMotion): the dots
// at the top, one host ghost that reacts once per answer, the page frame with its two buttons at
// the bottom, and small moving parts. Each move is skipped with Reduce Motion.

/** What the host does once when something happens: a hop when something lands, a nod on a pick, a catch per app connected, one celebration at the end. */
enum HostReaction: Equatable {
  case hop, nod, grab, celebrate, doze

  var duration: Double {
    switch self {
    case .hop: 0.52
    case .nod: 0.46
    case .grab: 0.32
    case .doze: 1.25
    case .celebrate: 1.1
    }
  }

  /** Where the host is at each moment of the move (the web's keyframes): lift as a share of its height, squash, and tilt. */
  struct Pose: Equatable { var lift: Double = 0; var sx: Double = 1; var sy: Double = 1; var tilt: Double = 0 }

  var frames: [(at: Double, pose: Pose)] {
    switch self {
    case .hop: [(0.35, Pose(lift: -0.14, sx: 0.95, sy: 1.06)), (0.7, Pose(sx: 1.07, sy: 0.93))]
    case .nod: [(0.35, Pose(tilt: -7)), (0.7, Pose(tilt: 4))]
    case .grab: [(0.4, Pose(lift: -0.05, sx: 1.04, sy: 0.97))]
    case .doze: [(0.3, Pose(lift: 0.03, tilt: -9)), (0.78, Pose(lift: 0.03, tilt: -9))]
    case .celebrate: [(0.22, Pose(lift: -0.18, sx: 0.94, sy: 1.07, tilt: -4)), (0.42, Pose(sx: 1.08, sy: 0.92)), (0.64, Pose(lift: -0.11, sx: 0.96, sy: 1.05, tilt: 4)), (0.84, Pose(sx: 1.05, sy: 0.95))]
    }
  }

  /** The pose at `t` (0 to 1): at rest at both ends, eased between the frames. */
  func pose(at t: Double) -> Pose {
    let all = [(at: 0.0, pose: Pose())] + frames + [(at: 1.0, pose: Pose())]
    guard t > 0, t < 1, let next = all.firstIndex(where: { $0.at >= t }), next > 0 else { return Pose() }
    let a = all[next - 1], b = all[next]
    let raw = (t - a.at) / max(b.at - a.at, 0.0001), k = raw * raw * (3 - 2 * raw)
    func mix(_ x: Double, _ y: Double) -> Double { x + (y - x) * k }
    return Pose(lift: mix(a.pose.lift, b.pose.lift), sx: mix(a.pose.sx, b.pose.sx), sy: mix(a.pose.sy, b.pose.sy), tilt: mix(a.pose.tilt, b.pose.tilt))
  }
}

/** The first run's one host: pages tell it what happened, and whichever page shows it plays the move. */
@MainActor @Observable
final class HostStage {
  /** bumps once per reaction */
  private(set) var beat = 0
  private(set) var kind = HostReaction.hop
  /** looking up with a flat mouth, the moment before it reacts to an answer */
  private(set) var thinking = false
  @ObservationIgnored private var pending: Task<Void, Never>?
  /** the look-up before a reaction to an answer: long enough to read as thinking, short enough not to wait on */
  static let think: Duration = .milliseconds(320)

  /** where each page wants the travelling bubble, in the stage's space, by page id (ObSlot) */
  private(set) var slots: [String: CGRect] = [:]
  func setSlot(_ page: String, _ rect: CGRect) { if slots[page] != rect { slots[page] = rect } }

  func react(_ kind: HostReaction) {
    self.kind = kind
    beat += 1
  }

  /** React to an answer: look up for a moment, then react. A second answer inside the pause replaces the first, so fast taps play only the last one. */
  func answer(_ kind: HostReaction, reduceMotion: Bool) {
    pending?.cancel()
    if reduceMotion { thinking = false; return react(kind) }
    thinking = true
    pending = Task {
      try? await Task.sleep(for: Self.think)
      guard !Task.isCancelled else { return }
      thinking = false
      react(kind)
    }
  }
}

private struct HostNamespaceKey: EnvironmentKey { static let defaultValue: Namespace.ID? = nil }
extension EnvironmentValues {
  /** the first run's shared space, so the host travels from where it stood on the page before */
  var hostNamespace: Namespace.ID? {
    get { self[HostNamespaceKey.self] }
    set { self[HostNamespaceKey.self] = newValue }
  }
}

enum OnboardingLook {
  /** The host before it has a colour: the ghost's own pale default, so it reads on white pages too. */
  static let host = GhostLook(color: "#f4f1ff", color2: nil, eyes: "dots", mouth: "smile", cheeks: false, shape: "classic", glow: false, hat: "none", accessory: "none", motion: "float")

  /** The agent being made: the picked colour and shape, the host's plain face. */
  static func agent(color: String, shape: String) -> GhostLook {
    var look = host
    look.color = color
    look.shape = shape
    look.bubble = bubble(shape)
    return look
  }

  /** The bubble each of onboarding's five shape choices draws, so they stay five different bubbles. */
  static func bubble(_ shape: String) -> String {
    ["classic": "round", "round": "squircle", "tall": "egg", "sheet": "blob", "wisp": "drop"][shape] ?? "round"
  }

  static func of(_ draft: FirstAgentDraft?) -> GhostLook { draft.map { agent(color: $0.color, shape: $0.shape) } ?? host }
}

/** The host ghost at its place on this page. It plays each reaction once and travels in from where it stood before. */
struct HostGhost: View {
  @Environment(HostStage.self) private var stage
  @Environment(\.hostNamespace) private var namespace
  var look: GhostLook
  var size: CGFloat
  var mood: GhostMood = .awake
  var happy = false
  @ReduceMotion private var reduceMotion
  @State private var t = 1.0
  @State private var kind = HostReaction.hop

  var body: some View {
    let ghost = GhostView(look: look, seed: "host", size: size, mood: stage.thinking ? .thinking : happy ? .done : mood)
      .modifier(HostMove(t: t, kind: kind, size: size))
      .onChange(of: stage.beat) {
        guard !reduceMotion else { return }
        kind = stage.kind
        var instant = Transaction(animation: nil)
        instant.disablesAnimations = true
        withTransaction(instant) { t = 0 }
        DispatchQueue.main.async { withAnimation(.linear(duration: kind.duration)) { t = 1 } }
      }
      .accessibilityIdentifier("host-ghost")
    if let namespace, !reduceMotion { ghost.matchedGeometryEffect(id: "host", in: namespace) } else { ghost }
  }
}

private struct HostMove: ViewModifier, Animatable {
  var t: Double
  var kind: HostReaction
  var size: CGFloat
  nonisolated var animatableData: Double {
    get { t }
    set { t = newValue }
  }

  func body(content: Content) -> some View {
    let p = kind.pose(at: t)
    content
      .scaleEffect(x: p.sx, y: p.sy, anchor: .bottom)
      .rotationEffect(.degrees(p.tilt), anchor: .bottom)
      .offset(y: p.lift * size)
  }
}

/** The dots at the top: done ones solid, the current one stretched, the rest faint. */
struct OnboardingTrack: View {
  var at: Int
  var steps: [String]
  @ReduceMotion private var reduceMotion

  var body: some View {
    HStack(spacing: 6) {
      ForEach(steps.indices, id: \.self) { i in
        Capsule().fill(i + 1 <= at ? Palette.text : Palette.hairline).frame(width: i + 1 == at ? 18 : 6, height: 6)
      }
    }
    .animation(Motion.pick(Motion.soft, reduceMotion), value: at)
    .accessibilityElement()
    .accessibilityLabel(at >= 1 && at <= steps.count ? "Step \(at) of \(steps.count): \(steps[at - 1])" : "Getting started")
  }
}

/** A first-run page: Back (or Close on the first page) and the dots on top, the page, and its buttons pinned at the bottom. */
struct OnboardingPage<Content: View, Bottom: View>: View {
  static var track: [String] { ["Your agent", "Make me yours", "Its AI"] }
  var step: Int
  var onBack: (() -> Void)? = nil
  var onClose: (() -> Void)? = nil
  /** when this changes, the page scrolls to the part marked `.id(OnboardingFocus.id)` (the live status under a long list) */
  var focus: String? = nil
  @ViewBuilder var content: Content
  @ViewBuilder var bottom: Bottom
  @ReduceMotion private var reduceMotion

  var body: some View {
    VStack(spacing: 0) {
      ZStack {
        OnboardingTrack(at: step, steps: OnboardingPage<EmptyView, EmptyView>.track)
        HStack {
          if let onBack { CircleButton(symbol: "chevron.left", label: "Back", size: 36, id: "ob-back", action: onBack) }
          else if let onClose { CircleButton(symbol: "xmark", label: "Close", size: 36, id: "ob-close", action: onClose) }
          Spacer()
        }
      }
      .frame(height: 52)
      .padding(.horizontal, 16)
      ScrollViewReader { proxy in
        ScrollView {
          content
            .padding(.horizontal, 20).padding(.top, 6).padding(.bottom, 24)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollBounceBehavior(.basedOnSize)
        .onChange(of: focus) { _, new in
          guard new != nil else { return }
          withAnimation(Motion.pick(Motion.soft, reduceMotion)) { proxy.scrollTo(OnboardingFocus.id, anchor: .bottom) }
        }
      }
      HStack(spacing: 4) { bottom; Spacer(minLength: 0) }
        .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 12)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
    }
    .background(Palette.ground.ignoresSafeArea())
  }
}

/** The part of a page to bring into view when its `focus` changes. */
enum OnboardingFocus { static let id = "ob-focus" }

/** A page's title and the line under it. */
struct OnboardingHead: View {
  var title: String
  var sub: String

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title).font(.system(size: 22, weight: .semibold)).tracking(-0.4).foregroundStyle(Palette.text)
        .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
      Text(sub).font(.system(size: 15)).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/** The one filled button on a page. */
struct ObPrimary: ButtonStyle {
  var height: CGFloat = 44
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: height < 40 ? 13 : 15, weight: .semibold)).foregroundStyle(Palette.ground).lineLimit(1)
      .padding(.horizontal, height < 40 ? 14 : 22).frame(height: height)
      .background(Capsule().fill(Palette.text))
      .opacity(enabled ? 1 : 0.4)
      .contentShape(Capsule())
      .pressFeedback(configuration.isPressed, scale: 0.97)
  }
}

/** A second choice: an outlined pill. */
struct ObOutline: ButtonStyle {
  var height: CGFloat = 44
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: height < 40 ? 13 : 15, weight: .medium)).foregroundStyle(Palette.text).lineLimit(1)
      .padding(.horizontal, height < 40 ? 14 : 16).frame(height: height)
      .background(Capsule().fill(Palette.card))
      .overlay(Capsule().strokeBorder(Palette.hairline))
      .opacity(enabled ? 1 : 0.5)
      .contentShape(Capsule())
      .pressFeedback(configuration.isPressed, scale: 0.97)
  }
}

/** The way past a page: plain grey words. */
struct ObQuiet: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 15)).foregroundStyle(Palette.muted).lineLimit(1)
      .padding(.horizontal, 14).frame(height: 44)
      .contentShape(Capsule())
      .pressFeedback(configuration.isPressed, scale: 0.97)
  }
}

/** The round mark at the end of a choice: empty, or filled with a check. */
struct ChoiceMark: View {
  var on: Bool

  var body: some View {
    ZStack {
      Circle().fill(on ? Palette.text : .clear)
      Circle().strokeBorder(on ? Palette.text : Palette.hairline, lineWidth: 1)
      if on { Image(systemName: "checkmark").font(.system(size: 9, weight: .heavy)).foregroundStyle(Palette.ground).transition(.scale(scale: 0.4).combined(with: .opacity)) }
    }
    .frame(width: 18, height: 18)
    .accessibilityHidden(true)
  }
}

/** A pill-shaped text field. */
struct ObField: View {
  var placeholder: String
  @Binding var text: String
  var id: String
  var limit = 200

  var body: some View {
    TextField(placeholder, text: $text)
      .font(.system(size: 15)).foregroundStyle(Palette.text)
      .padding(.horizontal, 18).frame(height: 44)
      .background(Capsule().fill(Palette.control))
      .overlay(Capsule().strokeBorder(Palette.hairline))
      .onChange(of: text) { _, new in if new.count > limit { text = String(new.prefix(limit)) } }
      .accessibilityIdentifier(id)
  }
}

/** Text that types in, a few characters a frame; all at once with Reduce Motion. */
struct TypedText: View {
  var text: String
  var cps = 60.0
  @ReduceMotion private var reduceMotion
  @State private var shown = 0

  var body: some View {
    // the whole text holds the space, so the bubble doesn't grow as it types
    Text(text).hidden()
      .overlay(alignment: .topLeading) { Text(String(text.prefix(shown))).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading) }
      .accessibilityElement()
      .accessibilityLabel(text)
      .task(id: text) {
        if reduceMotion { shown = text.count; return }
        shown = 0
        let start = Date()
        while shown < text.count {
          try? await Task.sleep(for: .milliseconds(16))
          if Task.isCancelled { return }
          shown = min(text.count, Int(Date().timeIntervalSince(start) * cps))
        }
      }
  }
}

/** The check that draws itself in. */
struct DrawnCheck: View {
  var size: CGFloat = 15
  var color: Color = Palette.statusOnline
  @ReduceMotion private var reduceMotion
  @State private var drawn = false

  var body: some View {
    Path { p in
      p.move(to: CGPoint(x: size * 5 / 24, y: size * 12.5 / 24))
      p.addLine(to: CGPoint(x: size * 9.5 / 24, y: size * 17 / 24))
      p.addLine(to: CGPoint(x: size * 19 / 24, y: size * 7.5 / 24))
    }
    .trim(from: 0, to: drawn ? 1 : 0)
    .stroke(color, style: StrokeStyle(lineWidth: max(1.6, size * 0.12), lineCap: .round, lineJoin: .round))
    .frame(width: size, height: size)
    .onAppear { if reduceMotion { drawn = true } else { withAnimation(.easeOut(duration: 0.32)) { drawn = true } } }
    .accessibilityHidden(true)
  }
}

/** Something that pops in: rises a little and fades (the web's ob-pop). */
private struct ObPop: ViewModifier {
  @ReduceMotion private var reduceMotion
  func body(content: Content) -> some View {
    content.transition(reduceMotion ? .opacity : .offset(y: 6).combined(with: .scale(scale: 0.98)).combined(with: .opacity))
  }
}

extension View {
  func obPop() -> some View { modifier(ObPop()) }
}

/**
 * The system's own sign-in sheet (the browser, over the app): where a sign-in page opens. Bubble AI's
 * hub runs the sign-in and the page is the app's own (GitHub, Notion, Google…); the app only shows
 * it and never sees what is typed there. It shares Safari's sign-ins, so someone already signed in
 * to the app in Safari isn't asked again.
 */
@MainActor
final class SignInBrowser: NSObject, ASWebAuthenticationPresentationContextProviding {
  private var session: ASWebAuthenticationSession?
  /** the person closed the sheet (or it couldn't open) */
  private(set) var closed = false

  func open(_ url: URL) {
    close()
    closed = false
    // the hub's page ends on "you can close this"; nothing comes back through a link, so the scheme is never opened
    let session = ASWebAuthenticationSession(url: url, callback: .customScheme("wisp-sign-in")) { [weak self] _, _ in
      Task { @MainActor in
        self?.closed = true
        self?.session = nil
      }
    }
    session.presentationContextProvider = self
    session.prefersEphemeralWebBrowserSession = false
    self.session = session
    if !session.start() { closed = true; self.session = nil }
  }

  /** Close the sheet: the hub says the sign-in is done, or it's no longer waited for. */
  func close() {
    session?.cancel()
    session = nil
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first.map { ASPresentationAnchor(windowScene: $0) } ?? ASPresentationAnchor()
  }
}

/** A page that can open in the sign-in sheet. */
struct BrowserPage: Identifiable, Equatable {
  var url: URL
  var id: String { url.absoluteString }

  /** Only web pages open there. */
  init?(_ address: String?) {
    guard let address, let url = URL(string: address), ["https", "http"].contains(url.scheme ?? "") else { return nil }
    self.url = url
  }
}

// MARK: - The one stage (2026-11-26 canvas, iPhone board)

private struct ObPageKey: EnvironmentKey { static let defaultValue = "" }
extension EnvironmentValues {
  /** the page this view is on, so its ObSlot tells the stage where the bubble goes on that page */
  var obPage: String {
    get { self[ObPageKey.self] }
    set { self[ObPageKey.self] = newValue }
  }
}

/** The stage's coordinate space: slots are measured in it and the bubble is drawn in it. */
enum ObStage { static let space = "ob-stage" }

/**
 * Where the stage's one bubble sits on this page, at this size. The bubble itself isn't here: it
 * travels from the last page's slot to this one and resizes on the way (OnboardingFlow).
 */
struct ObSlot: View {
  @Environment(HostStage.self) private var stage
  @Environment(\.obPage) private var page
  var size: CGFloat

  var body: some View {
    Color.clear.frame(width: size, height: size)
      .onGeometryChange(for: CGRect.self) { $0.frame(in: .named(ObStage.space)) } action: { stage.setSlot(page, $0) }
      .accessibilityHidden(true)
  }
}

/** A page on the stage: what scrolls, then its buttons pinned at the bottom. The top leaves room for Back. */
struct ObScreen<Content: View, Bottom: View>: View {
  var top: CGFloat = 64
  var focus: String? = nil
  @ViewBuilder var content: Content
  @ViewBuilder var bottom: Bottom
  @ReduceMotion private var reduceMotion

  var body: some View {
    VStack(spacing: 0) {
      ScrollViewReader { proxy in
        ScrollView {
          content
            .padding(.horizontal, 20).padding(.top, top).padding(.bottom, 20)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollBounceBehavior(.basedOnSize)
        .onChange(of: focus) { _, new in
          guard new != nil else { return }
          withAnimation(Motion.pick(Motion.soft, reduceMotion)) { proxy.scrollTo(OnboardingFocus.id, anchor: .bottom) }
        }
      }
      VStack(spacing: 2) { bottom }
        .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 8)
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity)
    }
  }
}

/** The page's one big button: full width, 50pt, ink. */
struct ObWide: ButtonStyle {
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ground).lineLimit(1)
      .frame(maxWidth: .infinity).frame(height: 50)
      .background(Capsule().fill(Palette.text))
      .opacity(enabled ? 1 : 0.35)
      .contentShape(Capsule())
      .pressFeedback(configuration.isPressed, scale: 0.97)
  }
}

/** The wisp colour the first run picks things out with. */
enum ObTint {
  static let wisp = Color(hex: 0xA98BF5)
  static let fill = Color(hex: 0xA98BF5).opacity(0.14)
}

/** A tile that can be picked: a hairline, or the wisp ring and tint when it is. */
struct ObTileBack: ViewModifier {
  var on: Bool
  var radius: CGFloat = 16

  func body(content: Content) -> some View {
    content
      .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(on ? ObTint.fill : Palette.card))
      .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(on ? ObTint.wisp : Palette.hairline, lineWidth: on ? 2 : 1))
      .contentShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
  }
}

extension View {
  func obTile(_ on: Bool, radius: CGFloat = 16) -> some View { modifier(ObTileBack(on: on, radius: radius)) }

  /** A page title: big and tight. */
  func obTitle(_ size: CGFloat = 24, center: Bool = true) -> some View {
    font(.system(size: size, weight: .bold)).tracking(-0.4).foregroundStyle(Palette.text)
      .multilineTextAlignment(center ? .center : .leading)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityAddTraits(.isHeader)
  }
}

/** A small label over a group of choices. */
struct ObLabel: View {
  var text: String
  var body: some View {
    Text(text).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
      .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6)
  }
}

/** Three choices in a row, the picked one raised (Talks, Checks in). */
struct ObSegmented<T: Hashable>: View {
  var label: String
  var options: [(T, String)]
  @Binding var selection: T
  @Namespace private var pill
  @ReduceMotion private var reduceMotion

  var body: some View {
    HStack(spacing: 4) {
      ForEach(options, id: \.0) { value, text in
        let on = selection == value
        Button { withAnimation(Motion.pick(Motion.soft, reduceMotion)) { selection = value } } label: {
          Text(text).font(.system(size: 13, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8).foregroundStyle(on ? Palette.text : Palette.muted)
            .frame(maxWidth: .infinity).frame(height: 32)
            .background {
              if on {
                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Palette.control)
                  .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Palette.hairline))
                  .shadow(color: .black.opacity(0.06), radius: 1, y: 1)
                  .matchedGeometryEffect(id: "pill", in: pill)
              }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(text)
        .accessibilityAddTraits(on ? .isSelected : [])
      }
    }
    .padding(4)
    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.field))
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label)
  }
}

/**
 * A loop's envelope: 0 before `rise`, up to 1 across it, 1 until `fall`, back to 0 across it. `t`
 * is seconds into a loop of `period`, shifted by `delay` (the web's CSS keyframes, as numbers).
 */
func obEnvelope(_ t: Double, period: Double = 6, delay: Double = 0, rise: (Double, Double), fall: (Double, Double)) -> Double {
  var k = (t - delay).truncatingRemainder(dividingBy: period) / period
  if k < 0 { k += 1 }
  if k < rise.0 { return 0 }
  if k < rise.1 { return (k - rise.0) / max(0.0001, rise.1 - rise.0) }
  if k < fall.0 { return 1 }
  if k < fall.1 { return 1 - (k - fall.0) / max(0.0001, fall.1 - fall.0) }
  return 0
}
