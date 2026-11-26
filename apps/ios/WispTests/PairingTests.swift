import XCTest
@testable import Wisp

/** The "Type a link" field's parser additions (canvas "Phone welcome", 2026-11-26). */
@MainActor
final class PairingTests: XCTestCase {
  private let link = "wisp://pair?v=1&id=k3f9q2&s=secret&u=http://wisp.local:4747&u=http://100.64.0.2:4747"

  func testFindsTheLinkInsideLongerText() throws {
    let found = try XCTUnwrap(PairLink("Here's the link: \(link) thanks"))
    XCTAssertEqual(found.id, "k3f9q2")
    XCTAssertEqual(found.secret, "secret")
    XCTAssertEqual(found.addresses.map(\.absoluteString), ["http://wisp.local:4747", "http://100.64.0.2:4747"])
    // a sentence's full stop or a bracket after it isn't part of the link
    XCTAssertEqual(PairLink("Pair with this (\(link)).")?.addresses.count, 2)
    XCTAssertEqual(PairLink("\n  \(link)\n"), found)
    // the first of two
    XCTAssertEqual(PairLink("\(link) and warren://pair?id=other&s=x&u=http://h:1")?.id, "k3f9q2")
  }

  func testSchemeInAnyCase() {
    XCTAssertEqual(PairLink("WISP://pair?id=a&s=b&u=http://h:1")?.id, "a")
    XCTAssertEqual(PairLink("Warren://Pair?id=a&s=b&u=http://h:1")?.id, "a")
    XCTAssertEqual(PairLink("see WiSp://pair?id=a&s=b&u=http://h:1")?.id, "a")
  }

  func testStillRejectsWhatIsNotAPairingLink() {
    XCTAssertNil(PairLink("hello"))
    XCTAssertNil(PairLink("wisp.local:4747"))
    XCTAssertNil(PairLink("https://my-hub.ts.net"))
    XCTAssertNil(PairLink("mywisp://pair?id=a&s=b&u=http://h:1"))
    XCTAssertNil(PairLink("wisp://pair?id=a&s=b"))
    XCTAssertNil(PairLink("wisp://pairing?id=a&s=b&u=http://h:1"))
  }

  func testCheckAsTyped() {
    XCTAssertEqual(PairLink.check(""), .empty)
    XCTAssertEqual(PairLink.check("  "), .empty)
    XCTAssertEqual(PairLink.check("wis"), .typing)
    XCTAssertEqual(PairLink.check("WISP://pa"), .typing)
    XCTAssertEqual(PairLink.check("wisp://pair?v=1&id=a"), .incomplete)
    XCTAssertEqual(PairLink.check("wisp.local:4747"), .address)
    XCTAssertEqual(PairLink.check("https://my-hub.ts.net"), .address)
    XCTAssertEqual(PairLink.check("192.168.1.20"), .address)
    XCTAssertEqual(PairLink.check("hello"), .wrong)
    XCTAssertEqual(PairLink.check("hello there"), .wrong)
    guard case .ok(let found) = PairLink.check(link) else { return XCTFail("expected a link") }
    XCTAssertEqual(found.firstPlace, "wisp.local:4747")
    XCTAssertEqual(found.addresses.count - 1, 1)
  }

  func testFirstPlaceWithoutAPort() throws {
    XCTAssertEqual(try XCTUnwrap(PairLink("wisp://pair?id=a&s=b&u=https://my-hub.ts.net")).firstPlace, "my-hub.ts.net")
  }
}
