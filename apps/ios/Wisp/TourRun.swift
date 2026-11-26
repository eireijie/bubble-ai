import SwiftUI
import UIKit

/**
 * Whether Show me around is running, on which stop, and where the screens under it should be.
 * Nothing runs while it isn't: no window, no timers. Screens mark the real controls a stop points
 * at with `.tourTarget(_:)`; the tour reads their frames from here. Seen stops are saved on the hub
 * (UserPrefs.learn), the same list the desktop uses.
 */
@MainActor @Observable
final class TourRun {
  static let shared = TourRun()

  struct Run: Equatable {
    /** index into Tour.stops(guest:) */
    var i: Int
    /** past the last stop: the "That's Bubble AI" card */
    var end = false
    /** the chat the tour came from, where chat stops happen */
    var homeChannel: String?
    /** the agent whose bubble flies the tour */
    var agentId: String?
    var guest = false
    var stops: [Tour.Stop] { Tour.stops(guest: guest) }
    var stop: Tour.Stop? { end ? nil : stops[i] }
  }

  private(set) var run: Run?
  /** where the screens under the tour are asked to be; `nav` changes each time it's asked */
  private(set) var place: Tour.Place?
  private(set) var nav = 0
  /** a team chat, for the Schedules stop */
  private(set) var teamChannel: String?
  /** typed into the chat box by Try it: the box puts it in and takes the keyboard */
  private(set) var composerRequest: ComposerRequest?
  /** what the chat box holds, while the tour runs (typing / finishes that stop) */
  var composerText = ""
  /** bumps each time a finger goes down on the control a stop points at (Make another finishes on it) */
  private(set) var holeTaps = 0
  func holeTapped() { if run != nil { holeTaps &+= 1 } }
  /** the chat open on screen, if any (ChannelView sets it) */
  @ObservationIgnored var openChannel: String?

  struct ComposerRequest: Equatable { var channelId: String; var text: String; var focus: Bool; var token: Int }

  @ObservationIgnored private weak var store: Store?
  @ObservationIgnored private var window: TourWindow?

  // MARK: targets

  /** frames of the controls on screen, in screen points, by `.tourTarget` name */
  @ObservationIgnored private(set) var frames: [String: CGRect] = [:]
  /** bumps when a frame changes while the tour runs, so the overlay follows */
  private(set) var framesVersion = 0

  func setFrame(_ name: String, _ rect: CGRect?) {
    guard frames[name] != rect else { return }
    frames[name] = rect
    if run != nil { framesVersion &+= 1 }
  }

  /** The first of a stop's targets on screen, and whether it's the last (nearest) one. */
  func target(for stop: Tour.Stop, screen: CGRect) -> (rect: CGRect, fallback: Bool)? {
    for (n, name) in stop.targets.enumerated() {
      guard let r = frames[name], r.width > 2, r.height > 2 else { continue }
      let shown = r.intersection(screen)
      guard !shown.isNull, shown.height > 8 else { continue }
      return (shown, n > 0 && n == stop.targets.count - 1)
    }
    return nil
  }

  // MARK: running

  var active: Bool { run != nil }

  /** Start at a stop, or where the person left off. */
  func start(_ store: Store, at index: Int? = nil) {
    self.store = store
    let guest = store.role == "guest"
    let stops = Tour.stops(guest: guest)
    let i = max(0, min(stops.count - 1, index ?? Tour.resumeIndex(store.prefs?.learn, stops)))
    let home = homeChat(store)
    teamChannel = store.channels.first { !$0.isDM && $0.archivedAt == nil && $0.settings?.team != nil && $0.joined != false }?.id
    run = Run(i: i, homeChannel: home.channel, agentId: home.agent, guest: guest)
    composerText = ""
    showWindow(store)
    if store.prefs?.learn?.started != true {
      save(LearnProgress(seen: Tour.cleanSeen(store.prefs?.learn?.seen), started: true))
    }
  }

  func stop() {
    run = nil
    composerRequest = nil
    window?.isHidden = true
    window = nil
  }

  func go(_ i: Int) {
    guard var r = run else { return }
    if i >= r.stops.count { r.end = true } else { r.i = max(0, i); r.end = false }
    run = r
  }

  func next() { if let r = run { r.end ? stop() : go(r.i + 1) } }
  func back() { if let r = run, !r.end { go(r.i - 1) } }

  /** Moves the screens under the tour (the overlay calls it mid-flight). */
  func show(_ p: Tour.Place) {
    place = p
    nav &+= 1
  }

  /** The chat box in `channelId` gets this text (and the keyboard, when `focus`). */
  func type(_ text: String, in channelId: String, focus: Bool) {
    composerRequest = ComposerRequest(channelId: channelId, text: text, focus: focus, token: (composerRequest?.token ?? 0) + 1)
  }

  /** Saved on the hub with the person's other preferences, so every device shows the same progress. */
  func markSeen(_ id: String) {
    guard let store, let next = Tour.withSeen(store.prefs?.learn, id) else { return }
    save(next)
  }

  private func save(_ learn: LearnProgress) {
    guard let store else { return }
    var prefs = store.prefs ?? Me.Prefs()
    // what another device saw meanwhile stays seen
    prefs.learn = Tour.merged(prefs.learn, learn)
    store.prefs = prefs
    let sent = prefs.learn
    Task { try? await store.savePrefs(["learn": AnyEncodable(sent)]) }
  }

  /** The chat the tour belongs to: the open one, else the newest chat with an agent, else any. */
  private func homeChat(_ store: Store) -> (channel: String?, agent: String?) {
    if let id = openChannel, let ch = store.channels.first(where: { $0.id == id }) {
      return (id, store.dmAgent(ch)?.id ?? store.agents.first?.id)
    }
    let dms = store.channels.filter { $0.isDM && $0.archivedAt == nil && store.dmAgent($0) != nil }
    if let newest = dms.max(by: { ($0.last?.at ?? $0.createdAt) < ($1.last?.at ?? $1.createdAt) }) {
      return (newest.id, store.dmAgent(newest)?.id)
    }
    let any = store.channels.first { $0.archivedAt == nil }
    return (any?.id, store.agents.first?.id)
  }

  // MARK: the window

  /** The tour draws in its own window over the app, so it stays above sheets like Settings. */
  private func showWindow(_ store: Store) {
    guard window == nil, let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }) ?? UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
    let w = TourWindow(windowScene: scene)
    w.windowLevel = .normal + 1
    w.backgroundColor = .clear
    let host = UIHostingController(rootView: TourOverlay(window: w).environment(store).appearance())
    host.view.backgroundColor = .clear
    w.rootViewController = host
    // the app's own light / dark choice
    w.overrideUserInterfaceStyle = scene.windows.first { $0 !== w }?.overrideUserInterfaceStyle ?? .unspecified
    w.isHidden = false
    window = w
  }
}

/**
 * The tour's window: it takes every touch except those inside the cut-out, which go to the real
 * control underneath. Before the bubble lands it takes them all.
 */
final class TourWindow: UIWindow {
  /** the cut-out, in this window's points; nil while flying */
  var passThrough: CGRect?
  /** the card, which keeps its touches even where it covers the cut-out */
  var card: CGRect = .zero
  private var lastHoleTouch: TimeInterval = -1

  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    if let hole = passThrough, hole.contains(point), !card.contains(point) {
      // a new touch on the real control: the stop that asks for a tap is done (hit-testing runs more than once per touch)
      if let event, event.type == .touches, event.timestamp != lastHoleTouch {
        lastHoleTouch = event.timestamp
        TourRun.shared.holeTapped()
      }
      return nil
    }
    return super.hitTest(point, with: event) ?? rootViewController?.view
  }
}

/** The name of the control here, for the tour to point at. */
private struct TourTarget: ViewModifier {
  var name: String
  var enabled: Bool
  @State private var last: CGRect?

  func body(content: Content) -> some View {
    content
      .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { rect in
        last = rect
        if enabled { TourRun.shared.setFrame(name, rect) }
      }
      // a tab or a page coming back keeps its frame, so it isn't measured again
      .onAppear { if enabled, let last { TourRun.shared.setFrame(name, last) } }
      .onDisappear { if enabled { TourRun.shared.setFrame(name, nil) } }
  }
}

extension View {
  /** Marks a control Show me around can point at (Tour.Stop.targets). */
  func tourTarget(_ name: String, enabled: Bool = true) -> some View {
    modifier(TourTarget(name: name, enabled: enabled))
  }
}
