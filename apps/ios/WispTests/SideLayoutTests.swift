import XCTest
@testable import Bubble AI

/** The phone chat list's pins and sections: the same rules as web sidebarLayout.ts. */
final class SideLayoutTests: XCTestCase {
  private func chats(_ keys: [String], pinned: Set<String> = [], unread: [String: Int] = [:], section: [String: String] = [:]) -> [SideLayout.Chat] {
    keys.map { SideLayout.Chat(key: $0, pinned: pinned.contains($0), sectionId: section[$0], unread: unread[$0] ?? 0) }
  }

  func testBaseLayoutComesFromStarsAndWorkspaceSectionsUntilSaved() {
    let list = chats(["a:1", "a:2", "c:3"], pinned: ["a:2"], section: ["c:3": "s1"])
    let base = SideLayout.base(nil, chats: list, sections: [ChannelSection(id: "s1", name: "Work", emoji: "", position: 0)])
    XCTAssertEqual(base.pins, ["a:2"])
    XCTAssertEqual(base.sections.map(\.name), ["Work"])
    XCTAssertEqual(base.sections[0].items, ["c:3"])
    let saved = SidebarLayout(pins: [], sections: [])
    XCTAssertEqual(SideLayout.base(saved, chats: list, sections: []), saved)
  }

  func testPlacingPinsSectionsAndNoSection() {
    let list = chats(["a:1", "a:2", "c:3", "a:4"])
    let l = SidebarLayout(pins: ["a:2", "a:gone"], sections: [.init(id: "s1", name: "Work", items: ["c:3", "a:2"])], hidden: ["a:4"])
    let placed = SideLayout.place(l, chats: list)
    XCTAssertEqual(placed.pins, ["a:2"])
    XCTAssertEqual(placed.sections.map(\.name), ["Work", "No section"])
    XCTAssertEqual(placed.sections[0].keys, ["c:3"], "a pin leaves its section while pinned")
    XCTAssertEqual(placed.sections[1].keys, ["a:1"], "a hidden chat stays out")
    // a hidden chat comes back when something new arrives
    let back = SideLayout.place(l, chats: chats(["a:1", "a:2", "c:3", "a:4"], unread: ["a:4": 1]))
    XCTAssertEqual(back.sections[1].keys, ["a:1", "a:4"])
  }

  func testNinePinsAtMostAndTheNotice() {
    var l = SidebarLayout(pins: [], sections: [])
    for i in 1...9 { l = SideLayout.pin(l, "a:\(i)")! }
    XCTAssertNil(SideLayout.pin(l, "a:10"))
    XCTAssertEqual(SideLayout.pin(l, "a:3"), l, "pinning a pin changes nothing")
    XCTAssertEqual(SideLayout.pinsFullNotice("Nova"), "9 pinned is the most. Unpin one to pin Nova.")
    XCTAssertEqual(SideLayout.unpin(l, "a:1").pins.count, 8)
  }

  func testMoveHideUnreadSectionsAndForget() {
    var l = SidebarLayout(pins: ["a:1"], sections: [.init(id: "s1", name: "Work", items: [])])
    l = SideLayout.move(l, "a:1", to: "s1")
    XCTAssertEqual(l.pins, [])
    XCTAssertEqual(l.sections[0].items, ["a:1"])
    l = SideLayout.move(l, "a:1", to: SideLayout.none)
    XCTAssertEqual(l.sections[0].items, [])
    l = SideLayout.addSection(l, name: SideLayout.newSectionName(l), id: "s2", key: "a:1")
    XCTAssertEqual(l.sections.map(\.name), ["Work", "New section"])
    XCTAssertEqual(SideLayout.newSectionName(l), "New section 2")
    XCTAssertEqual(l.sections[1].items, ["a:1"])
    l = SideLayout.renameSection(l, "s2", "  Errands ")
    XCTAssertEqual(l.sections[1].name, "Errands")
    l = SideLayout.fold(l, "s2", true)
    XCTAssertEqual(l.sections[1].folded, true)
    l = SideLayout.fold(l, SideLayout.none, true)
    XCTAssertEqual(l.noneFolded, true)
    l = SideLayout.markUnread(SideLayout.hide(l, "c:9"), "a:1")
    XCTAssertEqual(l.hidden, ["c:9"])
    XCTAssertEqual(l.unread, ["a:1"])
    XCTAssertEqual(SideLayout.clearUnread(l, "a:1").unread, [])
    l = SideLayout.deleteSection(l, "s2")
    XCTAssertEqual(l.sections.map(\.id), ["s1"], "deleting a section keeps its chats; they go to No section")
    l = SideLayout.forget(SideLayout.pin(l, "a:1")!, "a:1")
    XCTAssertEqual(l.pins, [])
    XCTAssertEqual(l.unread, [])
  }

  func testLayoutEncodesWithoutNullsForTheHub() throws {
    let l = SidebarLayout(pins: ["a:1"], sections: [.init(id: "s1", name: "Work", items: ["c:2"])])
    let json = String(decoding: try JSONEncoder().encode(l), as: UTF8.self)
    XCTAssertFalse(json.contains("null"))
    XCTAssertFalse(json.contains("folded"))
    let prefs = try JSONDecoder().decode(Me.Prefs.self, from: Data(#"{"clock":"auto","sidebar":{"pins":["a:1"],"sections":[{"id":"s","name":"Home","folded":true,"items":[]}],"unread":["c:2"]}}"#.utf8))
    XCTAssertEqual(prefs.sidebar?.sections.first?.folded, true)
    XCTAssertEqual(prefs.sidebar?.unread, ["c:2"])
  }

  func testLinkCardsFromTheLinkItself() {
    let links = LinkPreview.find("See https://example.com/blog/how-we-ship-fast. And https://www.cdn.test/pics/cat.JPG, https://github.com/o/r/pull/12 and http://localhost:3000/x")
    XCTAssertEqual(links.count, 2)
    XCTAssertEqual(links[0].url, "https://example.com/blog/how-we-ship-fast")
    XCTAssertEqual(links[0].title, "How we ship fast")
    XCTAssertEqual(links[0].domain, "example.com")
    XCTAssertNil(links[0].image)
    XCTAssertEqual(links[1].domain, "cdn.test")
    XCTAssertNotNil(links[1].image)
    XCTAssertEqual(LinkPreview.find("https://news.example.org/123")[0].title, "News.example.org")
  }
}
