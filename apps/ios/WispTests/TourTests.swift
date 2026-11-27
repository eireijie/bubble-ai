import XCTest
@testable import Wisp

/** Show me around on the phone: the web's stops and words (apps/web/src/tour.ts), its progress rules, and where the card and bubble go. */
@MainActor
final class TourTests: XCTestCase {
  private let stops = Tour.stops

  // MARK: the same tour as the web

  /** One web stop, read from tour.ts. */
  private struct WebStop { var id: String; var title: String; var body: String; var noGuests: Bool; var doIt: String? }

  private func webStops() throws -> [WebStop] {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("web/src/tour.ts")
    let src = try String(contentsOf: url, encoding: .utf8)
    func field(_ line: String, _ name: String) -> String? {
      guard let r = line.range(of: "\(name): \"((?:[^\"\\\\]|\\\\.)*)\"", options: .regularExpression) else { return nil }
      let m = String(line[r])
      return String(m.dropFirst(name.count + 3).dropLast())
    }
    return src.split(separator: "\n").map(String.init).filter { $0.contains("{ id: \"") }.map { line in
      WebStop(id: field(line, "id")!, title: field(line, "title")!, body: field(line, "body")!, noGuests: line.contains("noGuests: true"), doIt: field(line, "doIt"))
    }
  }

  func testSameStopsAndWordsAsTheWeb() throws {
    let web = try webStops()
    // the web's four hands-on stops land with eireijie/bubble-ai#133; until then its file has the old 25
    try XCTSkipIf(web.count != 4, "web tour.ts is still the old tour")
    XCTAssertEqual(stops.map(\.id), web.map(\.id))
    for (s, w) in zip(stops, web) {
      XCTAssertEqual(s.title, w.title, s.id)
      XCTAssertEqual(s.body, w.body, s.id)
      XCTAssertEqual(s.noGuests, w.noGuests, s.id)
      // the web's "click" is a tap here
      XCTAssertEqual(s.doIt == .tap ? "click" : s.doIt.rawValue, w.doIt, s.id)
    }
  }

  func testFourHandsOnStops() {
    XCTAssertEqual(stops.map(\.id), ["write", "slash", "your-turn", "new"])
    XCTAssertEqual(stops.map(\.doIt), [.send, .slash, .tap, .tap])
    XCTAssertEqual(Tour.chapters.count, 1)
    XCTAssertEqual(Tour.chapterProgress(nil).map(\.total), [4])
  }

  func testEveryStopPointsAtSomething() {
    for s in stops { XCTAssertFalse(s.targets.isEmpty, s.id) }
  }

  func testTitleNamesTheAgent() {
    XCTAssertEqual(Tour.title(stops[0], agent: "Juno"), "Say hi to Juno")
    XCTAssertEqual(Tour.title(stops[0], agent: nil), "Say hi to your agent")
    XCTAssertEqual(Tour.title(stops[1], agent: "Juno"), "Type /")
  }

  // MARK: phone words

  func testPhoneWordsAreForTouch() {
    XCTAssertEqual(Tour.body(stops[0], fallback: false), "Type anything and send it.")
    for s in stops {
      let text = Tour.body(s, fallback: false) + Tour.body(s, fallback: true)
      XCTAssertFalse(text.contains("Right-click"), s.id)
      XCTAssertFalse(text.contains("Click"), s.id)
      XCTAssertFalse(text.contains("Return"), s.id)
    }
  }

  // MARK: guests

  func testGuestsSkipWhatTheyCantOpen() {
    let g = Tour.stops(guest: true)
    XCTAssertEqual(g.map(\.id), ["write", "slash", "your-turn"])
    XCTAssertEqual(Tour.stops(guest: false).count, 4)
  }

  // MARK: progress (UserPrefs.learn)

  func testProgressCountsAndResume() {
    let p = LearnProgress(seen: ["write", "slash", "gone", "write"], started: true)
    XCTAssertEqual(Tour.seenCount(p), 2)
    XCTAssertEqual(Tour.resumeIndex(p), 2)
    XCTAssertEqual(Tour.resumeIndex(LearnProgress(seen: stops.map(\.id))), 0)
    XCTAssertEqual(Tour.resumeLabel(nil), "Show me around")
    XCTAssertEqual(Tour.resumeLabel(p), "Resume")
    XCTAssertEqual(Tour.resumeLabel(LearnProgress(seen: stops.map(\.id))), "Start again")
  }

  func testSummaryLine() {
    let p = LearnProgress(seen: ["write", "slash"], started: true)
    XCTAssertEqual(Tour.summary(p), "2 of 4 seen · next: Blue dot = your turn")
    XCTAssertEqual(Tour.summary(LearnProgress(seen: stops.map(\.id))), "All 4 seen")
  }

  func testCounter() {
    XCTAssertEqual(Tour.counter(0), "1 of 4")
    XCTAssertEqual(Tour.counter(3), "4 of 4")
  }

  func testChapterProgress() {
    let c = Tour.chapterProgress(LearnProgress(seen: ["write", "your-turn"]))
    XCTAssertEqual(c.map(\.seen), [2])
    XCTAssertEqual(c.map(\.first), [0])
  }

  func testWithSeenAddsOnceAndMarksStarted() {
    XCTAssertEqual(Tour.withSeen(nil, "write"), LearnProgress(seen: ["write"], started: true))
    let p = LearnProgress(seen: ["write"], started: true)
    XCTAssertNil(Tour.withSeen(p, "write"))
    XCTAssertEqual(Tour.withSeen(LearnProgress(seen: ["write"]), "write"), LearnProgress(seen: ["write"], started: true))
    XCTAssertEqual(Tour.withSeen(p, "slash")?.seen, ["write", "slash"])
  }

  func testMergeKeepsWhatEitherDeviceSaw() {
    let desk = LearnProgress(seen: ["write", "new"], started: true)
    let phone = LearnProgress(seen: ["write", "slash"])
    XCTAssertEqual(Tour.merged(desk, phone), LearnProgress(seen: ["write", "new", "slash"], started: true))
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
