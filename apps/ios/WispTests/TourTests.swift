import XCTest
@testable import Wisp

/** Show me around on the phone: the web's stops and words (apps/web/src/tour.ts), its progress rules, and where the card and bubble go. */
@MainActor
final class TourTests: XCTestCase {
  private let stops = Tour.stops

  // MARK: the same tour as the web

  /** One web stop, read from tour.ts. */
  private struct WebStop { var id: String; var ch: Int; var title: String; var body: String; var fallbackBody: String?; var noGuests: Bool; var mod: String?; var tryIt: String? }

  private func webStops() throws -> [WebStop] {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("web/src/tour.ts")
    let src = try String(contentsOf: url, encoding: .utf8)
    func field(_ line: String, _ name: String) -> String? {
      guard let r = line.range(of: "\(name): \"((?:[^\"\\\\]|\\\\.)*)\"", options: .regularExpression) else { return nil }
      let m = String(line[r])
      return String(m.dropFirst(name.count + 3).dropLast())
    }
    return src.split(separator: "\n").map(String.init).filter { $0.contains("{ id: \"") }.map { line in
      let ch = line.range(of: "ch: [0-9]", options: .regularExpression).map { Int(line[$0].suffix(1))! } ?? -1
      return WebStop(id: field(line, "id")!, ch: ch, title: field(line, "title")!, body: field(line, "body")!, fallbackBody: field(line, "fallbackBody"), noGuests: line.contains("noGuests: true"), mod: field(line, "mod"), tryIt: field(line, "tryIt"))
    }
  }

  /**
   * Phone words that run ahead of a web change still in review, keyed by stop, holding the web's
   * current words: either is accepted so the two PRs merge in any order. Remove an entry once the
   * web change is on main. skills: "saves it as a skill" (teach saves a skill, eireijie/bubble-ai#118).
   */
  static let webCatchingUp: [String: String] = [
    "skills": "Jobs agents know how to do. Add them here, or do a task once on a computer and the agent learns it.",
  ]

  func testSameStopsAndWordsAsTheWeb() throws {
    let web = try webStops()
    XCTAssertEqual(web.count, 25)
    XCTAssertEqual(stops.map(\.id), web.map(\.id))
    for (s, w) in zip(stops, web) {
      XCTAssertEqual(s.ch, w.ch, s.id)
      XCTAssertEqual(s.title, w.title, s.id)
      XCTAssertTrue(s.body == w.body || Self.webCatchingUp[s.id] == w.body, "\(s.id): \(s.body) ≠ \(w.body)")
      XCTAssertEqual(s.fallbackBody, w.fallbackBody, s.id)
      XCTAssertEqual(s.noGuests, w.noGuests, s.id)
      XCTAssertEqual(s.mod?.rawValue, w.mod, s.id)
      XCTAssertEqual(s.tryIt?.rawValue, w.tryIt, s.id)
    }
  }

  func testFiveChaptersInOrder() {
    XCTAssertEqual(Tour.chapters, ["Talk", "Hands-off", "Tools", "Memory and teams", "Make it yours"])
    XCTAssertEqual(stops.map(\.ch), stops.map(\.ch).sorted())
    XCTAssertEqual(Tour.chapterProgress(nil).map(\.total), [5, 4, 5, 5, 6])
  }

  func testEveryStopPointsAtSomething() {
    for s in stops { XCTAssertFalse(s.targets.isEmpty, s.id) }
  }

  // MARK: phone words

  func testPhoneWordsAreForTouch() {
    let write = stops.first { $0.id == "write" }!
    XCTAssertEqual(Tour.body(write, fallback: false), "Tell any agent what to do, in plain words. Press and hold a message to reply in a thread or edit it.")
    let pins = stops.first { $0.id == "pins" }!
    XCTAssertEqual(Tour.body(pins, fallback: true), "Press and hold any row to pin it. Up to 9 agents and teams sit up here.")
    let page = stops.first { $0.id == "agent-page" }!
    XCTAssertTrue(Tour.body(page, fallback: false).hasPrefix("Tap an agent's name"))
    for s in stops {
      let text = Tour.body(s, fallback: false) + Tour.body(s, fallback: true)
      XCTAssertFalse(text.contains("Right-click"), s.id)
      XCTAssertFalse(text.contains("Click"), s.id)
      XCTAssertFalse(text.contains("Scan this"), s.id)
      XCTAssertFalse(text.contains("Drag"), s.id)
    }
  }

  func testComputersDropsTheDesktopDot() {
    let c = stops.first { $0.id == "computers" }!
    XCTAssertEqual(Tour.body(c, fallback: false), "Agents work on their own computer, so yours stays free.")
  }

  func testTryItLabels() {
    XCTAssertEqual(Tour.tryLabel(.slash), "Try it: type /")
    XCTAssertEqual(Tour.tryLabel(.at), "Try it: type @")
    XCTAssertEqual(Tour.tryLabel(.yourturn), "Try it: tap Your turn")
  }

  // MARK: guests

  func testGuestsSkipWhatTheyCantOpen() {
    let g = Tour.stops(guest: true)
    XCTAssertEqual(g.count, 14)
    XCTAssertFalse(g.contains { $0.noGuests })
    XCTAssertEqual(Tour.stops(guest: false).count, 25)
  }

  // MARK: progress (UserPrefs.learn)

  func testProgressCountsAndResume() {
    let p = LearnProgress(seen: ["write", "attach", "gone", "write"], started: true)
    XCTAssertEqual(Tour.seenCount(p), 2)
    XCTAssertEqual(Tour.resumeIndex(p), 2)
    XCTAssertEqual(Tour.resumeIndex(LearnProgress(seen: stops.map(\.id))), 0)
    XCTAssertEqual(Tour.resumeLabel(nil), "Show me around")
    XCTAssertEqual(Tour.resumeLabel(p), "Resume")
    XCTAssertEqual(Tour.resumeLabel(LearnProgress(seen: stops.map(\.id))), "Start again")
  }

  func testSummaryLine() {
    let p = LearnProgress(seen: Array(stops.prefix(7).map(\.id)), started: true)
    XCTAssertEqual(Tour.summary(p), "7 of 25 seen · next: Approvals")
    XCTAssertEqual(Tour.summary(LearnProgress(seen: stops.map(\.id))), "All 25 seen")
  }

  func testEyebrow() {
    XCTAssertEqual(Tour.eyebrow(5), "Chapter 2 · Hands-off")
    XCTAssertEqual(Tour.eyebrow(2), "Chapter 1 · Talk")
  }

  func testChapterProgress() {
    let p = LearnProgress(seen: ["write", "attach", "slash", "mention", "call", "your-turn"])
    let c = Tour.chapterProgress(p)
    XCTAssertEqual(c.map(\.seen), [5, 1, 0, 0, 0])
    XCTAssertEqual(c.map(\.first), [0, 5, 9, 14, 19])
  }

  func testWithSeenAddsOnceAndMarksStarted() {
    XCTAssertEqual(Tour.withSeen(nil, "write"), LearnProgress(seen: ["write"], started: true))
    let p = LearnProgress(seen: ["write"], started: true)
    XCTAssertNil(Tour.withSeen(p, "write"))
    XCTAssertEqual(Tour.withSeen(LearnProgress(seen: ["write"]), "write"), LearnProgress(seen: ["write"], started: true))
    XCTAssertEqual(Tour.withSeen(p, "attach")?.seen, ["write", "attach"])
  }

  func testMergeKeepsWhatEitherDeviceSaw() {
    let desk = LearnProgress(seen: ["write", "approvals"], started: true)
    let phone = LearnProgress(seen: ["write", "attach"])
    XCTAssertEqual(Tour.merged(desk, phone), LearnProgress(seen: ["write", "approvals", "attach"], started: true))
    XCTAssertNil(Tour.merged(nil, nil))
  }

  func testProgressDecodesFromTheHub() throws {
    let json = #"{"experience":"simple","learn":{"seen":["write","attach"],"started":true}}"#
    let prefs = try JSONDecoder().decode(Me.Prefs.self, from: Data(json.utf8))
    XCTAssertEqual(prefs.learn, LearnProgress(seen: ["write", "attach"], started: true))
    let sent = try JSONSerialization.jsonObject(with: JSONEncoder().encode(LearnProgress(seen: ["write"], started: true))) as? NSDictionary
    XCTAssertEqual(sent, ["seen": ["write"], "started": true] as NSDictionary)
  }

  // MARK: where things go

  func testCardDocksAwayFromTheControl() {
    let h: CGFloat = 844
    XCTAssertEqual(Tour.dock(target: CGRect(x: 0, y: 100, width: 100, height: 40), height: h), .bottom)
    XCTAssertEqual(Tour.dock(target: CGRect(x: 0, y: 760, width: 390, height: 52), height: h), .top)
  }

  func testBubbleSitsOnScreenBesideItsControl() {
    let screen = CGSize(width: 390, height: 844)
    let composer = CGRect(x: 6, y: 752, width: 378, height: 52)
    let p = Tour.bubbleSpot(target: composer, dock: .top, size: 46, screen: screen)
    XCTAssertLessThan(p.y, composer.minY + 1)
    XCTAssertTrue((31...(390 - 31)).contains(p.x))
    let chip = CGRect(x: 66, y: 101, width: 116, height: 42)
    let q = Tour.bubbleSpot(target: chip, dock: .bottom, size: 46, screen: screen)
    XCTAssertGreaterThan(q.y, chip.maxY - 1)
  }

  func testFlightCurveAndTiming() {
    let a = CGPoint(x: 0, y: 0), b = CGPoint(x: 300, y: 400)
    let c = Tour.curveControl(a, b)
    XCTAssertEqual(Tour.curvePoint(a, c, b, 0), a)
    XCTAssertEqual(Tour.curvePoint(a, c, b, 1), b)
    XCTAssertEqual(Tour.flightSeconds(a, a), 0.6)
    XCTAssertEqual(Tour.flightSeconds(a, CGPoint(x: 0, y: 5000)), 1.25)
    XCTAssertEqual(Tour.easeInOut(0), 0)
    XCTAssertEqual(Tour.easeInOut(1), 1)
  }

  // MARK: after the first run

  func testGreatOnlyWhenSomethingIsConnected() {
    XCTAssertEqual(SetupTour.opening(connected: []), ["No apps yet. That's fine, add them anytime."])
    XCTAssertEqual(SetupTour.opening(connected: ["Gmail"]), ["Great! I can see all that you've done.", "Gmail is connected."])
    XCTAssertEqual(SetupTour.opening(connected: ["Gmail", "Calendar", "Notion"]).last, "Gmail, Calendar and Notion are connected.")
  }

  func testAutoStartOnlyInAdvanced() {
    XCTAssertTrue(SetupTour.advanced(nil))
    XCTAssertTrue(SetupTour.advanced(Me.Prefs(experience: "advanced")))
    XCTAssertFalse(SetupTour.advanced(Me.Prefs(experience: "simple")))
  }

  func testSetupStateIsKeptThreeDays() {
    let name = "tour-tests-\(UUID().uuidString)"
    let d = UserDefaults(suiteName: name)!
    defer { d.removePersistentDomain(forName: name) }
    SetupTour.save(SetupTour.State(channelId: "c1", at: Date(timeIntervalSinceNow: -3600), stage: "ask"), d)
    XCTAssertEqual(SetupTour.load(d)?.channelId, "c1")
    XCTAssertNil(SetupTour.load(d, now: Date(timeIntervalSinceNow: 4 * 86_400)))
  }
}
