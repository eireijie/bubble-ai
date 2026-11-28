import Foundation

/**
 * "Describe" on Bubble look (round 11, board 12), as the web's lookWords.ts: a few words give four
 * bubbles to pick from, read on this phone (no AI). Words it knows (a colour, a hat, glasses, a smile,
 * freckles, a shape, how it moves) are kept in all four; whatever the words leave open differs
 * between them, so there is something to pick.
 */
enum LookWords {
  private static let colours: [(String, String)] = [
    (#"\b(violet|purple|lavender|lilac)\b"#, "#b49cf7"),
    (#"\b(blue|navy|sky)\b"#, "#7fb0f0"),
    (#"\b(green|mint|sage|emerald)\b"#, "#6cc4a1"),
    (#"\b(yellow|gold|golden|sunny|lemon)\b"#, "#e6c35c"),
    (#"\b(orange|peach|amber|tangerine)\b"#, "#f2a65a"),
    (#"\b(pink|rose|blush|bubblegum)\b"#, "#e88fb4"),
    (#"\b(red|cherry|crimson|scarlet)\b"#, "#ef6b6b"),
    (#"\b(brown|stone|grey|gray|taupe|earthy)\b"#, "#9a8f86"),
    (#"\b(teal|cyan|aqua|turquoise)\b"#, "#5fc6d9"),
    (#"\b(orchid|magenta|plum)\b"#, "#c98af0"),
    (#"\b(lime|leaf|grass)\b"#, "#8fd16a"),
    (#"\b(white|silver|pale|light)\b"#, "#d0d0d6"),
  ]

  private typealias Patch = [(WritableKeyPath<GhostLook, String?>, String)]
  nonisolated(unsafe) private static let parts: [(String, Patch, Bool)] = [
    (#"\btop ?hat\b"#, [(\.hat, "tophat")], false),
    (#"\bparty\b"#, [(\.hat, "party")], false),
    (#"\bbeanie\b"#, [(\.hat, "beanie")], false),
    (#"\bcrown\b|\bking\b|\bqueen\b"#, [(\.hat, "crown")], false),
    (#"\bwitch\b"#, [(\.hat, "witch")], false),
    (#"\bheadphones?\b|\bmusic\b"#, [(\.hat, "headphones")], false),
    (#"\bhalo\b|\bangel\b"#, [(\.hat, "halo")], false),
    (#"\bflowers?\b"#, [(\.hat, "flower")], false),
    (#"\bpropeller\b"#, [(\.hat, "propeller")], false),
    (#"\bsunglasses\b|\bshades\b|\bcool\b"#, [(\.accessory, "sunglasses")], false),
    (#"\bglasses\b|\bnerdy\b|\bsmart\b"#, [(\.accessory, "glasses")], false),
    (#"\bmonocle\b|\bfancy\b"#, [(\.accessory, "monocle")], false),
    (#"\bbow ?tie\b"#, [(\.accessory, "bowtie")], false),
    (#"\bscarf\b|\bcozy\b|\bcosy\b"#, [(\.accessory, "scarf")], false),
    (#"\btie\b"#, [(\.accessory, "tie")], false),
    (#"\bmustache\b|\bmoustache\b"#, [(\.accessory, "mustache")], false),
    (#"\bbow\b(?! ?tie)"#, [(\.hat, "bow")], false),
    (#"\bfreckles?\b|\bcheeks?\b|\brosy\b"#, [], true),
    (#"\bsmil(e|ing|ey)\b|\bhappy\b|\bcheerful\b"#, [(\.mouth, "smile"), (\.eyes, "happy")], false),
    (#"\bcat\b|\bkitty\b"#, [(\.mouth, "cat")], false),
    (#"\bfangs?\b|\bvampire\b|\bspooky\b"#, [(\.mouth, "fangs")], false),
    (#"\btongue\b|\bsilly\b|\bcheeky\b"#, [(\.mouth, "tongue")], false),
    (#"\bwink(ing|y)?\b"#, [(\.eyes, "wink")], false),
    (#"\bsparkl(e|y|ing)\b|\bshiny\b"#, [(\.eyes, "sparkle")], false),
    (#"\bbig eyes\b|\bcute\b"#, [(\.eyes, "big")], false),
    (#"\bbounc(e|y)\b|\benergetic\b"#, [(\.motion, "bounce")], false),
    (#"\bsway(ing)?\b"#, [(\.motion, "sway")], false),
    (#"\bstill\b|\bcalm\b|\bquiet\b"#, [(\.motion, "still")], false),
    (#"\bsquare\b|\bsquircle\b"#, [(\.bubble, "squircle")], false),
    (#"\begg\b"#, [(\.bubble, "egg")], false),
    (#"\bdrop\b|\bdroplet\b|\btear\b"#, [(\.bubble, "drop")], false),
    (#"\bblob\b|\bwobbly\b"#, [(\.bubble, "blob")], false),
    (#"\bcapsule\b|\bpill\b"#, [(\.bubble, "capsule")], false),
    (#"\bdouble\b|\btwins?\b"#, [(\.bubble, "double")], false),
    (#"\bcluster\b|\bbubbly\b"#, [(\.bubble, "cluster")], false),
  ]

  private static let shapes = ["round", "squircle", "blob", "egg"]
  private static let hats = ["none", "beanie", "flower", "party"]
  private static let eyes = ["dots", "big", "happy", "sparkle"]
  private static let mouths = ["smile", "none", "smile", "open"]

  private static func matches(_ pattern: String, _ text: String) -> Bool {
    text.range(of: pattern, options: .regularExpression) != nil
  }

  /** the same words always give the same four */
  private static func seeded(_ text: String) -> () -> Double {
    var h: UInt32 = 2_166_136_261
    for u in text.unicodeScalars { h = (h ^ u.value) &* 16_777_619 }
    return {
      h = (h ^ (h >> 15)) &* 2_246_822_507
      h = (h ^ (h >> 13)) &* 3_266_489_909
      h ^= h >> 16
      return Double(h) / 4_294_967_296
    }
  }

  /** Four looks for these words. The colour is one of `palette` when the words name none. */
  static func looks(_ text: String, palette: [String]) -> [GhostLook] {
    let words = text.lowercased()
    let colour = colours.first { matches($0.0, words) }?.1
    var said: [PartialKeyPath<GhostLook>: String] = [:]
    var cheeks = false
    for (pattern, patch, rosy) in parts where matches(pattern, words) {
      if rosy { cheeks = true }
      for (key, value) in patch where said[key] == nil { said[key] = value }
    }
    let random = seeded(words.trimmingCharacters(in: .whitespaces).isEmpty ? "bubble" : words.trimmingCharacters(in: .whitespaces))
    return (0..<4).map { i in
      var look = GhostLook(color: colour ?? palette[Int(random() * Double(palette.count)) % palette.count], color2: nil,
        eyes: eyes[i], mouth: mouths[i], cheeks: cheeks, shape: "round", glow: nil,
        hat: hats[i], accessory: "none", motion: "float", bubble: shapes[i], parts: true)
      for (key, value) in said {
        if let k = key as? WritableKeyPath<GhostLook, String?> { look[keyPath: k] = value }
      }
      return look
    }
  }
}
