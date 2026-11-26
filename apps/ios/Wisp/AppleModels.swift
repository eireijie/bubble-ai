import SwiftUI

// The Apple mod (packages/core/src/apple.ts): agents use Messages, Contacts, Calendar and Reminders
// through a Mac that joined the hub, and Location through this app.

enum AppleApp: String, CaseIterable, Codable, Identifiable {
  case messages, contacts, calendar, reminders, location
  var id: String { rawValue }

  /** the apps a Mac answers for */
  static let mac: [AppleApp] = [.messages, .contacts, .calendar, .reminders]

  var name: String {
    switch self {
    case .messages: "Messages"
    case .contacts: "Contacts"
    case .calendar: "Calendar"
    case .reminders: "Reminders"
    case .location: "Location"
    }
  }

  /** what each level means for this app: off, read, read and change */
  var levels: [String] {
    switch self {
    case .messages: ["Off", "Read", "Read and send"]
    case .location: ["Off", "When asked", "Asked and places"]
    default: ["Off", "Read", "Read and change"]
    }
  }

  func level(_ n: Int) -> String { levels[max(0, min(2, n))] }

  /** a plain line icon, until the Mac has sent the real one */
  var symbol: String {
    switch self {
    case .messages: "message"
    case .contacts: "person.crop.circle"
    case .calendar: "calendar"
    case .reminders: "checklist"
    case .location: "location"
    }
  }
}

/** A place this iPhone watches: agents hear when you arrive or leave, never where you are in between. */
struct ApplePlace: Codable, Hashable, Identifiable {
  var id: String
  var name: String
  var latitude: Double
  var longitude: Double
  /** metres */
  var radius: Double
  var arrive: Bool
  var leave: Bool

  /** "Arrive and leave", "Leave only" */
  var watching: String {
    switch (arrive, leave) {
    case (true, true): "Arrive and leave"
    case (true, false): "Arrive only"
    case (false, true): "Leave only"
    case (false, false): "Not watched"
    }
  }

  var symbol: String {
    switch name.lowercased() {
    case "home": "house"
    case "work", "office": "briefcase"
    case "school", "college", "university": "graduationcap"
    case "gym": "figure.run"
    default: "mappin.and.ellipse"
    }
  }

  /** a short random id, as the hub keeps them (at most 40 characters) */
  static func newId() -> String {
    let letters = Array("abcdefghijklmnopqrstuvwxyz0123456789")
    return String((0..<10).map { _ in letters.randomElement()! })
  }
}

struct AppleSettings: Codable, Hashable {
  struct Levels: Codable, Hashable {
    var messages = 1, contacts = 1, calendar = 1, reminders = 1, location = 1
    subscript(app: AppleApp) -> Int {
      get {
        switch app {
        case .messages: messages
        case .contacts: contacts
        case .calendar: calendar
        case .reminders: reminders
        case .location: location
        }
      }
      set {
        switch app {
        case .messages: messages = newValue
        case .contacts: contacts = newValue
        case .calendar: calendar = newValue
        case .reminders: reminders = newValue
        case .location: location = newValue
        }
      }
    }
  }

  struct SpeakUp: Codable, Hashable {
    var unanswered = true
    var unansweredFrom: [String] = []
    var calendar = true
    var reminders = true
    var places = true
  }

  /** the Mac that answers for Messages, Contacts, Calendar and Reminders; nil: none picked */
  var macNodeId: String?
  var levels = Levels()
  var allAgents = true
  var agentIds: [String] = []
  var speakUp = SpeakUp()
  /** the iPhone that answers for Location; nil: the most recent one that reported */
  var iphoneId: String?
  var places: [ApplePlace] = []
}

/** A partial change for PUT /api/apple/settings: only what's set is sent. */
struct AppleSettingsPatch: Encodable {
  var macNodeId: String?
  var levels: [String: Int]?
  var allAgents: Bool?
  var agentIds: [String]?
  var places: [ApplePlace]?
}

/** Each macOS permission the bridge needs, as the Mac sees it: allowed | denied | not_asked | unknown. */
struct AppleMacStatus: Codable, Hashable {
  var fullDiskAccess: String
  var messagesControl: String
  var contacts: String
  var calendars: String
  var reminders: String
  var messagesSignedIn: Bool?

  /** what's missing on the Mac for an app, in a few words, or nil when it's ready */
  func problem(for app: AppleApp, mac: String? = nil) -> String? {
    let on = mac.map { "on \($0)" } ?? "on the Mac"
    func missing(_ s: String) -> Bool { s == "denied" || s == "not_asked" }
    switch app {
    case .messages:
      if missing(fullDiskAccess) { return "Needs Full Disk Access \(on). Open System Settings on that Mac." }
      if messagesSignedIn == false { return "Messages isn't signed in \(on). Open Messages on that Mac." }
      if missing(messagesControl) { return "Can't send yet. Allow Messages control \(on), in System Settings on that Mac." }
      return nil
    case .contacts: return missing(contacts) ? "Needs access \(on). Open System Settings on that Mac." : nil
    case .calendar: return missing(calendars) ? "Needs access \(on). Open System Settings on that Mac." : nil
    case .reminders: return missing(reminders) ? "Needs access \(on). Open System Settings on that Mac." : nil
    case .location: return nil
    }
  }
}

/** What Settings → Apple shows (GET /api/apple). */
struct AppleInfo: Codable, Hashable {
  struct Mac: Codable, Hashable, Identifiable {
    var nodeId: String
    var name: String
    var online: Bool
    var status: AppleMacStatus?
    var id: String { nodeId }
  }
  struct Phone: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var lastAt: String?
  }
  struct AgentRef: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var handle: String
    var role: String?
  }

  var settings: AppleSettings
  var macs: [Mac]
  var iphones: [Phone]
  var agents: [AgentRef]

  /** the Mac that answers: the one picked, else the only one there is */
  var mac: Mac? {
    if let id = settings.macNodeId { return macs.first { $0.nodeId == id } }
    return macs.count == 1 ? macs.first : nil
  }
}

/** An agent asking to send a text or change an event or reminder: what the card shows (AppleRequest). */
struct AppleRequest: Codable, Hashable {
  struct Field: Codable, Hashable {
    var label: String
    var value: String
    /** shown struck through: what it was before */
    var was: Bool?
  }
  var app: String
  /** "Send a text", "Move an event" */
  var title: String
  /** "iMessage", "Work calendar" */
  var aside: String
  var fields: [Field]
  /** the text being sent: a blue bubble, editable before approving */
  var bubble: String?
  /** "Send", "Move it" */
  var yes: String
  /** "Don't send", "Leave it" */
  var no: String
  var requestedBy: String?

  var appKind: AppleApp { AppleApp(rawValue: app) ?? .messages }
}

extension Store {
  func refreshApple() async {
    guard features.apple else { apple = nil; AppleLocation.shared.sync(nil); return }
    do {
      let info: AppleInfo = try await fetch { try await $0.get("/api/apple") }
      apple = info
      AppleLocation.shared.sync(info)
    } catch is Stale {
    } catch let e as API.Failure where e.status == 404 {
      // the hub hasn't caught up with the mod being switched on: not an error to show
    } catch {
      recordSyncError(error)
    }
  }

  /** Owners only. Saves the change and keeps what the hub sends back. */
  @discardableResult
  func saveApple(_ patch: AppleSettingsPatch) async throws -> AppleInfo {
    let info: AppleInfo = try await fetch { try await $0.send("PUT", "/api/apple/settings", body: patch) }
    apple = info
    AppleLocation.shared.sync(info)
    return info
  }

  func reportAppleLocation(latitude: Double, longitude: Double, accuracy: Double, at: Date, requestId: String?, device: (id: String, name: String)) async throws {
    struct Body: Encodable { var latitude: Double; var longitude: Double; var accuracy: Double; var at: String; var requestId: String?; var deviceId: String; var deviceName: String }
    try await fetch { try await $0.post("/api/apple/location", Body(latitude: latitude, longitude: longitude, accuracy: max(0, accuracy), at: Wire.iso(at), requestId: requestId, deviceId: device.id, deviceName: device.name)) }
  }

  func reportApplePlace(_ placeId: String, kind: String, at: Date, deviceId: String) async throws {
    struct Body: Encodable { var placeId: String; var kind: String; var at: String; var deviceId: String }
    try await fetch { try await $0.post("/api/apple/place-event", Body(placeId: placeId, kind: kind, at: Wire.iso(at), deviceId: deviceId)) }
  }

  /** Yes or no on an Apple card; `text` is the edited text when the person changed it before sending. */
  func decideApple(_ approval: Approval, approve: Bool, text: String? = nil) async throws {
    struct Body: Encodable { var approve: Bool; var text: String? }
    let a: Approval = try await fetch { try await $0.post("/api/approvals/\(approval.id)/decide", Body(approve: approve, text: text)) }
    if let i = approvals.firstIndex(where: { $0.id == a.id }) { approvals[i] = a } else { approvals.insert(a, at: 0) }
  }
}

extension Wire {
  static func iso(_ date: Date) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: date)
  }
}

// --- the real app icons ---------------------------------------------------------------------

/**
 * An Apple app's icon. Bubble AI ships no Apple artwork: the real icon comes from the Mac through the
 * hub (GET /api/apple/icons/:app), cached; until then a plain line icon on a neutral tile.
 */
struct AppleIcon: View {
  @Environment(Store.self) private var store
  var app: AppleApp
  var size: CGFloat = 29
  @State private var image: UIImage?

  var body: some View {
    Group {
      if let image {
        Image(uiImage: image).resizable().interpolation(.high).scaledToFit()
          .frame(width: size, height: size)
          .clipShape(RoundedRectangle(cornerRadius: size * 0.225, style: .continuous))
      } else {
        Image(systemName: app.symbol)
          .font(.system(size: size * 0.5, weight: .regular))
          .foregroundStyle(Palette.text.opacity(0.85))
          .frame(width: size, height: size)
          .background(MarketColor.tile, in: RoundedRectangle(cornerRadius: size * 0.225, style: .continuous))
      }
    }
    .accessibilityHidden(true)
    .task(id: "\(app.rawValue)-\(store.appleIconsVersion)") {
      image = await AppleIconCache.shared.icon(app, store: store)
    }
  }
}

@MainActor final class AppleIconCache {
  static let shared = AppleIconCache()
  private var images: [String: UIImage] = [:]
  /** when each icon last 404'd, so a missing one isn't asked for on every row */
  private var missed: [String: Date] = [:]
  private var loading: [String: Task<UIImage?, Never>] = [:]

  /** forget what failed (a Mac may have sent them since) */
  func retryMisses() { missed = [:] }

  func icon(_ app: AppleApp, store: Store) async -> UIImage? {
    guard let host = store.api?.base.absoluteString else { return nil }
    let key = "\(host)|\(app.rawValue)"
    if let hit = images[key] { return hit }
    if let disk = Self.read(key) { images[key] = disk; return disk }
    if let at = missed[key], Date().timeIntervalSince(at) < 60 { return nil }
    if let running = loading[key] { return await running.value }
    let task = Task<UIImage?, Never> {
      guard let (data, response) = try? await store.fetch({ try await $0.request("GET", "/api/apple/icons/\(app.rawValue)", body: Optional<Empty>.none) }),
            (response.mimeType ?? "image/png").hasPrefix("image/"), let image = UIImage(data: data) else { return nil }
      Self.write(key, data)
      return image
    }
    loading[key] = task
    let image = await task.value
    loading[key] = nil
    if let image { images[key] = image } else { missed[key] = Date() }
    return image
  }

  private static func file(_ key: String) -> URL? {
    let name = key.data(using: .utf8)!.base64EncodedString().replacingOccurrences(of: "/", with: "_")
    return FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appending(path: "apple-icons/\(name).png")
  }

  private static func read(_ key: String) -> UIImage? {
    guard let url = file(key), let data = try? Data(contentsOf: url) else { return nil }
    return UIImage(data: data)
  }

  private static func write(_ key: String, _ data: Data) {
    guard let url = file(key) else { return }
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? data.write(to: url)
  }
}
