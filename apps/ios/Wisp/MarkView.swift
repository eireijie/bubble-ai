import SwiftUI

/*
 * The Bubble AI mark, drawn in code so it can move (canvas "Bubble AI mark motion", approved 2026-11-25).
 * The round "Full glass" bubble: a base fill, a blue glass gradient, a thin rainbow rim, a highlight and two
 * eyes glancing right (web: AppMark in components/ui.tsx).
 *
 * Motion has layers, like the canvas: offset > rotation > squash/stretch > body. The rim's gradient turns on
 * its own during spins (the shimmer) and fast moves leave a short trail of tiny bubbles. Nothing loops at
 * rest: the frame clock only runs while a move is playing (`MarkMotion.running`).
 */

// MARK: easing

/** A CSS cubic-bezier timing function. */
struct Ease: Sendable, Equatable {
  var x1, y1, x2, y2: Double
  init(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) { self.x1 = x1; self.y1 = y1; self.x2 = x2; self.y2 = y2 }

  static let linear = Ease(0, 0, 1, 1)
  static let ease = Ease(0.25, 0.1, 0.25, 1)
  static let easeIn = Ease(0.42, 0, 1, 1)
  static let easeOut = Ease(0, 0, 0.58, 1)
  static let easeInOut = Ease(0.42, 0, 0.58, 1)

  func callAsFunction(_ x: Double) -> Double {
    if x <= 0 { return 0 }
    if x >= 1 { return 1 }
    if x1 == y1 && x2 == y2 { return x }
    // Newton first, bisection when it wanders
    var t = x
    for _ in 0..<8 {
      let err = bx(t) - x
      if abs(err) < 1e-6 { return by(t) }
      let d = dbx(t)
      if abs(d) < 1e-6 { break }
      t -= err / d
    }
    if t < 0 || t > 1 || abs(bx(t) - x) > 1e-4 {
      var lo = 0.0, hi = 1.0
      t = x
      for _ in 0..<40 {
        if bx(t) < x { lo = t } else { hi = t }
        t = (lo + hi) / 2
      }
    }
    return by(t)
  }

  private func bx(_ t: Double) -> Double { let u = 1 - t; return 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t }
  private func by(_ t: Double) -> Double { let u = 1 - t; return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t }
  private func dbx(_ t: Double) -> Double { let u = 1 - t; return 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2) }
}

// MARK: keyframes

/** One keyframe: where in the iteration (0...1), the values, and the easing to the next one (Web Animations style). */
struct MarkKey: Sendable {
  var at: Double
  var v: [Double]
  var ease: Ease = .linear
  init(_ at: Double, _ v: [Double], _ ease: Ease = .linear) { self.at = at; self.v = v; self.ease = ease }
}

/** One layer's animation: like `element.animate(keys, {duration, iterations, easing})` with fill "none". */
struct MarkTrack: Sendable {
  var start: Double
  var duration: Double
  var iterations: Double = 1
  var ease: Ease = .linear
  var keys: [MarkKey]
  /** squash from the bottom edge (hops) instead of the middle */
  var bottom = false

  var end: Double { start + duration * iterations }

  /** The values at time `t`, or nil before it starts and after it ends. */
  func sample(_ t: Double) -> [Double]? {
    let e = t - start
    guard e >= 0, e < duration * iterations, duration > 0, let first = keys.first else { return nil }
    let p = ease((e / duration).truncatingRemainder(dividingBy: 1))
    var a = first
    for b in keys.dropFirst() {
      if p <= b.at {
        let span = b.at - a.at
        let local = span > 0 ? a.ease((p - a.at) / span) : 1
        return zip(a.v, b.v).map { $0 + ($1 - $0) * local }
      }
      a = b
    }
    return a.v
  }
}

/** A tiny bubble in a trail, a burst or a pop. Offsets are from the mark's centre, in points. */
struct MarkParticle: Sendable {
  var born: Double
  var life: Double
  var x: Double
  var y: Double
  var size: Double
  /** at, opacity, dx, dy, scale */
  var keys: [[Double]]
  var ease = Ease(0.2, 0.7, 0.3, 1)
  var front = false

  /** where it is and how it looks at `t`, or nil when it isn't alive */
  func state(_ t: Double) -> (x: Double, y: Double, r: Double, opacity: Double)? {
    let e = t - born
    guard e >= 0, e < life, var a = keys.first else { return nil }
    let p = ease(e / life)
    var v = a
    for b in keys.dropFirst() {
      if p <= b[0] {
        let span = b[0] - a[0]
        let k = span > 0 ? (p - a[0]) / span : 1
        v = zip(a, b).map { $0 + ($1 - $0) * k }
        break
      }
      a = b
      v = b
    }
    return (x + v[2], y + v[3], size / 2 * v[4], v[1])
  }
}

/** How the mark sits at one moment. */
struct MarkPose: Equatable {
  var offset: CGSize = .zero
  var rotation: Double = 0
  var scaleX: Double = 1
  var scaleY: Double = 1
  /** the hop's lift inside the squash layer, as a fraction of the size */
  var lift: Double = 0
  var bottom = false
  var rim: Double = 0
  var opacity: Double = 1
  var eyesY: Double = 1
  /** the eyes' glance, as a fraction of the size */
  var look: CGSize = .zero
  /** the whole mark's scale (pull to refresh grows it) */
  var grow: Double = 1
}

// MARK: motion

/**
 * Plays the mark's moves. Own one per mark (`@State private var mark = MarkMotion(size: 72)`), show it with
 * `MarkView(motion:)`, then call `launch`, `work`/`finish`, `jolly`, `hopSpin` or `blink`. Pass `reduced` from
 * `@ReduceMotion`: with it on, moves become fades and nothing travels or spins.
 */
@MainActor @Observable
final class MarkMotion {
  enum Layer: Hashable { case move, turn, squash, rim, opacity, eyes, look, grow }

  let size: CGFloat
  /** the resting pose; pull to refresh sets it from the pull */
  var base = MarkPose()
  /** true while anything is playing: the frame clock runs only then */
  private(set) var running = false
  /** a pull-to-refresh spin is on */
  private(set) var refreshing = false

  @ObservationIgnored private var tracks: [Layer: [MarkTrack]] = [:]
  @ObservationIgnored private(set) var particles: [MarkParticle] = []
  @ObservationIgnored private var sleeper: Task<Void, Never>?
  @ObservationIgnored private var puffs: Task<Void, Never>?
  @ObservationIgnored private var landAt: Double?
  @ObservationIgnored private var busy = false
  /** the pull the mark shows now */
  @ObservationIgnored private var shownPull: Double = 0
  /** after a refresh it stays hidden until a new drag starts (`dragStarted`) */
  @ObservationIgnored private var resting = false

  init(size: CGFloat) { self.size = size }

  nonisolated static func now() -> Double { Date().timeIntervalSinceReferenceDate }

  // MARK: reading

  func pose(at t: Double) -> MarkPose {
    var p = base
    if let v = value(.move, t) { p.offset = CGSize(width: v.v[0], height: v.v[1]) }
    if let v = value(.turn, t) { p.rotation = v.v[0] }
    if let v = value(.squash, t) { p.scaleX = v.v[0]; p.scaleY = v.v[1]; p.lift = v.v[2]; p.bottom = v.bottom }
    if let v = value(.rim, t) { p.rim = v.v[0] }
    if let v = value(.opacity, t) { p.opacity = v.v[0] }
    if let v = value(.eyes, t) { p.eyesY = v.v[0] }
    if let v = value(.look, t) { p.look = CGSize(width: v.v[0], height: v.v[1]) }
    if let v = value(.grow, t) { p.grow = v.v[0]; p.opacity = v.v[1] }
    return p
  }

  /** the newest playing track on a layer wins, as with the Web Animations API */
  private func value(_ layer: Layer, _ t: Double) -> (v: [Double], bottom: Bool)? {
    guard let list = tracks[layer] else { return nil }
    for track in list.reversed() { if let v = track.sample(t) { return (v, track.bottom) } }
    return nil
  }

  /** the mark's centre offset at `t`, for trails */
  private func center(at t: Double) -> CGSize { pose(at: t).offset }

  // MARK: playing

  private func play(_ layer: Layer, _ track: MarkTrack) {
    tracks[layer, default: []].append(track)
    wake()
  }

  private func wake() {
    if !running { running = true }
    scheduleSleep()
  }

  /** stops the frame clock once the last move and the last tiny bubble are done */
  private func scheduleSleep() {
    sleeper?.cancel()
    guard let end = busyEnd() else { return }
    sleeper = Task { [weak self] in
      let wait = end - MarkMotion.now()
      if wait > 0 { try? await Task.sleep(for: .seconds(wait + 0.05)) }
      guard !Task.isCancelled, let self else { return }
      if let e = self.busyEnd(), e <= MarkMotion.now() {
        self.tracks = [:]
        self.particles = []
        if self.running { self.running = false }
      } else {
        self.scheduleSleep()
      }
    }
  }

  /** when everything playing ends; nil while something loops */
  private func busyEnd() -> Double? {
    let t = MarkMotion.now()
    particles.removeAll { $0.born + $0.life < t }
    for layer in tracks.keys { tracks[layer]?.removeAll { $0.end < t } }
    var end = t
    for list in tracks.values { for track in list { if !track.end.isFinite { return nil }; end = max(end, track.end) } }
    if puffs != nil { return nil }
    for p in particles { end = max(end, p.born + p.life) }
    return end
  }

  /** stops everything at once */
  func reset() {
    puffs?.cancel(); puffs = nil
    tracks = [:]
    particles = []
    landAt = nil
    busy = false
    refreshing = false
    sleeper?.cancel()
    if running { running = false }
  }

  private func after(_ seconds: Double, _ fn: @escaping @MainActor () -> Void) {
    Task { @MainActor in
      if seconds > 0 { try? await Task.sleep(for: .seconds(seconds)) }
      fn()
    }
  }

  // MARK: tiny bubbles

  /** a short trail of tiny bubbles behind a fast move (canvas `trail`) */
  private func trail(from start: Double, for duration: Double, every: Double) {
    let w = Double(size)
    var t = start
    while t < start + duration {
      let c = center(at: t)
      let sz: Double = 3.5 + Double.random(in: 0...5)
      let x: Double = c.width + (Double.random(in: 0...1) - 0.5) * w * 0.5
      let y: Double = c.height + (Double.random(in: 0...1) - 0.5) * w * 0.5
      let keys: [[Double]] = [[0, 0.95, 0, 0, 0.5], [1, 0, (Double.random(in: 0...1) - 0.5) * 10, -8 - Double.random(in: 0...14), 1]]
      particles.append(MarkParticle(born: t, life: 0.65 + Double.random(in: 0...0.25), x: x, y: y, size: sz, keys: keys))
      t += every
    }
    wake()
  }

  /** a few tiny bubbles popping from under the mark on landing (canvas `burst`) */
  private func burst(at t: Double, count n: Int) {
    let c = center(at: t)
    for i in 0..<n {
      let jitter: Double = (Double.random(in: 0...1) - 0.5) * 14
      let deg: Double = -165 + 150 * Double(i) / Double(n - 1) + jitter
      let a: Double = deg * .pi / 180
      let d: Double = 36 + Double.random(in: 0...24)
      let sz: Double = 4 + Double.random(in: 0...5)
      let dx: Double = cos(a) * d, dy: Double = sin(a) * d
      let keys: [[Double]] = [[0, 0, 0, 0, 0.3], [0.15, 1, dx * 0.45, dy * 0.45, 0.9], [1, 0, dx, dy - 8, 1]]
      let y: Double = c.height + Double(size) * 0.46
      particles.append(MarkParticle(born: t, life: 0.7 + Double.random(in: 0...0.2), x: c.width, y: y, size: sz, keys: keys, front: true))
    }
    wake()
  }

  // MARK: moves

  /** Eyes close and open (0.17 s). */
  func blink(at t: Double = MarkMotion.now()) {
    play(.eyes, MarkTrack(start: t, duration: 0.17, ease: .easeInOut, keys: [MarkKey(0, [1]), MarkKey(0.45, [0.1]), MarkKey(1, [1])]))
  }

  /** The eyes look to (x, y) (fractions of the size), hold, and come back. */
  func glance(_ x: Double, _ y: Double, hold: Double, at t: Double = MarkMotion.now()) {
    let dur = hold + 0.52
    play(.look, MarkTrack(start: t, duration: dur, ease: Ease(0.3, 0.7, 0.3, 1), keys: [
      MarkKey(0, [0, 0]), MarkKey(0.26 / dur, [x, y], .easeInOut), MarkKey((0.26 + hold) / dur, [x, y], .easeInOut), MarkKey(1, [0, 0]),
    ]))
  }

  /** The rim's colours turn by `deg`. */
  private func rimTurn(_ deg: Double, _ dur: Double, at t: Double, ease: Ease = Ease(0.2, 0.7, 0.2, 1)) {
    play(.rim, MarkTrack(start: t, duration: dur, ease: ease, keys: [MarkKey(0, [0]), MarkKey(1, [deg])]))
  }

  /**
   * The launch whoosh (3.2 s, once): in on a curve, a spin, a landing with a squash and a wobble, then a
   * blink and a glance back at you. Reduced motion: a 0.24 s fade.
   */
  func launch(reduced: Bool) {
    reset()
    let t = MarkMotion.now()
    if reduced {
      play(.opacity, MarkTrack(start: t, duration: 0.24, ease: .easeOut, keys: [MarkKey(0, [0]), MarkKey(1, [1])]))
      return
    }
    let k = Double(size) / 76
    let p0 = (-190 * k, 120 * k), p1 = (-70 * k, -140 * k), n = 24
    let path = (0...n).map { i -> MarkKey in
      let s = Double(i) / Double(n), u = 1 - s
      return MarkKey(s, [u * u * p0.0 + 2 * u * s * p1.0, u * u * p0.1 + 2 * u * s * p1.1])
    }
    play(.move, MarkTrack(start: t, duration: 0.9, ease: Ease(0.3, 0.6, 0.25, 1), keys: path))
    play(.turn, MarkTrack(start: t, duration: 1.0, ease: Ease(0.25, 0.7, 0.25, 1), keys: [MarkKey(0, [-430]), MarkKey(1, [0])]))
    play(.squash, MarkTrack(start: t, duration: 1.5, keys: [
      MarkKey(0, [0.4, 0.4, 0]), MarkKey(0.3, [0.86, 1.14, 0]), MarkKey(0.6, [1.16, 0.86, 0], .easeOut),
      MarkKey(0.72, [0.93, 1.07, 0], .easeInOut), MarkKey(0.84, [1.04, 0.97, 0], .easeInOut), MarkKey(0.93, [0.99, 1.01, 0]), MarkKey(1, [1, 1, 0]),
    ]))
    play(.opacity, MarkTrack(start: t, duration: 0.9, keys: [MarkKey(0, [0]), MarkKey(0.2, [1]), MarkKey(1, [1])]))
    rimTurn(540, 1.6, at: t)
    trail(from: t, for: 0.76, every: 0.034)
    landAt = t + 1.5
    blink(at: t + 1.65)
    glance(-0.15, -0.02, hold: 0.52, at: t + 2.05)
    blink(at: t + 2.85)
  }

  /**
   * Working (loading, connecting): drifts, bobs and spins with a little wind-up, over and over, with a puff of
   * tiny bubbles each turn. `finish` lets it complete its turn, hop once and stop. Reduced motion: still.
   */
  func work(reduced: Bool) {
    guard !reduced else { return }
    let t = MarkMotion.now()
    let k = Double(size) / 58
    play(.move, MarkTrack(start: t, duration: 2.8, iterations: .infinity, ease: .easeInOut, keys: [
      MarkKey(0, [0, 0]), MarkKey(0.25, [4 * k, -6 * k]), MarkKey(0.5, [0, -2 * k]), MarkKey(0.75, [-4 * k, -6 * k]), MarkKey(1, [0, 0]),
    ]))
    play(.turn, MarkTrack(start: t, duration: 1.4, iterations: .infinity, keys: [
      MarkKey(0, [0]), MarkKey(0.16, [-14], Ease(0.5, 0, 0.3, 1)), MarkKey(0.6, [374], .easeOut), MarkKey(0.74, [356], .easeInOut),
      MarkKey(0.84, [360]), MarkKey(1, [360]),
    ]))
    play(.squash, MarkTrack(start: t, duration: 1.4, iterations: .infinity, ease: .easeInOut, keys: [
      MarkKey(0, [1, 1, 0]), MarkKey(0.16, [1.08, 0.92, 0]), MarkKey(0.38, [0.94, 1.06, 0]), MarkKey(0.6, [1.05, 0.95, 0]),
      MarkKey(0.78, [1, 1, 0]), MarkKey(1, [1, 1, 0]),
    ]))
    play(.rim, MarkTrack(start: t, duration: 1.4, iterations: .infinity, keys: [MarkKey(0, [0]), MarkKey(1, [360])]))
    puffs?.cancel()
    puffs = Task { [weak self] in
      try? await Task.sleep(for: .seconds(0.3))
      while !Task.isCancelled {
        guard let self else { return }
        self.trail(from: MarkMotion.now(), for: 0.22, every: 0.07)
        try? await Task.sleep(for: .seconds(1.4))
      }
    }
  }

  /**
   * Ends the working loop (or the launch): finishes the current turn, hops once and stops, then calls `done`.
   * Right after `launch` it waits for the landing first.
   */
  func finish(reduced: Bool, then done: @escaping @MainActor () -> Void) {
    puffs?.cancel(); puffs = nil
    let t = MarkMotion.now()
    if reduced { done(); return }
    var hopAt = t
    if let turn = tracks[.turn]?.last(where: { !$0.end.isFinite }) {
      // every loop completes the iteration it is on
      for layer in [Layer.turn, .squash, .rim] {
        tracks[layer] = tracks[layer]?.map { track in
          guard !track.end.isFinite else { return track }
          var tr = track
          tr.iterations = floor((t - track.start) / track.duration) + 1
          return tr
        }
      }
      hopAt = turn.start + turn.duration * (floor((t - turn.start) / turn.duration) + 1)
      // the drift eases home instead of jumping
      if let drift = tracks[.move]?.last(where: { !$0.end.isFinite }) {
        let at = drift.sample(hopAt) ?? [0, 0]
        tracks[.move] = tracks[.move]?.map { track in
          guard !track.end.isFinite else { return track }
          var tr = track
          tr.iterations = (hopAt - track.start) / track.duration
          return tr
        }
        play(.move, MarkTrack(start: hopAt, duration: 0.3, ease: .easeOut, keys: [MarkKey(0, at), MarkKey(1, [0, 0])]))
      }
    } else if let land = landAt {
      hopAt = max(t, land)
    }
    play(.squash, MarkTrack(start: hopAt, duration: 0.62, ease: .easeInOut, keys: [
      MarkKey(0, [1, 1, 0]), MarkKey(0.2, [1.1, 0.9, 0]), MarkKey(0.5, [0.94, 1.07, -0.14]), MarkKey(0.78, [1.06, 0.95, 0]), MarkKey(1, [1, 1, 0]),
    ], bottom: true))
    blink(at: hopAt + 0.7)
    after(hopAt + 0.62 - t, done)
  }

  /** A quick spin and jiggle (0.64 s). Ignored while one is playing, and with reduced motion. */
  func jolly(reduced: Bool) {
    guard !reduced, !busy else { return }
    busy = true
    let t = MarkMotion.now()
    play(.turn, MarkTrack(start: t, duration: 0.64, keys: [
      MarkKey(0, [0]), MarkKey(0.12, [-10], Ease(0.4, 0, 0.2, 1)), MarkKey(0.66, [378], .easeOut), MarkKey(0.82, [354], .easeInOut), MarkKey(1, [360]),
    ]))
    play(.squash, MarkTrack(start: t, duration: 0.64, ease: .easeInOut, keys: [
      MarkKey(0, [1, 1, 0]), MarkKey(0.12, [1.1, 0.9, 0]), MarkKey(0.4, [0.9, 1.1, 0]), MarkKey(0.66, [1.07, 0.94, 0]), MarkKey(0.82, [0.97, 1.03, 0]), MarkKey(1, [1, 1, 0]),
    ]))
    rimTurn(270, 0.7, at: t)
    if size >= 24 { trail(from: t, for: 0.26, every: 0.05) }
    after(0.7) { [weak self] in self?.busy = false }
  }

  /** The jolly hop (1.1 s, "Great!"): crouches, jumps with a full spin, squashes on landing and pops a few tiny bubbles. */
  func hopSpin(reduced: Bool) {
    guard !reduced else { return }
    let t = MarkMotion.now(), d = 1.1, s = Double(size)
    play(.squash, MarkTrack(start: t, duration: d, keys: [
      MarkKey(0, [1, 1, 0]), MarkKey(0.18, [1.16, 0.84, 0], Ease(0.3, 0, 0.2, 1)), MarkKey(0.3, [0.86, 1.16, 0], .easeOut), MarkKey(0.5, [1, 1, 0], .easeIn),
      MarkKey(0.7, [1.2, 0.8, 0], .easeOut), MarkKey(0.82, [0.94, 1.06, 0], .easeInOut), MarkKey(0.92, [1.03, 0.98, 0]), MarkKey(1, [1, 1, 0]),
    ], bottom: true))
    play(.move, MarkTrack(start: t, duration: d, keys: [
      MarkKey(0, [0, 0]), MarkKey(0.2, [0, 0], Ease(0.2, 0.7, 0.4, 1)), MarkKey(0.46, [0, -s * 0.95], Ease(0.6, 0, 0.8, 0.4)), MarkKey(0.7, [0, 0]), MarkKey(1, [0, 0]),
    ]))
    play(.turn, MarkTrack(start: t, duration: d, keys: [MarkKey(0, [0]), MarkKey(0.24, [0], Ease(0.45, 0, 0.3, 1)), MarkKey(0.66, [360]), MarkKey(1, [360])]))
    play(.eyes, MarkTrack(start: t, duration: d, keys: [MarkKey(0, [1]), MarkKey(0.22, [1]), MarkKey(0.34, [0.55]), MarkKey(0.62, [0.55]), MarkKey(0.78, [1]), MarkKey(1, [1])]))
    rimTurn(360, d, at: t)
    trail(from: t + d * 0.24, for: d * 0.4, every: 0.04)
    burst(at: t + d * 0.7, count: 7)
    blink(at: t + d + 0.45)
  }

  // MARK: pull to refresh

  /** how far a pull grows it to full size, in points */
  static let pullFull: Double = 64

  /**
   * The pull grows it and turns it (reduced motion: it only fades in). It only grows while a finger is on the list;
   * after that it can only shrink, so the list settling back after a refresh never brings it back.
   */
  func setPull(_ v: Double, dragging: Bool, reduced: Bool) {
    guard !refreshing else { return }
    var v = max(0, v)
    if !dragging || resting { v = min(v, shownPull) }
    shownPull = v
    let k = min(1, v / Self.pullFull)
    var p = MarkPose()
    p.opacity = k
    p.grow = reduced ? 1 : k
    if !reduced { p.rotation = v * 3; p.rim = v * 4 }
    if p != base { base = p }
  }

  /** A new drag on the list: once the list is back at its top, the pull may grow the mark again. */
  func dragStarted(pull: Double) { if pull < 1 { resting = false } }

  /** Spins while the refresh runs (a still mark with reduced motion). */
  func startRefresh(reduced: Bool) {
    refreshing = true
    var p = base
    p.opacity = 1; p.grow = 1
    base = p
    guard !reduced else { return }
    let t = MarkMotion.now(), a0 = base.rotation, r0 = base.rim
    let spin = Ease(0.45, 0, 0.25, 1)
    play(.turn, MarkTrack(start: t, duration: 1.1, iterations: .infinity, ease: spin, keys: [MarkKey(0, [a0]), MarkKey(1, [a0 + 720])]))
    play(.squash, MarkTrack(start: t, duration: 1.1, iterations: .infinity, ease: .easeInOut, keys: [
      MarkKey(0, [1, 1, 0]), MarkKey(0.1, [1.12, 0.88, 0]), MarkKey(0.35, [0.92, 1.08, 0]), MarkKey(0.75, [1.04, 0.96, 0]), MarkKey(1, [1, 1, 0]),
    ]))
    play(.rim, MarkTrack(start: t, duration: 1.1, iterations: .infinity, ease: spin, keys: [MarkKey(0, [r0]), MarkKey(1, [r0 + 540])]))
    puffs?.cancel()
    puffs = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        self.trail(from: MarkMotion.now(), for: 0.7, every: 0.06)
        try? await Task.sleep(for: .seconds(1.1))
      }
    }
  }

  /** Finishes the turn it is on, then pops away. Returns once it's gone, so the list waits for it. */
  func endRefresh(reduced: Bool) async {
    puffs?.cancel(); puffs = nil
    let t = MarkMotion.now()
    var popAt = t
    if !reduced, let turn = tracks[.turn]?.last(where: { !$0.end.isFinite }) {
      let turns = floor((t - turn.start) / turn.duration) + 1
      for layer in [Layer.turn, .squash, .rim] {
        tracks[layer] = tracks[layer]?.map { track in
          guard !track.end.isFinite else { return track }
          var tr = track
          tr.iterations = turns
          return tr
        }
      }
      popAt = turn.start + turn.duration * turns
      scheduleSleep()
    }
    if reduced {
      play(.grow, MarkTrack(start: popAt, duration: 0.2, ease: .easeOut, keys: [MarkKey(0, [1, 1]), MarkKey(1, [1, 0])]))
    } else {
      play(.grow, MarkTrack(start: popAt, duration: 0.26, ease: .easeIn, keys: [MarkKey(0, [1, 1]), MarkKey(0.4, [1.18, 1]), MarkKey(1, [0, 0])]))
    }
    // hidden underneath, so nothing flashes when the pop ends
    var hidden = MarkPose()
    hidden.opacity = 0; hidden.grow = 0
    let wait = popAt - t + (reduced ? 0.2 : 0.26)
    try? await Task.sleep(for: .seconds(max(0, popAt - t)))
    base = hidden
    shownPull = 0
    resting = true
    try? await Task.sleep(for: .seconds(max(0, wait - max(0, popAt - t))))
    refreshing = false
  }
}

// MARK: drawing

/** Shows a `MarkMotion`. The frame clock runs only while it plays. */
struct MarkView: View {
  var motion: MarkMotion
  @Environment(\.colorScheme) private var scheme

  var body: some View {
    let s = motion.size
    TimelineView(.animation(minimumInterval: nil, paused: !motion.running)) { tl in
      let t = motion.running ? tl.date.timeIntervalSinceReferenceDate : .infinity
      MarkFace(size: s, dark: scheme == .dark, pose: motion.pose(at: t))
        .background { if motion.running { MarkParticles(motion: motion, t: t, front: false, dark: scheme == .dark) } }
        .overlay { if motion.running { MarkParticles(motion: motion, t: t, front: true, dark: scheme == .dark) } }
    }
    .frame(width: s, height: s)
    .accessibilityHidden(true)
  }
}

/** The round mark at one pose. Layers, outside in: offset > rotation > squash > body. */
struct MarkFace: View {
  var size: CGFloat
  var dark: Bool
  var pose = MarkPose()

  static let rim: [Gradient.Stop] = [
    .init(color: Color(hex: "#ff7cc4"), location: 0), .init(color: Color(hex: "#7fb0ff"), location: 90 / 360),
    .init(color: Color(hex: "#6fe8c0"), location: 140 / 360), .init(color: Color(hex: "#ffe27a"), location: 185 / 360),
    .init(color: Color(hex: "#ff9c80"), location: 235 / 360), .init(color: Color(hex: "#bf86ff"), location: 310 / 360),
    .init(color: Color(hex: "#ff7cc4"), location: 1),
  ]

  var body: some View {
    let s = size
    let glass = Color(hex: "#8fb4ff")
    let big = s > 32
    // the web mark: a thin rim on big marks, a bolder one when small so it still reads
    let rimWidth = s * (big ? 0.03 : 0.08)
    ZStack(alignment: .topLeading) {
      Circle().fill(Color(hex: dark ? "#161616" : "#f7f7f5"))
      Circle().fill(RadialGradient(stops: [
        .init(color: glass.opacity(dark ? 0.18 : 0.14), location: 0),
        .init(color: glass.opacity(dark ? 0.34 : 0.30), location: 0.7),
        .init(color: glass.opacity(dark ? 0.56 : 0.52), location: 1),
      ], center: UnitPoint(x: 0.5, y: 0.45), startRadius: 0, endRadius: s * 0.8))
      if big {
        Ellipse()
          .fill(RadialGradient(colors: [.white.opacity(dark ? 0.5 : 0.75), .white.opacity(0)], center: .center, startRadius: 0, endRadius: s * 0.14))
          .frame(width: s * 0.28, height: s * 0.14)
          .position(x: s * 0.31, y: s * 0.2)
      }
      Circle()
        .inset(by: rimWidth / 2)
        .stroke(AngularGradient(stops: Self.rim, center: .center, startAngle: .degrees(-90 + pose.rim), endAngle: .degrees(270 + pose.rim)), lineWidth: rimWidth)
      ZStack(alignment: .topLeading) {
        eye.position(x: s * (0.30 + 0.085), y: s * (0.29 + 0.1675))
        eye.position(x: s * (0.61 + 0.085), y: s * (0.29 + 0.1675))
      }
      .offset(x: pose.look.width * s, y: pose.look.height * s)
    }
    .frame(width: s, height: s)
    .offset(y: pose.lift * s)
    .scaleEffect(x: pose.scaleX, y: pose.scaleY, anchor: pose.bottom ? .bottom : .center)
    .rotationEffect(.degrees(pose.rotation))
    .offset(pose.offset)
    .scaleEffect(pose.grow)
    .opacity(pose.opacity)
  }

  private var eye: some View {
    Ellipse()
      .fill(Color(hex: dark ? "#f4f4f2" : "#141414"))
      .frame(width: size * 0.17, height: size * 0.335)
      .scaleEffect(x: 1, y: pose.eyesY)
  }
}

/** Trail and burst bubbles, drawn in one Canvas around the mark. */
private struct MarkParticles: View {
  var motion: MarkMotion
  var t: Double
  var front: Bool
  var dark: Bool

  var body: some View {
    let field = min(640, max(motion.size * 9, 200))
    let ring: Color = dark ? .white.opacity(0.7) : Color(red: 28 / 255, green: 28 / 255, blue: 28 / 255).opacity(0.34)
    let glow = Color(hex: "#8fb4ff").opacity(0.35)
    Canvas { ctx, size in
      let cx = size.width / 2, cy = size.height / 2
      for p in motion.particles where p.front == front {
        guard let st = p.state(t), st.r > 0.2, st.opacity > 0.01 else { continue }
        let r = CGRect(x: cx + st.x - st.r, y: cy + st.y - st.r, width: st.r * 2, height: st.r * 2)
        var c = ctx
        c.opacity = st.opacity
        c.stroke(Path(ellipseIn: r.insetBy(dx: 1.2, dy: 1.2)), with: .color(glow), lineWidth: 1.6)
        c.stroke(Path(ellipseIn: r.insetBy(dx: 0.5, dy: 0.5)), with: .color(ring), lineWidth: 1)
        c.fill(Path(ellipseIn: CGRect(x: r.minX + r.width * 0.22, y: r.minY + r.height * 0.18, width: r.width * 0.26, height: r.height * 0.26)), with: .color(.white.opacity(0.95)))
      }
    }
    .frame(width: field, height: field)
    .allowsHitTesting(false)
  }
}

#Preview("Mark") {
  @Previewable @State var mark = MarkMotion(size: 96)
  VStack(spacing: 30) {
    MarkView(motion: mark)
    HStack {
      Button("Launch") { mark.launch(reduced: false) }
      Button("Work") { mark.work(reduced: false) }
      Button("Finish") { mark.finish(reduced: false) {} }
      Button("Jolly") { mark.jolly(reduced: false) }
      Button("Hop") { mark.hopSpin(reduced: false) }
      Button("Blink") { mark.blink() }
    }
  }
}
