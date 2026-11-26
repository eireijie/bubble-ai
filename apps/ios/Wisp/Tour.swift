import CoreGraphics
import Foundation

/**
 * Show me around on the iPhone (2026-11-26 canvas "Bubble AI onboarding flow", Tour board): the
 * same four stops as the web (apps/web/src/tour.ts), and at each one you do the thing for real:
 * say hi to your agent, type /, open Your turn, make another. The stop finishes itself when you've
 * done it. Each stop says where it is on the phone and which real control it points at
 * (`.tourTarget(_:)` names). This file is the list and the arithmetic over it, with no views, so it
 * can be tested; TourRun.swift runs it and TourOverlay.swift draws it. Progress is kept on the hub
 * (UserPrefs.learn), so the desktop and the phone show the same seen stops.
 */
enum Tour {
  /** One chapter now: the stops are few enough to show as one row of dots. */
  static let chapters = ["Show me around"]

  /** Where a stop is on the phone. */
  enum Place: Equatable, Hashable {
    /** the chat the tour started from (or the newest chat with an agent) */
    case chat
    /** the Chats tab's list */
    case chats
    /** the Inbox tab */
    case inbox
    /** the Computers tab */
    case computers
    /** the More tab's list */
    case more
    /** More › Memory */
    case memory
    /** More › Marketplace */
    case marketplace
    /** More › Mods */
    case mods
    /** the Settings sheet */
    case settings
    /** Settings › Usage */
    case usage
    /** Settings › AI */
    case ai
    /** the New team sheet, over Chats */
    case newTeam
    /** a team's chat, when there is one (the Chats list otherwise) */
    case team

    var tab: MainTab {
      switch self {
      case .chat, .chats, .newTeam, .team: .chats
      case .inbox: .inbox
      case .computers: .computers
      case .more, .memory, .marketplace, .mods: .more
      // the Settings sheet opens over whatever tab is showing
      case .settings, .usage, .ai: .chats
      }
    }
    var inSettings: Bool { self == .settings || self == .usage || self == .ai }
  }

  /** What finishes a stop: sending a message, typing /, opening Your turn, or a tap on the control. */
  enum DoIt: String { case send, slash, yourturn, tap }

  struct Stop: Identifiable, Equatable {
    var id: String
    /** chapter (always 0 now) */
    var ch: Int = 0
    /** what to do; {agent} is the agent's name */
    var title: String
    var body: String
    var place: Place
    /** `.tourTarget` names, best first. The first one on screen is shown */
    var targets: [String]
    /** said instead of `body` when it points at the last, nearest target */
    var fallbackBody: String? = nil
    /** said instead of `body` in the phone app, where the web's words point at something it doesn't have */
    var phoneBody: String? = nil
    var doIt: DoIt
    /** a mod this stop belongs to; when it's off the card offers a switch (never turned on for you) */
    var mod: FeatureKey? = nil
    /** guests can't use it, so they skip it */
    var noGuests = false
  }

  static let stops: [Stop] = [
    Stop(id: "write", title: "Say hi to {agent}", body: "Type anything and press Return.", place: .chat, targets: ["composer"], phoneBody: "Type anything and send it.", doIt: .send),
    Stop(id: "slash", title: "Type /", body: "Quick commands: new chat, stop, switch model.", place: .chat, targets: ["composer"], doIt: .slash),
    Stop(id: "your-turn", title: "Open Your turn", body: "Chats waiting on you land here.", place: .chats, targets: ["yourturn"], doIt: .yourturn),
    Stop(id: "new", title: "Make another", body: "Another agent, or a team of them.", place: .chats, targets: ["new"], doIt: .tap, noGuests: true),
  ]

  /** A stop's title with the agent's name in it. */
  static func title(_ stop: Stop, agent: String?) -> String {
    stop.title.replacingOccurrences(of: "{agent}", with: agent?.isEmpty == false ? agent! : "your agent")
  }

  static var total: Int { stops.count }

  /** The stops this person can use: guests skip the ones they can't open. */
  static func stops(guest: Bool) -> [Stop] { guest ? stops.filter { !$0.noGuests } : stops }

  /** Only ids that are still stops, once each, in the order they were seen. */
  static func cleanSeen(_ seen: [String]?) -> [String] {
    let ids = Set(stops.map(\.id))
    var out: [String] = []
    for id in seen ?? [] where ids.contains(id) && !out.contains(id) { out.append(id) }
    return out
  }

  static func seenCount(_ p: LearnProgress?, _ list: [Stop] = stops) -> Int {
    let seen = Set(p?.seen ?? [])
    return list.filter { seen.contains($0.id) }.count
  }

  /** Where Resume starts: the first stop not seen, or the first stop when all are. */
  static func resumeIndex(_ p: LearnProgress?, _ list: [Stop] = stops) -> Int {
    let seen = Set(p?.seen ?? [])
    return list.firstIndex { !seen.contains($0.id) } ?? 0
  }

  struct ChapterProgress: Equatable, Identifiable {
    var name: String
    /** index of its first stop */
    var first: Int
    var total: Int
    var seen: Int
    var id: String { name }
  }

  /** Each chapter's stops and how many are seen. */
  static func chapterProgress(_ p: LearnProgress?, _ list: [Stop] = stops) -> [ChapterProgress] {
    let seen = Set(p?.seen ?? [])
    return chapters.enumerated().compactMap { ch, name in
      let idx = list.indices.filter { list[$0].ch == ch }
      guard let first = idx.first else { return nil }
      return ChapterProgress(name: name, first: first, total: idx.count, seen: idx.filter { seen.contains(list[$0].id) }.count)
    }
  }

  /** "2 of 4": the step counter under the card */
  static func counter(_ i: Int, _ list: [Stop] = stops) -> String { "\(min(i + 1, list.count)) of \(list.count)" }

  /** The button that starts the tour: never started, part way, or all seen. */
  static func resumeLabel(_ p: LearnProgress?, _ list: [Stop] = stops) -> String {
    let n = seenCount(p, list)
    return n == 0 ? "Show me around" : n >= list.count ? "Start again" : "Resume"
  }

  /** "6 of 25 seen · next: Approvals" */
  static func summary(_ p: LearnProgress?, _ list: [Stop] = stops) -> String {
    let n = seenCount(p, list)
    if n >= list.count { return "All \(list.count) seen" }
    return "\(n) of \(list.count) seen · next: \(list[resumeIndex(p, list)].title)"
  }

  /** Progress with one more stop seen (nil when nothing changes). */
  static func withSeen(_ p: LearnProgress?, _ id: String) -> LearnProgress? {
    let seen = cleanSeen(p?.seen)
    if seen.contains(id) && p?.started == true { return nil }
    return LearnProgress(seen: seen.contains(id) ? seen : seen + [id], started: true)
  }

  /** Two devices' progress put together: every stop either has seen. */
  static func merged(_ a: LearnProgress?, _ b: LearnProgress?) -> LearnProgress? {
    if a == nil && b == nil { return nil }
    return LearnProgress(seen: cleanSeen((a?.seen ?? []) + (b?.seen ?? [])), started: (a?.started ?? false) || (b?.started ?? false) ? true : nil)
  }

  /** What a stop says: its fallback when it points at what's nearest, its phone words, and touch words for mouse words. */
  static func body(_ stop: Stop, fallback: Bool) -> String {
    let text = fallback && stop.fallbackBody != nil ? stop.fallbackBody! : stop.phoneBody ?? stop.body
    return text.replacingOccurrences(of: "Right-click", with: "Press and hold").replacingOccurrences(of: "Click", with: "Tap")
  }

  // MARK: the flight

  /** The point on a quadratic curve from a through control c to b, at k (0 to 1). */
  static func curvePoint(_ a: CGPoint, _ c: CGPoint, _ b: CGPoint, _ k: CGFloat) -> CGPoint {
    let u = 1 - k
    return CGPoint(x: u * u * a.x + 2 * u * k * c.x + k * k * b.x, y: u * u * a.y + 2 * u * k * c.y + k * k * b.y)
  }

  /** A curve's middle point: bent to one side by up to 140pt, and lifted a little. */
  static func curveControl(_ a: CGPoint, _ b: CGPoint) -> CGPoint {
    let dx = b.x - a.x, dy = b.y - a.y
    let d = max(1, hypot(dx, dy))
    let bend = min(140, d * 0.3) * (a.x < b.x ? -1 : 1)
    return CGPoint(x: (a.x + b.x) / 2 - (dy / d) * bend, y: (a.y + b.y) / 2 + (dx / d) * bend - 30)
  }

  /** How long a flight takes, by distance: 0.6 to 1.25 s. */
  static func flightSeconds(_ a: CGPoint, _ b: CGPoint) -> Double {
    max(0.6, min(1.25, Double(hypot(b.x - a.x, b.y - a.y)) / 850))
  }

  static func easeInOut(_ k: CGFloat) -> CGFloat { k < 0.5 ? 4 * k * k * k : 1 - pow(-2 * k + 2, 3) / 2 }

  /** Which edge the card docks to: the top when the target sits low on the screen. */
  enum Dock: Equatable { case top, bottom }
  static func dock(target: CGRect, height: CGFloat) -> Dock {
    target.midY > height * 0.55 ? .top : .bottom
  }

  /**
   * Where the bubble sits next to its target, between it and the card (board 11), kept on screen:
   * below a target when the card is at the bottom, above it when the card is at the top, and just
   * inside the target's edge when there's no room outside it.
   */
  static func bubbleSpot(target r: CGRect, dock: Dock, size: CGFloat, screen: CGSize) -> CGPoint {
    let g = size / 2 + 12
    let m = size / 2 + 8
    let x = min(screen.width - m, max(m, r.maxX - min(r.width / 2, 40)))
    var y = dock == .bottom ? r.maxY + g : r.minY - g
    // no room on that side: sit just inside the target's edge
    if y < m + 44 || y > screen.height - m - 30 { y = dock == .bottom ? r.maxY - g : r.minY + g }
    return CGPoint(x: x, y: min(screen.height - m, max(m, y)))
  }
}

/** Progress through Show me around (UserPrefs.learn): stop ids seen, and whether it was ever started. */
struct LearnProgress: Codable, Equatable {
  var seen: [String]
  var started: Bool?
}
