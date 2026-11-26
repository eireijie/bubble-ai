import SwiftUI
import UIKit

/**
 * The first screen when the phone isn't paired (2026-11-26, canvas "Phone welcome", round 2, owner's
 * picks: the Calm background and the Pill button). The big bubble with eyes floats in the middle with
 * soap bubbles rising around it, "Bubble" and one line under it, and at the bottom "Scan a QR code"
 * and "or type a link". Only this screen says "Bubble". Without a camera the big button types a link.
 */
struct WelcomeView: View {
  var hasCamera: Bool
  /** a line from the app, like why it signed out */
  var message: String?
  /** false while the scanner covers the screen, so the bubbles stop drawing */
  var running = true
  var scan: () -> Void
  var typeLink: () -> Void

  /** the opening plays the first time the screen shows in a run, not on coming back to it */
  @MainActor private static var played = false
  @State private var opening = !WelcomeView.played
  @State private var shown = WelcomeView.played
  @ReduceMotion private var reduceMotion

  var body: some View {
    GeometryReader { geo in
      let full = geo.size.height
      ZStack(alignment: .top) {
        CalmBackground()
        WelcomeStage(running: running, opening: opening)
        VStack(spacing: 8) {
          Text(verbatim: "Bubble")
            .font(.system(size: 28, weight: .semibold))
            .tracking(-0.7)
            .foregroundStyle(WelcomeInk.word)
            .accessibilityAddTraits(.isHeader)
            .modifier(Entrance(shown: shown, delay: 0.55))
          Text("Your agents, on your phone.")
            .font(.system(size: 16.5))
            .foregroundStyle(WelcomeInk.tag)
            .modifier(Entrance(shown: shown, delay: 0.7))
          if let message {
            Text(message)
              .font(.footnote)
              .foregroundStyle(WelcomeInk.tag)
              .multilineTextAlignment(.center)
              .padding(.top, 6)
              .modifier(Entrance(shown: shown, delay: 0.7))
          }
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 28)
        .frame(maxWidth: .infinity)
        // under the big bubble, which sits 42% down the whole screen
        .padding(.top, full * 0.42 + 118)
        .allowsHitTesting(false)
      }
      .frame(width: geo.size.width, height: full)
    }
    // laid out on the whole screen, so the big bubble sits at the same place on every phone
    .ignoresSafeArea()
    .overlay(alignment: .bottom) { actions.modifier(Entrance(shown: shown, delay: 0.85)) }
    .onAppear {
      WelcomeView.played = true
      if !shown { shown = true }
    }
  }

  private var actions: some View {
    VStack(spacing: 4) {
      Button(action: hasCamera ? scan : typeLink) {
        HStack(spacing: 10) {
          Image(systemName: hasCamera ? "qrcode.viewfinder" : "link").font(.system(size: 19, weight: .medium))
          Text(hasCamera ? "Scan a QR code" : "Type a link").font(.system(size: 18, weight: .semibold)).tracking(-0.2)
        }
        .foregroundStyle(WelcomeInk.buttonText)
        .frame(maxWidth: .infinity, minHeight: 58)
        .background(Capsule().fill(WelcomeInk.button))
        .contentShape(Capsule())
      }
      .buttonStyle(.press)
      .accessibilityIdentifier(hasCamera ? "pair-scan" : "pair-paste")
      if hasCamera {
        Button(action: typeLink) {
          (Text("or ") + Text("type a link").underline(true, color: WelcomeInk.link.opacity(0.45)))
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(WelcomeInk.link)
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Type a link")
        .accessibilityIdentifier("pair-paste")
      }
    }
    .frame(maxWidth: 480)
    .padding(.horizontal, 24)
    .padding(.bottom, 10)
  }

  /** Fades up 14 pt into place after a delay; a fade alone with Reduce Motion. */
  private struct Entrance: ViewModifier {
    var shown: Bool
    var delay: Double
    @ReduceMotion private var reduceMotion
    func body(content: Content) -> some View {
      content
        .opacity(shown ? 1 : 0)
        .offset(y: shown || reduceMotion ? 0 : 14)
        .animation(.timingCurve(0.2, 0.8, 0.2, 1, duration: 0.7).delay(delay), value: shown)
    }
  }
}

/** The welcome screen's colours, light and dark (the canvas's Calm phone). */
enum WelcomeInk {
  static let ground = Color(light: 0xF5F5F7, dark: 0x0E0E11)
  static let groundLift = Color(light: 0xFBFBFD, dark: 0x17161C)
  static let word = Color(light: 0x141414, dark: 0xF4F4F2)
  static let tag = Color(light: 0x6B6A72, dark: 0x9D9BA6)
  static let button = Color(light: 0x141414, dark: 0xF4F4F2)
  static let buttonText = Color(light: 0xFFFFFF, dark: 0x141414)
  static let link = Color(light: 0x3A3940, dark: 0xD8D7DC)
}

/**
 * Calm: a pale ground, a soft rainbow glow behind the big bubble that turns once a minute, faint
 * ripples of light near the middle, and fine grain. The glow, ripples and grain are drawn once into
 * images and only moved, so the background costs almost nothing per frame.
 */
struct CalmBackground: View {
  @Environment(\.colorScheme) private var colorScheme
  @ReduceMotion private var reduceMotion
  @State private var turning = false

  var body: some View {
    let dark = colorScheme == .dark
    GeometryReader { geo in
      let c = CGPoint(x: geo.size.width / 2, y: geo.size.height * 0.42)
      ZStack {
        WelcomeInk.ground
        RadialGradient(colors: [WelcomeInk.groundLift, WelcomeInk.ground], center: UnitPoint(x: 0.5, y: 0.4), startRadius: 0, endRadius: geo.size.height * 0.5)
        Image(uiImage: CalmArt.glow)
          .resizable()
          .frame(width: 800, height: 800)
          .opacity(dark ? 0.34 : 0.5)
          .rotationEffect(.degrees(turning ? 360 : 0))
          .animation(turning ? .linear(duration: 60).repeatForever(autoreverses: false) : nil, value: turning)
          .position(c)
        Image(uiImage: CalmArt.ripples)
          .resizable()
          .frame(width: 560, height: 560)
          .opacity(dark ? 0.10 : 0.55)
          .rotationEffect(.degrees(turning ? 6 : 0))
          .offset(x: turning ? 12 : -12, y: turning ? 8 : -8)
          .animation(turning ? .easeInOut(duration: 38).repeatForever(autoreverses: true) : nil, value: turning)
          .position(x: c.x, y: geo.size.height * 0.44)
        Image(uiImage: CalmArt.grain)
          .resizable(resizingMode: .tile)
          .opacity(dark ? 0.07 : 0.05)
      }
      .frame(width: geo.size.width, height: geo.size.height)
      .clipped()
    }
    .ignoresSafeArea()
    .allowsHitTesting(false)
    .accessibilityHidden(true)
    .onAppear { turning = !reduceMotion }
    .onChange(of: reduceMotion) { _, still in turning = !still }
  }
}

/** The background's images, made once. */
@MainActor
enum CalmArt {
  /** a soft rainbow, already blurred, so turning it is just a rotation */
  static let glow: UIImage = {
    let colors = ["#c7b6ff", "#a9d2ff", "#b6f0dc", "#fff0b8", "#ffc6d4", "#c7b6ff"].map { Color(hex: $0) }
    let view = Circle()
      .fill(AngularGradient(colors: colors, center: .center))
      .frame(width: 520, height: 520)
      .blur(radius: 70)
      .frame(width: 800, height: 800)
    let r = ImageRenderer(content: view)
    r.scale = 1
    return r.uiImage ?? UIImage()
  }()

  /** caustic ripples: thin bright lines where waves of light cross, fading out towards the edge */
  static let ripples: UIImage = {
    let n = 240
    var px = [UInt8](repeating: 0, count: n * n * 4)
    for y in 0..<n {
      for x in 0..<n {
        let u = Double(x) / Double(n) * 9, v = Double(y) / Double(n) * 9
        let a = sin(u * 1.3 + sin(v * 0.9) * 1.8 + 0.7)
        let b = sin(v * 1.1 + sin(u * 1.2) * 1.6 + 2.1)
        let line = pow(max(0, 1 - abs(a + b) * 0.9), 6)
        let dx = Double(x - n / 2) / Double(n / 2), dy = Double(y - n / 2) / Double(n / 2)
        let mask = max(0, 1 - sqrt(dx * dx + dy * dy))
        let alpha = UInt8(min(255, line * mask * mask * 120))
        let i = (y * n + x) * 4
        // premultiplied white
        px[i] = alpha; px[i + 1] = alpha; px[i + 2] = alpha; px[i + 3] = alpha
      }
    }
    return image(px, n)
  }()

  /** fine grain, tiled */
  static let grain: UIImage = {
    let n = 128
    var px = [UInt8](repeating: 0, count: n * n * 4)
    var seed: UInt32 = 7
    for i in 0..<(n * n) {
      seed = seed &* 1_664_525 &+ 1_013_904_223
      let v = UInt8(seed >> 24)
      let a = UInt8(170)
      // premultiplied grey at a fixed alpha
      let c = UInt8(Int(v) * Int(a) / 255)
      px[i * 4] = c; px[i * 4 + 1] = c; px[i * 4 + 2] = c; px[i * 4 + 3] = a
    }
    return image(px, n)
  }()

  private static func image(_ px: [UInt8], _ n: Int) -> UIImage {
    let data = Data(px) as CFData
    guard let provider = CGDataProvider(data: data),
          let cg = CGImage(width: n, height: n, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: n * 4, space: CGColorSpaceCreateDeviceRGB(),
                           bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    else { return UIImage() }
    return UIImage(cgImage: cg)
  }
}

#Preview("Welcome") {
  WelcomeView(hasCamera: true, message: nil, scan: {}, typeLink: {})
}
