import XCTest

/**
 * The foundation: four tabs, the avatar's settings sheet, the + menu, search and a chat's top bar,
 * against WispUITests/Fixtures/hub.py. Set BUBBLE_SHOTS to a folder to also save screenshots there.
 */
@MainActor
final class NavigationTests: XCTestCase {
  private let app = XCUIApplication()

  func testFourTabsSettingsAndChat() throws {
    let environment = ProcessInfo.processInfo.environment
    guard let hub = envVar("HUB", in: environment), hub.hasPrefix("http"),
          let token = envVar("TOKEN", in: environment), !token.isEmpty, !token.hasPrefix("$(") else {
      throw XCTSkip("Set BUBBLE_HUB and BUBBLE_TOKEN, pointing at WispUITests/Fixtures/hub.py.")
    }
    continueAfterFailure = false
    app.launchEnvironment["BUBBLE_HUB"] = hub
    app.launchEnvironment["BUBBLE_TOKEN"] = token
    app.launch()

    XCTAssertTrue(app.buttons["tab-chats"].waitForExistence(timeout: 30))
    for id in ["tab-chats", "tab-computers", "tab-memory", "tab-marketplace", "tab-more", "home-initials"] { XCTAssertTrue(app.buttons[id].exists, id) }
    XCTAssertFalse(app.buttons["tab-profile"].exists, "Profile is a sheet from your initials")
    XCTAssertFalse(app.buttons["tab-you"].exists, "The You tab is gone")
    settle(); shot("home")

    // + menu
    app.buttons["new-menu"].tap()
    XCTAssertTrue(app.buttons["New chat"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["New team"].exists)
    XCTAssertTrue(app.buttons["New agent"].exists || app.buttons["Browse teams"].exists)
    settle(); shot("new-menu")
    app.buttons["New chat"].tap()
    settle(); shot("new-chat")
    app.buttons["Close"].firstMatch.tap()

    // Agents and Inbox
    app.buttons["tab-more"].tap(); app.buttons["more-agents"].tap(); settle(); shot("agents")
    XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "agent-tile").firstMatch.exists)
    app.buttons["tab-more"].tap(); app.buttons["more-inbox"].tap(); settle(); shot("inbox")
    app.buttons["tab-computers"].tap(); settle()
    app.buttons["tab-chats"].tap(); settle()

    // settings sheet from your initials
    app.buttons["home-initials"].tap()
    XCTAssertTrue(app.buttons["you-settings"].waitForExistence(timeout: 5))
    settle(); shot("settings")
    app.buttons["you-workspaces"].tap()
    XCTAssertTrue(app.buttons["org-new"].waitForExistence(timeout: 5))
    settle(); shot("organizations")
    app.buttons["Close"].firstMatch.tap(); settle()
    app.buttons["Close"].firstMatch.tap(); settle()

    // a chat
    let chat = app.buttons.containing(NSPredicate(format: "label CONTAINS 'general'")).firstMatch
    XCTAssertTrue(chat.waitForExistence(timeout: 10))
    chat.tap()
    XCTAssertTrue(app.buttons["chat-back"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["chat-more"].exists)
    XCTAssertTrue(app.textFields["composer-field"].exists || app.textViews["composer-field"].exists)
    settle(); shot("chat")
    app.buttons["chat-back"].tap()
    XCTAssertTrue(app.buttons["tab-chats"].waitForExistence(timeout: 5))
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
