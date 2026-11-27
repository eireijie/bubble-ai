import SwiftUI

/** The chat list's one mark (web round 4/6/8): a blue dot when a chat needs you or has something unread. */
enum ChatDot {
  static let blue = Color(hex: 0x0A84FF)
}

extension View {
  /**
   * A dot centred on a round bubble's own top-left edge (14.6% in from the box's corner, where a
   * circle's edge crosses the diagonal), cut cleanly from the bubble by a 2pt see-through ring, so it
   * reads on any background (web round 8's pinned dot). nil: no dot.
   */
  func dotOnEdge(_ color: Color?, size d: CGFloat) -> some View {
    modifier(EdgeDot(color: color, d: d))
  }
}

private struct EdgeDot: ViewModifier {
  var color: Color?
  var d: CGFloat
  func body(content: Content) -> some View {
    if let color {
      content
        .mask {
          GeometryReader { g in
            let at = g.size.width * 0.146
            Rectangle()
              .overlay(alignment: .topLeading) {
                Circle().frame(width: d + 4, height: d + 4).offset(x: at - (d + 4) / 2, y: at - (d + 4) / 2).blendMode(.destinationOut)
              }
              .compositingGroup()
          }
        }
        .overlay {
          GeometryReader { g in
            let at = g.size.width * 0.146
            Circle().fill(color).frame(width: d, height: d).offset(x: at - d / 2, y: at - d / 2)
          }
          .allowsHitTesting(false)
        }
    } else {
      content
    }
  }
}

/** Connected apps (on, and signed in when they need it) that Bubble AI carries a logo for, newest first. */
enum ConnectedLogos {
  static func of(_ connectors: [AppConnector], max: Int = 3) -> [BundledLogo] {
    var out: [BundledLogo] = []
    for c in connectors.reversed() where c.enabled != false && !c.needsSignIn {
      if let l = BrandLogos.find(c.catalogId, c.name), !out.contains(l) { out.append(l) }
      if out.count >= max { break }
    }
    return out
  }
}

/** Up to three connected logos: small white rounded squares overlapping a little (the web's LogoStack). */
struct LogoStack: View {
  var logos: [BundledLogo]
  var size: CGFloat = 20
  var body: some View {
    HStack(spacing: -5) {
      ForEach(logos, id: \.self) { l in
        SVGShape(box: CGRect(x: 0, y: 0, width: 24, height: 24), commands: l.path)
          .fill(BrandLogos.isDark(l.hex) ? Color(hex: 0x111111) : ChatWall.color("#" + l.hex))
          .frame(width: size * 0.6, height: size * 0.6)
          .frame(width: size, height: size)
          .background(Color.white, in: RoundedRectangle(cornerRadius: (size * 0.3).rounded(), style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: (size * 0.3).rounded(), style: .continuous).stroke(Color(light: 0xE4E4E8, dark: 0x2A2A2D), lineWidth: 1.5))
      }
    }
    .accessibilityHidden(true)
  }
}

/** "Connect apps" at the bottom of the chat list, with the logos of what's connected (web round 8's sidebar pill). */
struct ConnectAppsPill: View {
  @Environment(Store.self) private var store
  var open: () -> Void

  var body: some View {
    Button(action: open) {
      HStack(spacing: 8) {
        Text("Connect apps").font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.text).lineLimit(1)
        LogoStack(logos: ConnectedLogos.of(store.connectors))
      }
      .frame(maxWidth: .infinity).padding(.horizontal, 16).frame(height: 44)
      .glassCapsule(interactive: true)
      .contentShape(Capsule())
    }
    .buttonStyle(.press)
    .accessibilityLabel("Connect apps")
    .accessibilityIdentifier("connect-apps-pill")
    .task { try? await store.refreshConnectors() }
  }
}

/** A plain line icon on the same white square as a logo's (skills, mods, things on your computers). */
struct LineTile: View {
  var symbol: String
  var size: CGFloat = 42
  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: size * 0.43, weight: .regular))
      .foregroundStyle(Palette.text)
      .frame(width: size, height: size)
      .background(Color(light: 0xFFFFFF, dark: 0x2C2C2E), in: RoundedRectangle(cornerRadius: size * 0.27, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: size * 0.27, style: .continuous).strokeBorder(Color(light: 0x000000, lightAlpha: 0.08, dark: 0xFFFFFF, darkAlpha: 0.09)))
      .accessibilityHidden(true)
  }
}

extension View {
  /**
   * Every custom menu and pop-up's one surface (web round 6): translucent glass with a blur, a thin
   * light rim and a soft shadow, in the app's colours for light and dark. Menus open and close
   * instantly; only the bubbles move.
   */
  func popGlass(radius: CGFloat = 15) -> some View {
    let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
    return self
      .background(Color(light: 0xFAFAFC, lightAlpha: 0.74, dark: 0x222328, darkAlpha: 0.76), in: shape)
      .background(.ultraThinMaterial, in: shape)
      .overlay(shape.strokeBorder(Color(light: 0xFFFFFF, lightAlpha: 0.8, dark: 0xFFFFFF, darkAlpha: 0.14)))
      .shadow(color: .black.opacity(0.18), radius: 16, y: 8)
  }
}
