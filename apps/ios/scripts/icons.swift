// Draws the Bubble AI icons ("Full glass", direction D on the 2026-11-25 "Bubble AI icons" canvas) as PNGs:
//   swift apps/ios/scripts/icons.swift
// The tile itself is the bubble: frosted glass tinted soft blue, a rainbow rim round the tile's own edge, a
// small highlight, and two eyes glancing to the right. Light by default; dark where the platform has a dark
// icon. Writes the desktop app icon and menu bar template, the iOS app icons (light, dark, tinted) and Mark,
// the Android launcher icons, and the web and site PNGs. The SVGs (apps/web/public/icon.svg,
// site/public/favicon.svg) and the Android status-bar vector are hand-written to match.
import AppKit

let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
func rgb(_ hex: Int, _ a: CGFloat = 1) -> CGColor {
  CGColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: a)
}
let tint = 0x8fb4ff
let rainbow = [0xff7cc4, 0x7fb0ff, 0x6fe8c0, 0xffe27a, 0xff9c80, 0xbf86ff, 0xff7cc4]

/// A conic rainbow round `c`, drawn as thin wedges: starts 20° past straight up and runs clockwise, like the
/// app's CSS conic-gradient(from 20deg, …).
func conic(_ ctx: CGContext, center c: CGPoint, radius: CGFloat) {
  let n = 720
  for i in 0..<n {
    let f = CGFloat(i) / CGFloat(n), seg = f * CGFloat(rainbow.count - 1)
    let j = min(Int(seg), rainbow.count - 2), u = seg - CGFloat(j)
    let a = rainbow[j], b = rainbow[j + 1]
    func ch(_ x: Int, _ y: Int, _ sh: Int) -> CGFloat { CGFloat((x >> sh) & 255) * (1 - u) + CGFloat((y >> sh) & 255) * u }
    ctx.setFillColor(CGColor(srgbRed: ch(a, b, 16) / 255, green: ch(a, b, 8) / 255, blue: ch(a, b, 0) / 255, alpha: 1))
    // y grows downward here, so increasing angles run clockwise on screen; 0 = straight up, then +20°
    let a0 = (-90 + 20 + 360 * f) * .pi / 180, a1 = (-90 + 20 + 360 * (CGFloat(i + 1) / CGFloat(n)) + 0.2) * .pi / 180
    ctx.move(to: c)
    ctx.addLine(to: CGPoint(x: c.x + radius * cos(a0), y: c.y + radius * sin(a0)))
    ctx.addLine(to: CGPoint(x: c.x + radius * cos(a1), y: c.y + radius * sin(a1)))
    ctx.closePath(); ctx.fillPath()
  }
}

func png(_ size: Int, _ path: String, opaque: Bool = false, draw: (CGContext, CGFloat) -> Void) {
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: srgb, bitmapInfo: (opaque ? CGImageAlphaInfo.noneSkipLast : .premultipliedLast).rawValue)!
  // SVG coordinates: y grows downward
  ctx.translateBy(x: 0, y: CGFloat(size)); ctx.scaleBy(x: 1, y: -1)
  draw(ctx, CGFloat(size))
  let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
  print("wrote", path)
}

enum Look { case light, dark, tinted }

/// The bubble tile in `r` with corner radius `radius`. `small` is the cut for 32 px and under: no highlight,
/// a thicker rim, bigger eyes. `bleed` paints the base colour over the whole canvas first (opaque icons the
/// system masks itself).
func bubble(_ ctx: CGContext, _ r: CGRect, radius: CGFloat, look: Look = .light, small: Bool = false, bleed: CGRect? = nil) {
  let w = r.width, h = r.height
  let base = look == .light ? rgb(0xf7f7f5) : look == .dark ? rgb(0x161616) : rgb(0x000000)
  if let b = bleed { ctx.setFillColor(base); ctx.fill(b) }
  let shape = CGPath(roundedRect: r, cornerWidth: radius, cornerHeight: radius, transform: nil)
  ctx.saveGState()
  ctx.addPath(shape); ctx.clip()
  ctx.setFillColor(base); ctx.fill(r)
  // frosted glass: thin in the middle, tinted towards the edge
  if look != .tinted {
    let a: [CGFloat] = look == .dark ? [0.18, 0.34, 0.56] : [0.14, 0.30, 0.52]
    let glass = CGGradient(colorsSpace: srgb, colors: a.map { rgb(tint, $0) } as CFArray, locations: [0, 0.7, 1])!
    let c = CGPoint(x: r.minX + 0.5 * w, y: r.minY + 0.45 * h)
    ctx.drawRadialGradient(glass, startCenter: c, startRadius: 0, endCenter: c, endRadius: 0.8 * w, options: [.drawsAfterEndLocation])
  }
  // highlight, top left
  if !small && look != .tinted {
    ctx.saveGState()
    ctx.translateBy(x: r.minX + 0.26 * w, y: r.minY + 0.15 * h); ctx.scaleBy(x: 0.14 * w, y: 0.07 * h)
    let hi = CGGradient(colorsSpace: srgb, colors: [CGColor(gray: 1, alpha: 0.75), CGColor(gray: 1, alpha: 0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(hi, startCenter: .zero, startRadius: 0, endCenter: .zero, endRadius: 1, options: [])
    ctx.restoreGState()
  }
  // the rainbow rim, following the tile's own edge
  let t = (small ? 0.08 : 0.03) * w
  let ring = CGMutablePath()
  ring.addPath(shape)
  ring.addRoundedRect(in: r.insetBy(dx: t, dy: t), cornerWidth: max(radius - t, 0), cornerHeight: max(radius - t, 0))
  ctx.saveGState()
  ctx.addPath(ring); ctx.clip(using: .evenOdd)
  if look == .tinted {
    ctx.setFillColor(CGColor(gray: 1, alpha: 0.55)); ctx.fill(r)
  } else {
    conic(ctx, center: CGPoint(x: r.midX, y: r.midY), radius: w)
  }
  ctx.restoreGState()
  // two eyes, a little taller than round, glancing right
  let (l1, l2, top, ew, eh): (CGFloat, CGFloat, CGFloat, CGFloat, CGFloat) = small ? (0.30, 0.61, 0.29, 0.17, 0.335) : (0.35, 0.62, 0.34, 0.13, 0.235)
  ctx.setFillColor(look == .light ? rgb(0x141414) : rgb(0xf4f4f2))
  for l in [l1, l2] { ctx.fillEllipse(in: CGRect(x: r.minX + l * w, y: r.minY + top * h, width: ew * w, height: eh * h)) }
  ctx.restoreGState()
}

/// The one-colour mark (menu bar template): a rounded-square ring with the two eyes, on an 18-unit grid.
func glyph(_ ctx: CGContext, _ s: CGFloat) {
  let k = s / 18
  ctx.scaleBy(x: k, y: k)
  let p = CGMutablePath()
  p.addRoundedRect(in: CGRect(x: 1.5, y: 1.5, width: 15, height: 15), cornerWidth: 4.5, cornerHeight: 4.5)
  p.addRoundedRect(in: CGRect(x: 3.1, y: 3.1, width: 11.8, height: 11.8), cornerWidth: 3, cornerHeight: 3)
  p.addEllipse(in: CGRect(x: 6.7, y: 6.38, width: 2.2, height: 4.04))
  p.addEllipse(in: CGRect(x: 10.7, y: 6.38, width: 2.2, height: 4.04))
  ctx.addPath(p)
  ctx.setFillColor(CGColor(gray: 0, alpha: 1)); ctx.fillPath(using: .evenOdd)
}

let root = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().appendingPathComponent("../..").standardized.path
let repo = URL(fileURLWithPath: root).appendingPathComponent("..").standardized.path
let full = { (s: CGFloat) in CGRect(x: 0, y: 0, width: s, height: s) }
// Apple's icon mask is about 22.4% round: the rim follows it so the system's rounding doesn't cut it off
let appleRound: CGFloat = 0.2237

// macOS/Windows/Linux app icon: a rounded tile with the usual macOS margin (824 of 1024)
png(1024, "\(root)/desktop/build/icon.png") { ctx, s in bubble(ctx, CGRect(x: 100, y: 100, width: 824, height: 824), radius: 185) }
// menu bar: a black template image macOS tints for light and dark menu bars
for (size, name) in [(18, "trayTemplate.png"), (36, "trayTemplate@2x.png")] {
  png(size, "\(root)/desktop/build/\(name)") { ctx, s in glyph(ctx, s) }
}
// iOS app icon: full bleed, the system rounds it; no alpha channel, or App Store Connect rejects the upload
let ios = "\(root)/ios/Wisp/Assets.xcassets"
for (look, name) in [(Look.light, "icon-1024.png"), (.dark, "icon-1024-dark.png"), (.tinted, "icon-1024-tinted.png")] {
  png(1024, "\(ios)/AppIcon.appiconset/\(name)", opaque: true) { ctx, s in bubble(ctx, full(s), radius: s * appleRound, look: look, bleed: full(s)) }
}
// the mark inside the app (loading screen, About, Settings footer), light and dark
png(1024, "\(ios)/Mark.imageset/mark.png") { ctx, s in bubble(ctx, full(s), radius: s * 0.225) }
png(1024, "\(ios)/Mark.imageset/mark-dark.png") { ctx, s in bubble(ctx, full(s), radius: s * 0.225, look: .dark) }
// Android launcher icons (legacy, used as both icon and roundIcon): a rounded tile with a small margin
for (size, dir) in [(48, "mdpi"), (72, "hdpi"), (96, "xhdpi"), (144, "xxhdpi"), (192, "xxxhdpi")] {
  png(size, "\(root)/android/app/src/main/res/mipmap-\(dir)/ic_launcher.png") { ctx, s in
    let m = (s * 0.04).rounded()
    bubble(ctx, full(s).insetBy(dx: m, dy: m), radius: (s - 2 * m) * 0.2)
  }
}
// web app PWA icons
for size in [192, 512] {
  png(size, "\(root)/web/public/icon-\(size).png") { ctx, s in bubble(ctx, full(s), radius: s * 0.225) }
}
// site: favicon, apple-touch-icon (opaque, iOS rounds it) and the share image
png(32, "\(repo)/site/public/favicon-32.png") { ctx, s in bubble(ctx, full(s), radius: s * 0.225, small: true) }
png(180, "\(repo)/site/public/apple-touch-icon.png", opaque: true) { ctx, s in bubble(ctx, full(s), radius: s * appleRound, bleed: full(s)) }
png(512, "\(repo)/site/public/icon-512.png") { ctx, s in bubble(ctx, full(s), radius: s * 0.225) }
