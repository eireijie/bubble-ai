import XCTest

/**
 * Walks the agent screens against `hub.py --agents`: the profile and every page under it, Edit, Look,
 * New agent and Bring an agent in. Set BUBBLE_HUB, BUBBLE_TOKEN, and BUBBLE_SHOTS for screenshots.
 */
@MainActor
final class AgentScreensTests: XCTestCase {
  private let app = XCUIApplication()

  func testAgentScreens() throws {
    let environment = ProcessInfo.processInfo.environment
    guard let hub = envVar("HUB", in: environment), hub.hasPrefix("http"),
          let token = envVar("TOKEN", in: environment), !token.isEmpty else {
      throw XCTSkip("Set BUBBLE_HUB and BUBBLE_TOKEN, pointing at WispUITests/Fixtures/hub.py --agents.")
    }
    continueAfterFailure = false
    app.launchEnvironment["BUBBLE_HUB"] = hub
    app.launchEnvironment["BUBBLE_TOKEN"] = token
    app.launch()
    XCTAssertTrue(app.buttons["tab-more"].waitForExistence(timeout: 30))
    app.buttons["tab-more"].tap(); app.buttons["more-agents"].tap(); settle()
    shot("agents-list")
    app.descendants(matching: .any).matching(identifier: "agent-tile").firstMatch.tap()
    XCTAssertTrue(app.buttons["agent-library"].waitForExistence(timeout: 10))
    settle(); shot("profile")

    for (id, name) in [("agent-library", "library"), ("agent-computer", "computer"), ("agent-routines", "routines"), ("agent-memory", "memory"), ("agent-apps", "apps")] {
      open(id); shot(name)
      if id == "agent-model", app.buttons["model-more"].exists { app.buttons["model-more"].tap(); settle(); shot("model-more"); back() }
      if id == "agent-computer", app.buttons["computer-none"].exists {
        app.buttons["computer-none"].tap(); settle(); shot("headless")
        app.buttons["Cancel"].firstMatch.tap(); settle()
      }
      if id == "agent-routines" {
        if app.buttons["routine-new"].exists { app.buttons["routine-new"].tap(); settle(); shot("routine-new"); app.buttons["agent-close"].firstMatch.tap(); settle() }
      }
      back()
    }
    // the rest is under the profile's ⋯ (round 11)
    for (id, name) in [("agent-who", "who"), ("agent-background", "background"), ("agent-permissions", "permissions"), ("agent-connect", "connect"), ("agent-activity", "activity")] {
      scrollTo("agent-more", up: true)
      app.buttons["agent-more"].tap(); settle()
      guard app.buttons[id].waitForExistence(timeout: 3) else { app.tap(); continue }
      open(id); shot(name)
      if id == "agent-activity", let run = app.descendants(matching: .any).matching(identifier: "activity-run").firstMatch as XCUIElement?, run.exists {
        run.tap(); settle(); shot("run"); back()
      }
      back()
    }
    // edit sheet, look, remove
    scrollTo("agent-edit", up: true)
    if app.buttons["agent-edit"].exists {
      app.buttons["agent-edit"].tap(); settle(); shot("edit")
      if app.buttons["edit-personality"].exists { app.buttons["edit-personality"].tap(); settle(); shot("personality")
        if app.buttons["personality-history"].exists { app.buttons["personality-history"].tap(); settle(); shot("personality-history"); back() }
        back() }
      if app.buttons["edit-instructions"].exists { app.buttons["edit-instructions"].tap(); settle(); shot("instructions"); back() }
      if app.buttons["edit-voice"].exists { app.buttons["edit-voice"].tap(); settle(); shot("voice"); app.buttons["agent-close"].firstMatch.tap(); settle() }
      if app.buttons["edit-look"].exists { app.buttons["edit-look"].tap(); settle(); shot("look"); app.buttons["agent-close"].firstMatch.tap(); settle() }
      app.buttons["agent-close"].firstMatch.tap(); settle()
    }
    app.buttons["agent-more"].tap(); settle()
    if app.buttons["agent-remove"].waitForExistence(timeout: 3) { app.buttons["agent-remove"].tap(); settle(); shot("remove"); app.buttons["Cancel"].firstMatch.tap(); settle() }
    back()

    // new agent
    app.buttons["agents-add"].tap(); settle(); shot("create")
    app.buttons["new-full"].firstMatch.tap(); settle(); shot("create-custom")
    if app.buttons["new-more"].exists { app.buttons["new-more"].tap(); settle(); shot("create-more"); back() }
    app.swipeUp(); settle()
    if app.buttons["new-bring"].exists {
      app.buttons["new-bring"].tap(); settle(); shot("bring")
      app.buttons["bring-find"].tap(); settle(); shot("import"); back()
      app.buttons["bring-invite"].tap(); settle(); shot("invite")
    }
  }

  private func scrollTo(_ id: String, up: Bool = false) {
    var tries = 0
    let limit = app.windows.firstMatch.frame.height * 0.8
    func visible() -> Bool { let b = app.buttons[id].firstMatch; return b.exists && b.frame.minY > 120 && b.frame.maxY < limit }
    while !visible() && tries < 6 { if up { app.swipeDown() } else { app.swipeUp() }; tries += 1 }
  }

  private func open(_ id: String) {
    scrollTo(id)
    let button = app.buttons[id].firstMatch
    XCTAssertTrue(button.waitForExistence(timeout: 8), id)
    button.tap(); settle()
  }

  private func back() {
    let b = app.buttons["agent-back"].firstMatch
    if b.waitForExistence(timeout: 4) { b.tap() }
    settle()
  }

  private func settle() { Thread.sleep(forTimeInterval: 1.2) }

  private func shot(_ name: String) {
    let screenshot = app.screenshot()
    let image = XCTAttachment(screenshot: screenshot)
    image.name = name; image.lifetime = .keepAlways; add(image)
    if let folder = ProcessInfo.processInfo.environment["BUBBLE_SHOTS"], !folder.isEmpty {
      try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name).png"))
    }
  }
}
