import XCTest
@testable import Wisp

@MainActor
final class MarkMotionTests: XCTestCase {
  func testEaseMatchesCSSEndpointsAndLinear() {
    XCTAssertEqual(Ease.linear(0.37), 0.37, accuracy: 1e-9)
    for e in [Ease.ease, .easeIn, .easeOut, .easeInOut, Ease(0.3, 0.6, 0.25, 1)] {
      XCTAssertEqual(e(0), 0)
      XCTAssertEqual(e(1), 1)
    }
    // ease-in-out is symmetric around the middle
    XCTAssertEqual(Ease.easeInOut(0.5), 0.5, accuracy: 1e-4)
    XCTAssertEqual(Ease.easeInOut(0.2) + Ease.easeInOut(0.8), 1, accuracy: 1e-4)
  }

  func testTrackSamplesKeyframesAndHasNoFill() {
    let track = MarkTrack(start: 10, duration: 1, keys: [MarkKey(0, [0]), MarkKey(0.5, [100]), MarkKey(1, [0])])
    XCTAssertNil(track.sample(9.99))
    XCTAssertEqual(track.sample(10.25)?[0] ?? -1, 50, accuracy: 1e-6)
    XCTAssertEqual(track.sample(10.5)?[0] ?? -1, 100, accuracy: 1e-6)
    XCTAssertNil(track.sample(11))
  }

  func testLoopRepeatsAndEndsAfterItsIterations() {
    var loop = MarkTrack(start: 0, duration: 2, iterations: .infinity, keys: [MarkKey(0, [0]), MarkKey(1, [360])])
    XCTAssertEqual(loop.sample(5)?[0] ?? -1, 180, accuracy: 1e-6)
    XCTAssertFalse(loop.end.isFinite)
    // finishing lets the turn it is on complete
    loop.iterations = 3
    XCTAssertEqual(loop.end, 6)
    XCTAssertNil(loop.sample(6.01))
  }

  func testNothingPlaysAtRest() {
    let mark = MarkMotion(size: 40)
    XCTAssertFalse(mark.running)
    XCTAssertEqual(mark.pose(at: .infinity), MarkPose())
  }

  func testReducedMotionMovesOnlyFade() {
    let mark = MarkMotion(size: 40)
    mark.launch(reduced: true)
    let t = MarkMotion.now() + 0.1
    let pose = mark.pose(at: t)
    XCTAssertEqual(pose.offset, .zero)
    XCTAssertEqual(pose.rotation, 0)
    XCTAssertEqual(pose.scaleX, 1)
    XCTAssertLessThan(pose.opacity, 1)
    mark.jolly(reduced: true)
    XCTAssertEqual(mark.pose(at: MarkMotion.now() + 0.3).rotation, 0)
    mark.reset()
  }

  func testPullGrowsOnlyWhileDragging() {
    let mark = MarkMotion(size: 28)
    mark.setPull(32, dragging: true, reduced: false)
    XCTAssertEqual(mark.base.grow, 0.5, accuracy: 1e-6)
    XCTAssertGreaterThan(mark.base.rotation, 0)
    // let go: it can shrink with the list but never grow back
    mark.setPull(60, dragging: false, reduced: false)
    XCTAssertEqual(mark.base.grow, 0.5, accuracy: 1e-6)
    mark.setPull(10, dragging: false, reduced: false)
    XCTAssertLessThan(mark.base.grow, 0.5)
  }
}

/** Idle eyes rest to one side, picked with the web's FNV-1a hash and table (bubbleMotion.ts restingGaze). */
final class RestingGazeTests: XCTestCase {
  func testMatchesTheWebTable() {
    // expected values computed with the web's restingGaze
    XCTAssertEqual(BubblePainter.rest("juno"), CGPoint(x: -0.55, y: -0.30))
    XCTAssertEqual(BubblePainter.rest("atlas"), CGPoint(x: 0.60, y: 0))
    XCTAssertEqual(BubblePainter.rest("pip"), CGPoint(x: -0.60, y: 0))
    XCTAssertEqual(BubblePainter.rest(""), CGPoint(x: 0.55, y: -0.30))
  }
}
