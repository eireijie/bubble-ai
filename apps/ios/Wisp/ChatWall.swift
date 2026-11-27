import SwiftUI
import UIKit

/**
 * Chat backgrounds, as on the web (apps/web/src/chatBackground.ts): none, one colour, or a photo.
 * A chat with an agent shows the agent's own (`settings.background`), else the person's default
 * (their prefs' `background`), else Mist. Both live on the hub, so a pick on the computer shows here.
 *
 * Round 9 (0.1.6 on the phone): a colour is a soft gradient derived from it (the web's
 * colorGradient, same stops), the open chat's background fills the whole screen, and the chat list
 * is a see-through tint over the same background (dark: black at 32%, light: black at 6%; a photo
 * gets a stronger veil so the names stay readable).
 */
enum ChatBackground: Codable, Hashable {
  case none
  case color(String)
  case photo(String)

  private enum Key: String, CodingKey { case kind, color, url }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Key.self)
    switch try c.decode(String.self, forKey: .kind) {
    case "color":
      let hex = try c.decode(String.self, forKey: .color)
      guard ChatWall.rgb(hex) != nil else { throw DecodingError.dataCorruptedError(forKey: .color, in: c, debugDescription: "not #rrggbb") }
      self = .color(hex)
    case "photo": self = .photo(try c.decode(String.self, forKey: .url))
    default: self = .none
    }
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: Key.self)
    switch self {
    case .none: try c.encode("none", forKey: .kind)
    case .color(let hex): try c.encode("color", forKey: .kind); try c.encode(hex, forKey: .color)
    case .photo(let url): try c.encode("photo", forKey: .kind); try c.encode(url, forKey: .url)
    }
  }

  var kind: String {
    switch self {
    case .none: "none"
    case .color: "color"
    case .photo: "photo"
    }
  }
}

/** A saved background that may be missing or not one this app knows: read without failing what holds it. */
struct OptionalBackground: Codable, Hashable {
  var value: ChatBackground?
  init(_ value: ChatBackground?) { self.value = value }
  init(from decoder: Decoder) throws { value = try? ChatBackground(from: decoder) }
  func encode(to encoder: Encoder) throws {
    if let value { try value.encode(to: encoder) } else { var c = encoder.singleValueContainer(); try c.encodeNil() }
  }
}

enum ChatWall {
  /** Each colour is a pair: a soft tint for light mode and a deep tone for dark mode (BACKGROUND_PAIRS). */
  static let pairs: [(light: String, dark: String)] = [
    ("#dfe4f3", "#262f45"), ("#dcebf5", "#1d2a44"), ("#d9eef0", "#173338"), ("#e2f0e6", "#1a3826"),
    ("#efe4f7", "#33223f"), ("#f3e3dc", "#3d1f2a"), ("#f6efd9", "#3a2f1f"),
  ]
  static let mist = "#dfe4f3"
  static let slate = "#262f45"
  /** what every chat shows until the person picks */
  static let fallback = ChatBackground.color(mist)

  // MARK: colour maths (the web's, step for step)

  static func rgb(_ hex: String) -> (Double, Double, Double)? {
    let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    guard s.count == 6, let n = UInt32(s, radix: 16) else { return nil }
    return (Double((n >> 16) & 255), Double((n >> 8) & 255), Double(n & 255))
  }
  static func hex(_ c: (Double, Double, Double)) -> String {
    func b(_ v: Double) -> String { String(format: "%02x", Int(min(255, max(0, v)).rounded())) }
    return "#" + b(c.0) + b(c.1) + b(c.2)
  }
  /** `a` moved toward `b` by t (0 to 1), in sRGB */
  static func mix(_ a: String, _ b: String, _ t: Double) -> String {
    guard let x = rgb(a), let y = rgb(b) else { return a }
    return hex((x.0 + (y.0 - x.0) * t, x.1 + (y.1 - x.1) * t, x.2 + (y.2 - x.2) * t))
  }
  static func hsl(_ hex: String) -> (Double, Double, Double) {
    guard let c = rgb(hex) else { return (0, 0, 0) }
    let r = c.0 / 255, g = c.1 / 255, b = c.2 / 255
    let mx = max(r, g, b), mn = min(r, g, b)
    let l = (mx + mn) / 2
    if mx == mn { return (0, 0, l) }
    let d = mx - mn
    let s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    let h = mx == r ? (g - b) / d + (g < b ? 6 : 0) : mx == g ? (b - r) / d + 2 : (r - g) / d + 4
    return (h * 60, s, l)
  }
  static func fromHsl(_ h: Double, _ s: Double, _ l: Double) -> String {
    func k(_ n: Double) -> Double { (n + h / 30).truncatingRemainder(dividingBy: 12) }
    let a = s * min(l, 1 - l)
    func f(_ n: Double) -> Double { l - a * max(-1, min(k(n) - 3, min(9 - k(n), 1))) }
    return hex((f(0) * 255, f(8) * 255, f(4) * 255))
  }
  /** turned a little around the wheel and made lighter or deeper */
  static func shift(_ hex: String, _ dh: Double, _ dl: Double) -> String {
    let (h, s, l) = hsl(hex)
    return fromHsl((h + dh + 360).truncatingRemainder(dividingBy: 360), s, min(0.97, max(0.03, l + dl)))
  }
  /** how light a colour is, 0 to 1 */
  static func lightness(_ hex: String) -> Double {
    guard let c = rgb(hex) else { return 0 }
    return (0.299 * c.0 + 0.587 * c.1 + 0.114 * c.2) / 255
  }

  /** The colour a saved one shows as: its pair's half for the mode; a light one from outside the pairs is tinted toward Slate blue in dark mode. */
  static func shown(_ hex: String, dark: Bool) -> String {
    let h = hex.lowercased()
    if let p = pairs.first(where: { $0.light == h || $0.dark == h }) { return dark ? p.dark : p.light }
    if !dark || lightness(hex) < 0.35 { return hex }
    return mix(hex, slate, 0.75)
  }

  /** The soft gradient's stops (colorGradient): a lighter tint top left, the colour across the middle, a deeper tone bottom right, and a faint glow in the top corner. */
  static func stops(_ hex: String, dark: Bool) -> (top: String, mid: String, end: String, glow: Double) {
    let top = dark ? shift(mix(hex, "#ffffff", 0.1), -10, 0.02) : shift(mix(hex, "#ffffff", 0.45), -12, 0)
    let end = dark ? shift(mix(hex, "#000000", 0.22), 14, 0) : shift(hex, 14, -0.05)
    return (top, hex, end, dark ? 0.06 : 0.45)
  }

  static func color(_ hex: String) -> Color {
    guard let c = rgb(hex) else { return .clear }
    return Color(red: c.0 / 255, green: c.1 / 255, blue: c.2 / 255)
  }
}

extension Store {
  /** The person's default background (Settings → Preferences → Background on the computer). */
  var defaultBackground: ChatBackground { prefs?.background?.value ?? ChatWall.fallback }

  /** What a chat with this agent shows: its own, else the default. Teams show the default. */
  func background(agentId: String?) -> ChatBackground {
    agentId.flatMap { agent($0)?.settings?.background?.value } ?? defaultBackground
  }

  /** What a chat shows. */
  func background(of channel: Channel?) -> ChatBackground {
    background(agentId: channel.flatMap { dmAgent($0)?.id })
  }
}

/** Photos used as backgrounds, loaded once through the hub (its files need the sign-in). */
@MainActor
@Observable
final class WallPhotos {
  static let shared = WallPhotos()
  private(set) var images: [String: UIImage] = [:]
  private var loading: Set<String> = []

  func image(_ url: String, store: Store) -> UIImage? {
    if let i = images[url] { return i }
    guard !loading.contains(url) else { return nil }
    loading.insert(url)
    let path = url.hasPrefix("/") ? url : "/" + url
    Task {
      if let data = try? await store.fetch({ try await $0.raw("GET", path, body: Optional<Empty>.none) }), let img = UIImage(data: data) {
        images[url] = img
      }
      loading.remove(url)
    }
    return nil
  }
}

/** A background drawn full screen: the soft gradient, the photo, or the plain app colour. */
struct ChatWallView: View {
  @Environment(Store.self) private var store
  @Environment(\.colorScheme) private var scheme
  var background: ChatBackground
  /** frosted (the list over a photo) */
  var frosted = false

  var body: some View {
    GeometryReader { g in
      switch background {
      case .none:
        Palette.ground
      case .color(let saved):
        let dark = scheme == .dark
        let s = ChatWall.stops(ChatWall.shown(saved, dark: dark), dark: dark)
        ZStack {
          LinearGradient(stops: [.init(color: ChatWall.color(s.top), location: 0), .init(color: ChatWall.color(s.mid), location: 0.48), .init(color: ChatWall.color(s.end), location: 1)],
                         startPoint: Self.cssLine(155, g.size).start, endPoint: Self.cssLine(155, g.size).end)
          // radial-gradient(110% 80% at 0% 0%, glow, transparent 60%)
          RadialGradient(colors: [Color.white.opacity(s.glow), Color.white.opacity(0)], center: .topLeading, startRadius: 0, endRadius: max(1, g.size.width * 1.1 * 0.6))
            .scaleEffect(x: 1, y: g.size.width > 0 ? (g.size.height * 0.8) / (g.size.width * 1.1) : 1, anchor: .top)
        }
      case .photo(let url):
        if let img = WallPhotos.shared.image(url, store: store) {
          Image(uiImage: img).resizable().scaledToFill()
            .frame(width: g.size.width, height: g.size.height).clipped()
            .blur(radius: frosted ? 28 : 0, opaque: true)
        } else {
          Palette.ground
        }
      }
    }
    .ignoresSafeArea()
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  /** Where a CSS `linear-gradient(<deg>deg, …)` line starts and ends in a box of this size, in unit points. */
  static func cssLine(_ deg: Double, _ size: CGSize) -> (start: UnitPoint, end: UnitPoint) {
    let w = max(size.width, 1), h = max(size.height, 1)
    let a = deg * .pi / 180
    let dx = sin(a), dy = -cos(a)
    let len = abs(w * sin(a)) + abs(h * cos(a))
    let hx = dx * len / 2 / w, hy = dy * len / 2 / h
    return (UnitPoint(x: 0.5 - hx, y: 0.5 - hy), UnitPoint(x: 0.5 + hx, y: 0.5 + hy))
  }
}

/** The list's see-through surface over the background: a dark tint (light theme: a light dim), and a stronger veil over a photo. */
struct WallTint: View {
  var background: ChatBackground
  var body: some View {
    (background.kind == "photo"
      ? Color(light: 0xF6F6F8, lightAlpha: 0.6, dark: 0x000000, darkAlpha: 0.46)
      : Color(light: 0x000000, lightAlpha: 0.06, dark: 0x000000, darkAlpha: 0.32))
      .ignoresSafeArea()
      .allowsHitTesting(false)
  }
}

private struct HasWallKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
  /** a background is drawn behind this screen: bars over it stay see-through instead of the plain app colour */
  var hasWall: Bool {
    get { self[HasWallKey.self] }
    set { self[HasWallKey.self] = newValue }
  }
}
