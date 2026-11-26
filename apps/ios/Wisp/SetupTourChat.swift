import SwiftUI

/**
 * Right after the first run on the phone, in the new agent's chat (the web's SetupTour). Advanced:
 * the agent says what got done ("Great! I can see all that you've done." and which apps are
 * connected, or a plain line when none are), then Show me around starts on its own; when the tour
 * ends or is skipped it asks "What should I start on?". Simple: nothing starts; the tour waits in
 * Settings › Learn Wisp and Help. A tour already started on another device isn't repeated. It all
 * goes away once the person writes their first message.
 */
@MainActor enum SetupTour {
  struct State: Codable, Equatable {
    var channelId: String
    var at: Date
    /** ask: about to start the tour; tour: running; done: over */
    var stage: String
  }

  static let key = "wisp.setupTour"
  static let fresh: TimeInterval = 3 * 86_400

  static func load(_ defaults: UserDefaults = WispPreferences.standard, now: Date = .now) -> State? {
    guard let data = defaults.data(forKey: key), let s = try? JSONDecoder().decode(State.self, from: data), now.timeIntervalSince(s.at) < fresh else { return nil }
    return s
  }

  static func save(_ s: State?, _ defaults: UserDefaults = WispPreferences.standard) {
    if let s, let data = try? JSONEncoder().encode(s) { defaults.set(data, forKey: key) } else { defaults.removeObject(forKey: key) }
  }

  /** The first run calls this as it opens the new agent's chat. */
  static func begin(channelId: String) { save(State(channelId: channelId, at: .now, stage: "ask")) }

  /** Only true things: "Great!" when an app is connected, a plain line when none is. */
  static func opening(connected: [String]) -> [String] {
    guard !connected.isEmpty else { return ["No apps yet. That's fine, add them anytime."] }
    return ["Great! I can see all that you've done.", "\(andList(connected)) \(connected.count > 1 ? "are" : "is") connected."]
  }

  static func andList(_ names: [String]) -> String {
    switch names.count {
    case 0: ""
    case 1: names[0]
    case 2: "\(names[0]) and \(names[1])"
    default: names.dropLast().joined(separator: ", ") + " and " + names.last!
    }
  }

  /** Advanced is the default when the hub doesn't say (as on the web). */
  static func advanced(_ prefs: Me.Prefs?) -> Bool { (prefs?.experience ?? "advanced") == "advanced" }
}

struct SetupTourChat: View {
  @Environment(Store.self) private var store
  var channel: Channel
  @State private var state = SetupTour.load()
  @ReduceMotion private var reduceMotion

  private var spoke: Bool {
    guard let s = state else { return false }
    return (store.messages[channel.id] ?? []).contains { $0.author.kind == .user && (Wire.date($0.createdAt) ?? .distantPast) > s.at }
  }
  private var mine: Bool { state?.channelId == channel.id && !spoke && SetupTour.advanced(store.prefs) }

  var body: some View {
    if mine, let s = state {
      VStack(alignment: .leading, spacing: 3) {
        let lines = SetupTour.opening(connected: store.connectors.map(\.name))
        ForEach(Array(lines.enumerated()), id: \.offset) { i, line in
          Bubble(side: .theirs, tail: i == lines.count - 1) { Text(line).font(.system(size: 16)) }
        }
        if s.stage == "done" {
          Bubble(side: .theirs, tail: true) { Text("What should I start on?").font(.system(size: 16)) }
            .padding(.top, 6)
            .transition(reduceMotion ? .opacity : .scale(scale: 0.9, anchor: .bottomLeading).combined(with: .opacity))
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 18)
      .accessibilityElement(children: .combine)
      .task(id: s.stage) { await advance() }
      .onChange(of: TourRun.shared.active) { _, on in
        if !on, state?.stage == "tour" { set("done") }
      }
    }
  }

  private func set(_ stage: String) {
    guard var s = state else { return }
    s.stage = stage
    SetupTour.save(s)
    withAnimation(Motion.pick(Motion.pop, reduceMotion)) { state = s }
  }

  /** "ask": in 1.8 s the agent leaves to show you around, unless you've started the tour already. */
  private func advance() async {
    guard state?.stage == "ask" else { return }
    if store.prefs?.learn?.started == true { set("done"); return }
    try? await Task.sleep(for: .milliseconds(1800))
    guard !Task.isCancelled, state?.stage == "ask", !TourRun.shared.active else { return }
    set("tour")
    TourRun.shared.start(store, at: 0)
  }
}
