import Foundation
import UIKit

/**
 * What a pairing QR code from Bubble AI → Settings → Computers → Phone carries:
 * `wisp://pair?v=1&id=…&s=…&u=http://wisp.local:4747&u=…`, the pairing, its one-time secret,
 * and the addresses this phone might reach the computer at, best first.
 */
struct PairLink: Equatable {
  var id: String
  var secret: String
  var addresses: [URL]

  /**
   * Takes the link on its own, or the first `wisp://pair…` / `warren://pair…` inside longer text
   * (a pasted message), with the scheme in any case.
   */
  init?(_ text: String) {
    guard let found = Self.find(in: text), let c = URLComponents(string: found),
          ["wisp", "warren"].contains(c.scheme?.lowercased() ?? ""), c.host?.lowercased() == "pair" else { return nil }
    let items = c.queryItems ?? []
    guard let id = items.first(where: { $0.name == "id" })?.value,
          let secret = items.first(where: { $0.name == "s" })?.value else { return nil }
    let addresses = items.filter { $0.name == "u" }.compactMap { $0.value.flatMap(API.normalize) }
    guard !addresses.isEmpty else { return nil }
    self.id = id
    self.secret = secret
    self.addresses = addresses
  }

  /** The first pairing link in some text, without the punctuation a sentence puts after it. */
  static func find(in text: String) -> String? {
    guard let r = text.range(of: #"\b(wisp|warren)://pair[^\s"'<>`]*"#, options: [.regularExpression, .caseInsensitive]) else { return nil }
    var link = String(text[r])
    while let last = link.last, ".,;:!?)]}".contains(last) { link.removeLast() }
    return link
  }

  /** Where it will try first, as people know it: `wisp.local:4747`. */
  var firstPlace: String {
    guard let url = addresses.first, let host = url.host() else { return "" }
    return url.port.map { "\(host):\($0)" } ?? host
  }

  /** What the "Type a link" field holds, checked as it's typed. */
  enum Check: Equatable {
    case empty
    /** the start of a pairing link, still being typed */
    case typing
    case ok(PairLink)
    /** starts like a pairing link but is missing a part (cut short when copied) */
    case incomplete
    /** just a computer's address: it has no secret, so the computer can't tell it's you */
    case address
    case wrong
  }

  static func check(_ text: String) -> Check {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.isEmpty { return .empty }
    if let link = PairLink(t) { return .ok(link) }
    let lower = t.lowercased()
    for start in ["wisp://pair", "warren://pair"] {
      if start.hasPrefix(lower) { return .typing }
      if lower.hasPrefix(start) { return .incomplete }
    }
    if !t.contains(where: \.isWhitespace), let url = API.normalize(t), let host = url.host(),
       host == "localhost" || host.contains(".") || host.contains(":") { return .address }
    return .wrong
  }
}

/** The phone's half of pairing: find the computer, claim the pairing, wait for the person to confirm. */
enum Pairing {
  struct Claimed: Decodable {
    var code: String
    var userName: String?
    var workspaceName: String?
  }

  struct Failure: LocalizedError {
    var message: String
    /** no address answered */
    var unreachable = false
    /** the computer said no, or the code ran out: the person can ask again */
    var denied = false
    var errorDescription: String? { message }
  }

  /** The first of the QR code's addresses (in its order) that answers as a Bubble AI hub. */
  static func reachable(_ addresses: [URL]) async -> URL? {
    let answered = await withTaskGroup(of: (Int, Bool).self) { group in
      for (i, url) in addresses.enumerated() {
        group.addTask {
          var req = URLRequest(url: url.appending(path: "/api/setup"), timeoutInterval: 5)
          req.httpMethod = "GET"
          guard let (_, resp) = try? await URLSession.shared.data(for: req) else { return (i, false) }
          return (i, (resp as? HTTPURLResponse)?.statusCode == 200)
        }
      }
      var ok: [Int] = []
      for await (i, up) in group where up { ok.append(i) }
      return ok
    }
    return answered.min().map { addresses[$0] }
  }

  static func claim(_ link: PairLink, at hub: URL) async throws -> Claimed {
    struct Body: Encodable { var secret: String; var deviceName: String; var platform = "ios" }
    let name = await MainActor.run { UIDevice.current.name }
    return try await API(base: hub).post("/api/pair/\(link.id)/claim", Body(secret: link.secret, deviceName: name))
  }

  /** Asks every second and a half until the person confirms on the computer, cancels, or time runs out. */
  static func waitForConfirm(_ link: PairLink, at hub: URL) async throws -> String {
    struct Body: Encodable { var secret: String }
    struct Status: Decodable { var state: String; var token: String? }
    let api = API(base: hub)
    while !Task.isCancelled {
      let s: Status = try await api.post("/api/pair/\(link.id)/status", Body(secret: link.secret))
      switch s.state {
      case "approved":
        if let token = s.token { return token }
      case "rejected":
        throw Failure(message: "Your Bubble AI said no, or nobody answered in time. You can ask again.", denied: true)
      case "expired":
        throw Failure(message: "The code expired. Show a new one on your computer and scan again.", denied: true)
      default:
        break
      }
      try await Task.sleep(for: .milliseconds(1500))
    }
    throw CancellationError()
  }
}
