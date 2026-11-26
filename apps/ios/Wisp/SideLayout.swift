import Foundation

/**
 * One person's chat list (2026-11-25 "Wisp, bubbles", core types.ts SidebarLayout): up to 9 pins,
 * their own named sections, what they hid and what they marked unread. Saved in the hub's
 * UserPrefs.sidebar, so the phone and the desktop show the same list. Items are chat keys:
 * "a:<agentId>" for an agent, "c:<channelId>" for a team.
 */
struct SidebarLayout: Codable, Hashable {
  struct Section: Codable, Hashable {
    var id: String
    var name: String
    var folded: Bool?
    var items: [String]
  }
  var pins: [String]
  var sections: [Section]
  var noneFolded: Bool?
  var hidden: [String]?
  var unread: [String]?
}

/** Where a chat shows: a pin, or a section ("none" is No section). The same rules as web sidebarLayout.ts. */
enum SideLayout {
  static let maxPins = 9
  static let none = "none"

  struct Chat {
    var key: String
    var pinned: Bool
    var sectionId: String?
    var unread: Int
  }

  struct Placed: Identifiable, Hashable {
    var id: String
    var name: String
    var folded: Bool
    var keys: [String]
    var isNone: Bool { id == SideLayout.none }
  }

  /** The layout as saved, or the one read from before: starred chats are the pins, the workspace's sections and each team's section are the sections. */
  static func base(_ saved: SidebarLayout?, chats: [Chat], sections: [ChannelSection]) -> SidebarLayout {
    if let saved { return saved }
    return SidebarLayout(
      pins: Array(chats.filter(\.pinned).prefix(maxPins).map(\.key)),
      sections: sections.map { s in .init(id: s.id, name: s.name, items: chats.filter { $0.sectionId == s.id }.map(\.key)) })
  }

  /** The pins (in pin order), then each section and No section last, each in the chats' own order. A hidden chat stays out until something new arrives in it. */
  static func place(_ l: SidebarLayout, chats: [Chat]) -> (pins: [String], sections: [Placed]) {
    let exists = Set(chats.map(\.key))
    let hidden = Set(l.hidden ?? [])
    let unread = Dictionary(chats.map { ($0.key, $0.unread) }, uniquingKeysWith: { a, _ in a })
    func shown(_ k: String) -> Bool { exists.contains(k) && !(hidden.contains(k) && (unread[k] ?? 0) == 0) }
    let pins = Array(l.pins.filter(shown).prefix(maxPins))
    let pinned = Set(pins)
    var owner: [String: String] = [:]
    for s in l.sections { for k in s.items where owner[k] == nil { owner[k] = s.id } }
    var out = l.sections.map { s in
      Placed(id: s.id, name: s.name, folded: s.folded ?? false, keys: chats.map(\.key).filter { owner[$0] == s.id && !pinned.contains($0) && shown($0) })
    }
    out.append(Placed(id: none, name: "No section", folded: l.noneFolded ?? false, keys: chats.map(\.key).filter { owner[$0] == nil && !pinned.contains($0) && shown($0) }))
    return (pins, out)
  }

  private static func without(_ xs: [String]?, _ k: String) -> [String] { (xs ?? []).filter { $0 != k } }

  /** Pin a chat; nil when 9 are already pinned. */
  static func pin(_ l: SidebarLayout, _ key: String) -> SidebarLayout? {
    if l.pins.contains(key) { return l }
    if l.pins.count >= maxPins { return nil }
    var n = l
    n.pins.append(key)
    n.hidden = without(l.hidden, key)
    return n
  }

  static func unpin(_ l: SidebarLayout, _ key: String) -> SidebarLayout {
    var n = l; n.pins = without(l.pins, key); return n
  }

  /** Put a chat in a section (or No section), unpinning it if it was pinned. */
  static func move(_ l: SidebarLayout, _ key: String, to sectionId: String) -> SidebarLayout {
    var n = l
    n.pins = without(l.pins, key)
    n.hidden = without(l.hidden, key)
    n.sections = l.sections.map { s in
      var s = s
      s.items = s.id == sectionId ? without(s.items, key) + [key] : without(s.items, key)
      return s
    }
    return n
  }

  static func addSection(_ l: SidebarLayout, name: String, id: String, key: String? = nil) -> SidebarLayout {
    var n = l
    n.sections.append(.init(id: id, name: name, items: []))
    return key.map { move(n, $0, to: id) } ?? n
  }

  static func renameSection(_ l: SidebarLayout, _ id: String, _ name: String) -> SidebarLayout {
    var n = l
    let clean = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
    n.sections = l.sections.map { s in var s = s; if s.id == id, !clean.isEmpty { s.name = clean }; return s }
    return n
  }

  /** Deleting a section keeps its chats: they go to No section. */
  static func deleteSection(_ l: SidebarLayout, _ id: String) -> SidebarLayout {
    var n = l; n.sections = l.sections.filter { $0.id != id }; return n
  }

  static func fold(_ l: SidebarLayout, _ id: String, _ folded: Bool) -> SidebarLayout {
    var n = l
    if id == none { n.noneFolded = folded ? true : nil; return n }
    n.sections = l.sections.map { s in var s = s; if s.id == id { s.folded = folded ? true : nil }; return s }
    return n
  }

  static func hide(_ l: SidebarLayout, _ key: String) -> SidebarLayout {
    var n = l; n.pins = without(l.pins, key); n.hidden = without(l.hidden, key) + [key]; return n
  }

  static func markUnread(_ l: SidebarLayout, _ key: String) -> SidebarLayout {
    var n = l; n.unread = without(l.unread, key) + [key]; return n
  }

  static func clearUnread(_ l: SidebarLayout, _ key: String) -> SidebarLayout {
    var n = l; n.unread = without(l.unread, key); return n
  }

  /** A chat that was deleted leaves every list. */
  static func forget(_ l: SidebarLayout, _ key: String) -> SidebarLayout {
    var n = unpin(l, key)
    n.hidden = without(l.hidden, key)
    n.unread = without(l.unread, key)
    n.sections = l.sections.map { s in var s = s; s.items = without(s.items, key); return s }
    return n
  }

  /** "New section", "New section 2"… */
  static func newSectionName(_ l: SidebarLayout) -> String {
    let taken = Set(l.sections.map(\.name))
    var n = 1
    while true {
      let name = n == 1 ? "New section" : "New section \(n)"
      if !taken.contains(name) { return name }
      n += 1
    }
  }

  /** What a 10th pin says. */
  static func pinsFullNotice(_ name: String) -> String { "\(maxPins) pinned is the most. Unpin one to pin \(name)." }
}
