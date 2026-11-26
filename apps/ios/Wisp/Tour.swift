import CoreGraphics
import Foundation

/**
 * Show me around on the iPhone (2026-11-25 "Wisp, bubbles", board 11): the same 25 stops in 5
 * chapters as the web (apps/web/src/tour.ts), with the same titles and words. Each stop says where
 * it is on the phone and which real control it points at (`.tourTarget(_:)` names). This file is
 * the list and the arithmetic over it, with no views, so it can be tested; TourRun.swift runs it
 * and TourOverlay.swift draws it. Progress is kept on the hub (UserPrefs.learn), so the desktop and
 * the phone show the same seen stops.
 */
enum Tour {
  static let chapters = ["Talk", "Hands-off", "Tools", "Memory and teams", "Make it yours"]

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

  enum TryIt: String { case slash, at, yourturn }

  struct Stop: Identifiable, Equatable {
    var id: String
    /** chapter, 0 to 4 */
    var ch: Int
    var title: String
    var body: String
    var place: Place
    /** `.tourTarget` names, best first. The first one on screen is shown */
    var targets: [String]
    /** said instead of `body` when it points at the last, nearest target */
    var fallbackBody: String? = nil
    /** said instead of `body` in the phone app, where the web's words point at something it doesn't have */
    var phoneBody: String? = nil
    var tryIt: TryIt? = nil
    /** a mod this stop belongs to; when it's off the card offers a switch (never turned on for you) */
    var mod: FeatureKey? = nil
    /** guests can't use it, so they skip it */
    var noGuests = false
  }

  static let stops: [Stop] = [
    // Talk
    Stop(id: "write", ch: 0, title: "Write here", body: "Tell any agent what to do, in plain words. Right-click a message to reply in a thread or edit it.", place: .chat, targets: ["composer"]),
    Stop(id: "attach", ch: 0, title: "Add things", body: "Attach photos and files from +.", place: .chat, targets: ["attach"]),
    Stop(id: "slash", ch: 0, title: "/ commands", body: "Type / for quick commands: new chat, stop, switch model.", place: .chat, targets: ["composer"], tryIt: .slash),
    Stop(id: "mention", ch: 0, title: "@ mentions", body: "Type @ to ask another agent. In a team chat, it picks who answers.", place: .chat, targets: ["composer"], tryIt: .at),
    Stop(id: "call", ch: 0, title: "Calls", body: "Call any agent and just talk. Notes land in the chat after.", place: .chat, targets: ["call", "chat-more"]),
    // Hands-off
    Stop(id: "your-turn", ch: 1, title: "Your turn", body: "Chats waiting on you land here. Orange means your turn, blue means unread.", place: .chats, targets: ["yourturn"], tryIt: .yourturn),
    Stop(id: "message-first", ch: 1, title: "They message first", body: "Agents check your apps on their own and message you when something needs you.", place: .chats, targets: ["needs-row", "chat-row"], fallbackBody: "Agents check your apps on their own. When something needs you, their chat moves up here with an orange dot.", mod: .background),
    Stop(id: "approvals", ch: 1, title: "Approvals", body: "Before sending, paying or deleting anything, agents ask. Their questions wait here: Allow or Not now.", place: .inbox, targets: ["needs-you", "inbox-page"]),
    Stop(id: "usage", ch: 1, title: "Usage and limits", body: "See what agents used, and set a daily limit for work they do on their own.", place: .usage, targets: ["usage-page"], noGuests: true),
    // Tools
    Stop(id: "apps", ch: 2, title: "Apps", body: "Connect the apps agents use. Sign-ins go through your password manager.", place: .marketplace, targets: ["market-apps", "market-page"], noGuests: true),
    Stop(id: "skills", ch: 2, title: "Skills", body: "Jobs agents know how to do. Add them here, or do a task once on a computer and the agent saves it as a skill.", place: .marketplace, targets: ["market-skills", "market-page"], noGuests: true),
    Stop(id: "computers", ch: 2, title: "Computers", body: "Agents work on their own computer, so yours stays free. The dot says how many are on.", place: .computers, targets: ["computers-page"], phoneBody: "Agents work on their own computer, so yours stays free.", noGuests: true),
    Stop(id: "your-computers", ch: 2, title: "Your computers", body: "Watch live or take over. Agents can use your own computers too, only if you say so.", place: .computers, targets: ["computers-list", "computers-page"], noGuests: true),
    Stop(id: "phone", ch: 2, title: "Your phone", body: "Scan this with the Wisp phone app. Same agents, same chats, approvals on the go.", place: .settings, targets: ["notifications"], phoneBody: "You're in the Wisp phone app. Same agents, same chats. Turn on notifications for approvals on the go.", noGuests: true),
    // Memory and teams
    Stop(id: "vault", ch: 3, title: "Memory vault", body: "Notes agents keep about you and your work.", place: .more, targets: ["more-memory"]),
    Stop(id: "notes", ch: 3, title: "Read every note", body: "Fix or delete anything. Every agent reads these, so you only say it once.", place: .memory, targets: ["memory-page", "memory-search"]),
    Stop(id: "new", ch: 3, title: "New", body: "Make an agent, a team or a section.", place: .chats, targets: ["new"], noGuests: true),
    Stop(id: "teams", ch: 3, title: "Teams", body: "A team is a flow chart of who does what. Name it and pick its agents, then draw it, or describe it and an agent draws it.", place: .newTeam, targets: ["new-team"], noGuests: true),
    Stop(id: "schedules", ch: 3, title: "Schedules", body: "Add a Schedule box to a team's flow chart and the team starts on its own.", place: .team, targets: ["team-pill", "new"], fallbackBody: "Make a team, then add a Schedule box to its flow chart and it starts on its own.", mod: .routines, noGuests: true),
    // Make it yours
    Stop(id: "pins", ch: 4, title: "Pins", body: "Pin up to 9 agents and teams. Right-click any row to pin it.", place: .chats, targets: ["pins", "chat-row"], fallbackBody: "Right-click any row to pin it. Up to 9 agents and teams sit up here."),
    Stop(id: "sections", ch: 4, title: "Sections", body: "Your own groups. Drag rows in, fold away the ones you don't need.", place: .chats, targets: ["sections", "new-section"], phoneBody: "Your own groups. Press and hold a row to move it in, fold away the ones you don't need."),
    Stop(id: "agent-page", ch: 4, title: "Agent page", body: "Click an agent's name for its page: look, apps, and what it asks first.", place: .chat, targets: ["agent-pill"]),
    Stop(id: "ai", ch: 4, title: "What runs your agents", body: "Each agent runs on an AI you already use, like Claude Code or Codex. Sign in once.", place: .ai, targets: ["ai-page"], noGuests: true),
    Stop(id: "mods", ch: 4, title: "Mods", body: "Whole extra features, like Tasks, Apple and Storage. Off until you want them.", place: .mods, targets: ["mods-page", "mods-on"], mod: .tasks, noGuests: true),
    Stop(id: "settings", ch: 4, title: "Settings", body: "Everything else. Show me around lives here too, under Learn Wisp, and in Help.", place: .settings, targets: ["learn-row", "settings-page"]),
  ]

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

  /** "Chapter 2 of 5 · Hands-off · 1 of 4" */
  static func eyebrow(_ i: Int, _ list: [Stop] = stops) -> String {
    let s = list[i]
    let inCh = list.filter { $0.ch == s.ch }
    let n = (inCh.firstIndex { $0.id == s.id } ?? 0) + 1
    return "Chapter \(s.ch + 1) of \(chapters.count) · \(chapters[s.ch]) · \(n) of \(inCh.count)"
  }

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

  static func tryLabel(_ t: TryIt) -> String {
    switch t {
    case .slash: "Try it: type /"
    case .at: "Try it: type @"
    case .yourturn: "Try it: tap Your turn"
    }
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
