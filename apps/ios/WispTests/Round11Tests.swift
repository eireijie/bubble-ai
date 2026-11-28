import XCTest
@testable import Wisp

/** Round 11 (boards 8–14): the five tabs, where the tour lands, Import memory's parsing, the twelve colours. */
@MainActor
final class Round11Tests: XCTestCase {
  // MARK: tabs

  func testFiveTabsInOrder() {
    XCTAssertEqual(MainTab.allCases, [.chats, .computers, .memory, .marketplace, .more])
  }

  func testTourPlacesLandOnTheRightTab() {
    XCTAssertEqual(Tour.Place.memory.tab, .memory)
    XCTAssertEqual(Tour.Place.marketplace.tab, .marketplace)
    XCTAssertEqual(Tour.Place.inbox.tab, .more)
    XCTAssertEqual(Tour.Place.mods.tab, .more)
    // Settings is a sheet over Chats, opened from your initials
    for p in [Tour.Place.settings, .usage, .ai] {
      XCTAssertEqual(p.tab, .chats)
      XCTAssertTrue(p.inSettings)
    }
    XCTAssertFalse(Tour.Place.memory.inSettings)
  }

  // MARK: Import memory

  func testFactsStripBulletsNumbersAndHeadings() {
    let answer = """
    # What I know about you
    **Work:**
    - You run a small online shop selling candles.
    * You prefer short replies.
    1. Your partner is Alex.
    2) You walk the dog at 7am.
    • Never book meetings on Fridays.

    ok
    """
    XCTAssertEqual(ImportMemory.facts(answer), [
      "You run a small online shop selling candles.",
      "You prefer short replies.",
      "Your partner is Alex.",
      "You walk the dog at 7am.",
      "Never book meetings on Fridays.",
    ])
  }

  func testFactsDropDuplicatesAndCapAt200() {
    XCTAssertEqual(ImportMemory.facts("- Likes tea\n- Likes tea\n"), ["Likes tea"])
    let many = (1...300).map { "- Fact number \($0)" }.joined(separator: "\n")
    XCTAssertEqual(ImportMemory.facts(many).count, 200)
    XCTAssertTrue(ImportMemory.facts("   \n\n").isEmpty)
  }

  func testKindSplitsPreferencesFromDetails() {
    XCTAssertEqual(ImportMemory.kind("You prefer short replies."), "preference")
    XCTAssertEqual(ImportMemory.kind("Never book meetings on Fridays."), "preference")
    XCTAssertEqual(ImportMemory.kind("Always CC your manager."), "preference")
    XCTAssertEqual(ImportMemory.kind("Your partner is Alex."), "detail")
    XCTAssertEqual(ImportMemory.kind("You run a candle shop."), "detail")
  }

  // MARK: New agent / Bubble look

  func testTwelveDistinctColours() {
    let hexes = BubbleLookPage.swatches.map { $0.hex.lowercased() }
    XCTAssertEqual(hexes.count, 12)
    XCTAssertEqual(Set(hexes).count, 12)
    XCTAssertTrue(hexes.allSatisfy { $0.range(of: "^#[0-9a-f]{6}$", options: .regularExpression) != nil })
  }

  // MARK: This iPhone

  func testThisIPhoneListsEachAppOnce() {
    let apps = ThisIPhoneList.apps.map(\.0)
    XCTAssertEqual(apps, [.calendar, .reminders, .contacts, .location])
  }
}
