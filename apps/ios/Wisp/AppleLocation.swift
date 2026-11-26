import CoreLocation
import OSLog
import UIKit

/**
 * Location for the Apple mod. Bubble AI never tracks where you go: it gets one fix when an agent asks
 * (a silent push from the hub) or when you open the app, and, when places are on, iOS tells it
 * when you cross a place's edge. Nothing in between is ever sent.
 */
@MainActor @Observable
final class AppleLocation {
  static let shared = AppleLocation()

  /** what iOS lets Bubble AI do with location */
  private(set) var authorization: CLAuthorizationStatus

  @ObservationIgnored weak var store: Store?
  @ObservationIgnored private let manager = CLLocationManager()
  @ObservationIgnored private let delegate = Delegate()
  @ObservationIgnored private var waiting: [CheckedContinuation<CLLocation?, Never>] = []
  @ObservationIgnored private var batch = 0
  @ObservationIgnored private var monitor: CLMonitor?
  @ObservationIgnored private var events: Task<Void, Never>?
  @ObservationIgnored private var needsActiveReport = false
  @ObservationIgnored private var lastActiveReport: Date?
  @ObservationIgnored private var registeredForPush = false
  @ObservationIgnored private let log = Logger(subsystem: "ai.bubbleai.ios", category: "apple-location")

  static let pushTokenKey = "wisp.apple.pushToken"
  private static let levelKey = "wisp.apple.level"
  private static let placesKey = "wisp.apple.places"
  private static let insideKey = "wisp.apple.inside"

  private init() {
    authorization = manager.authorizationStatus
    manager.delegate = delegate
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    delegate.owner = self
  }

  // MARK: what the hub last said, kept so a relaunch in the background still knows

  /** 0 off · 1 when asked · 2 asked and places */
  private var level: Int {
    get { WispPreferences.standard.integer(forKey: Self.levelKey) }
    set { WispPreferences.standard.set(newValue, forKey: Self.levelKey) }
  }

  private var places: [ApplePlace] {
    get { WispPreferences.standard.data(forKey: Self.placesKey).flatMap { try? JSONDecoder().decode([ApplePlace].self, from: $0) } ?? [] }
    set { WispPreferences.standard.set(try? JSONEncoder().encode(newValue), forKey: Self.placesKey) }
  }

  /** whether you were last inside each watched place (by monitor identifier) */
  private var inside: [String: Bool] {
    get { WispPreferences.standard.dictionary(forKey: Self.insideKey) as? [String: Bool] ?? [:] }
    set { WispPreferences.standard.set(newValue, forKey: Self.insideKey) }
  }

  /** the last fix iOS has, to search near (never sent anywhere) */
  var lastKnown: CLLocationCoordinate2D? { manager.location?.coordinate }

  var allowed: Bool { authorization == .authorizedAlways || authorization == .authorizedWhenInUse }

  /** The phone as the hub knows it: its push token (how the hub reaches it), else this install's id. */
  var device: (id: String, name: String) {
    let id = store?.pushToken ?? WispPreferences.standard.string(forKey: Self.pushTokenKey) ?? UIDevice.current.identifierForVendor?.uuidString ?? "iphone"
    return (id, UIDevice.current.name)
  }

  // MARK: starting

  /** At launch, before anything loads: a relaunch for a place event must find its monitor again. */
  func launch(store: Store) {
    self.store = store
    Task { await updateMonitoring() }
  }

  /** The hub's settings changed (or the mod went off: nil). */
  func sync(_ info: AppleInfo?) {
    let settings = info?.settings
    level = settings?.levels.location ?? 0
    places = settings?.places ?? []
    if level >= 1, !registeredForPush {
      // silent pushes ("where am I?") need a push token, even if alerts are off
      registeredForPush = true
      UIApplication.shared.registerForRemoteNotifications()
    }
    Task { await updateMonitoring() }
    reportActiveIfNeeded()
  }

  func appBecameActive() {
    needsActiveReport = true
    reportActiveIfNeeded()
  }

  private func reportActiveIfNeeded() {
    guard needsActiveReport, level >= 1, allowed, store?.apple != nil else { return }
    needsActiveReport = false
    if let last = lastActiveReport, Date().timeIntervalSince(last) < 300 { return }
    lastActiveReport = Date()
    Task { _ = await report(requestId: nil) }
  }

  // MARK: asking iOS

  func askWhenInUse() { manager.requestWhenInUseAuthorization() }

  /** iOS shows this once, and only after While Using was allowed; after that it's in Settings. */
  func askAlways() {
    if authorization == .notDetermined { manager.requestWhenInUseAuthorization(); return }
    manager.requestAlwaysAuthorization()
  }

  fileprivate func authorizationChanged() {
    authorization = manager.authorizationStatus
    Task { await updateMonitoring() }
    reportActiveIfNeeded()
  }

  // MARK: one fix

  /** Answer an agent's "where am I" (from a silent push), or say where you are as the app opens. */
  func report(requestId: String?) async -> Bool {
    guard level >= 1, allowed, let store else { return false }
    return await withBackgroundTime {
      guard let fix = await self.oneFix() else { return false }
      do {
        try await store.reportAppleLocation(latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude, accuracy: fix.horizontalAccuracy, at: fix.timestamp, requestId: requestId, device: self.device)
        return true
      } catch {
        self.log.error("[Bubble AI] couldn't send location: \(error.localizedDescription)")
        return false
      }
    }
  }

  /** Where you are now, for "Use where I am now": asks for While Using first if it was never asked. */
  func currentFix() async -> CLLocation? {
    if authorization == .notDetermined {
      askWhenInUse()
      for _ in 0..<240 where authorization == .notDetermined { try? await Task.sleep(for: .milliseconds(250)) }
    }
    guard allowed else { return nil }
    return await oneFix()
  }

  private func oneFix(timeout: Duration = .seconds(10)) async -> CLLocation? {
    if let last = manager.location, Date().timeIntervalSince(last.timestamp) < 60, last.horizontalAccuracy <= 200 { return last }
    return await withCheckedContinuation { c in
      waiting.append(c)
      guard waiting.count == 1 else { return }
      batch += 1
      let mine = batch
      if UIApplication.shared.applicationState != .active && authorization == .authorizedAlways { manager.allowsBackgroundLocationUpdates = true }
      manager.requestLocation()
      Task {
        try? await Task.sleep(for: timeout)
        if self.batch == mine { self.finish(nil) }
      }
    }
  }

  fileprivate func finish(_ location: CLLocation?) {
    guard !waiting.isEmpty else { return }
    let all = waiting
    waiting = []
    batch += 1
    manager.allowsBackgroundLocationUpdates = false
    for c in all { c.resume(returning: location) }
  }

  // MARK: places

  private func key(_ p: ApplePlace) -> String { "\(p.id)|\(p.latitude)|\(p.longitude)|\(p.radius)" }

  /** Watch each place that has arrive or leave on, as a circle; drop the rest. */
  private func updateMonitoring() async {
    let want = level == 2 && authorization == .authorizedAlways ? places.filter { $0.arrive || $0.leave } : []
    if want.isEmpty && monitor == nil {
      if !inside.isEmpty { inside = [:] }
      return
    }
    let m = await ensureMonitor()
    let keys = Dictionary(want.map { (key($0), $0) }, uniquingKeysWith: { a, _ in a })
    var states = inside
    for id in await m.identifiers where keys[id] == nil {
      await m.remove(id)
      states[id] = nil
    }
    let existing = Set(await m.identifiers)
    for (id, p) in keys where !existing.contains(id) {
      let center = CLLocationCoordinate2D(latitude: p.latitude, longitude: p.longitude)
      await m.add(CLMonitor.CircularGeographicCondition(center: center, radius: p.radius), identifier: id)
    }
    inside = states
  }

  private func ensureMonitor() async -> CLMonitor {
    if let monitor { return monitor }
    let m = await CLMonitor("wisp-places")
    monitor = m
    events = Task {
      do {
        for try await event in await m.events { self.crossed(event.identifier, state: event.state, at: event.date) }
      } catch {
        self.log.error("[Bubble AI] place events stopped: \(error.localizedDescription)")
      }
    }
    return m
  }

  /** A place's edge was crossed. The first state after watching starts is only remembered, never sent. */
  private func crossed(_ id: String, state: CLMonitor.Event.State, at: Date) {
    let now: Bool
    switch state {
    case .satisfied: now = true
    case .unsatisfied: now = false
    default: return
    }
    var states = inside
    let before = states[id]
    states[id] = now
    inside = states
    guard let before, before != now, level == 2 else { return }
    let placeId = String(id.split(separator: "|").first ?? "")
    guard let place = places.first(where: { $0.id == placeId }), now ? place.arrive : place.leave, let store else { return }
    let deviceId = device.id
    Task {
      await withBackgroundTime {
        do { try await store.reportApplePlace(placeId, kind: now ? "arrive" : "leave", at: at, deviceId: deviceId) }
        catch { self.log.error("[Bubble AI] couldn't send a place event: \(error.localizedDescription)") }
      }
    }
  }

  /** Keeps the app running long enough to finish sending after iOS woke it in the background. */
  private func withBackgroundTime<T>(_ work: () async -> T) async -> T {
    let id = UIApplication.shared.beginBackgroundTask(withName: "wisp-location")
    defer { if id != .invalid { UIApplication.shared.endBackgroundTask(id) } }
    return await work()
  }
}

/** CoreLocation's callbacks, handed to AppleLocation on the main actor (the manager was made there). */
private final class Delegate: NSObject, CLLocationManagerDelegate {
  nonisolated(unsafe) weak var owner: AppleLocation?

  nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let owner = self.owner
    MainActor.assumeIsolated { owner?.authorizationChanged() }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    let best = locations.last, owner = self.owner
    MainActor.assumeIsolated { owner?.finish(best) }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    let owner = self.owner
    MainActor.assumeIsolated { owner?.finish(nil) }
  }
}
