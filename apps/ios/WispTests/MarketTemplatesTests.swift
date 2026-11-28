import XCTest
@testable import Wisp

/** Round 12: agent and team templates in the Marketplace (boards 15 and 15b). */
final class MarketTemplatesTests: XCTestCase {
  private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T { try Wire.decoder.decode(type, from: Data(json.utf8)) }

  func testAgentsAreTheFiveKindsWithoutSomethingElse() {
    XCTAssertEqual(MarketTemplates.agents.map(\.name), ["Daily assistant", "Work assistant", "Coding assistant", "Business manager", "Research assistant"])
    // every kind has its own colour, and it's a bubble colour
    let colors = MarketTemplates.agents.map(MarketTemplates.color)
    XCTAssertEqual(Set(colors).count, 5)
    XCTAssertTrue(colors.allSatisfy(MarketTemplates.colors.contains))
  }

  func testAgentGetsTheConnectedAppsItStartsWith() throws {
    let connectors = try decode([AppConnector].self, ##"[{"id":"c1","name":"GitHub","kind":"http","catalogId":"github"},{"id":"c2","name":"Slack","kind":"http","catalogId":"slack"},{"id":"c3","name":"Mine","kind":"stdio"}]"##)
    let code = try XCTUnwrap(MarketTemplates.agents.first { $0.id == "code" })
    let work = try XCTUnwrap(MarketTemplates.agents.first { $0.id == "work" })
    XCTAssertEqual(MarketTemplates.connectorIds(code, connectors: connectors), ["c1"])
    XCTAssertEqual(MarketTemplates.connectorIds(work, connectors: connectors), ["c2"])
  }

  func testFreeName() {
    XCTAssertEqual(MarketTemplates.freeName("Daily assistant", taken: ["Nova"]), "Daily assistant")
    XCTAssertEqual(MarketTemplates.freeName("Daily assistant", taken: ["daily assistant", "Daily assistant 2"]), "Daily assistant 3")
  }

  func testAgentSearchMatchesNameLineAndApps() {
    let found = { (q: String) in MarketTemplates.agents.filter { MarketTemplates.matches($0, q) }.map(\.id) }
    XCTAssertEqual(found("coding"), ["code"])
    XCTAssertEqual(found("stripe"), ["biz"])
    XCTAssertEqual(found("").count, 5)
    XCTAssertEqual(found("zzz"), [])
  }

  func testOwnTeamsComeFirstMarkedYours() throws {
    let own = TeamTemplate(id: "own-shop", name: "Shop mornings", blurb: "Orders, labels, pickup.",
      roles: [ChannelTeam.Role(id: "r1", name: "Packer", description: "You pack the orders."), ChannelTeam.Role(id: "r2", name: "Labeler", description: "You print labels.")], steps: [])
    // a saved one with a ready-made one's id shows once, as the ready-made one
    let clash = TeamTemplate(id: "plan-challenge", name: "Copy", blurb: "", roles: [], steps: [])
    let cards = MarketTemplates.teams(own: [own, clash])
    XCTAssertEqual(cards.first?.id, "own-shop")
    XCTAssertTrue(cards[0].own)
    XCTAssertEqual(cards.count, TeamTemplate.builtIn.count + 1)
    XCTAssertEqual(cards.filter(\.own).count, 1)
    XCTAssertEqual(MarketTemplates.countLine(cards[0]), "2 agents · yours")
    let plan = try XCTUnwrap(cards.first { $0.id == "plan-challenge" })
    XCTAssertEqual(MarketTemplates.countLine(plan), "5 agents")
  }

  func testEveryReadyMadeRoleHasAShortJob() throws {
    XCTAssertFalse(TeamTemplate.builtIn.isEmpty)
    for t in TeamTemplate.builtIn {
      for r in t.roles {
        let job = try XCTUnwrap(MarketTemplates.jobs[t.id]?[r.name], "\(t.id) / \(r.name) has no short job")
        XCTAssertLessThanOrEqual(job.count, 44, job)
      }
    }
    let plan = try XCTUnwrap(TeamTemplate.builtIn.first { $0.id == "plan-challenge" })
    XCTAssertEqual(MarketTemplates.members(plan).map(\.job), ["Plans and hands out the work", "Pushes back until the plan is right", "Server, data and API", "The screens", "Reads and tests every piece"])
  }

  func testOtherRolesGetTheirFirstSentence() {
    XCTAssertEqual(MarketTemplates.shortJob("You review every finished piece: read the diff, run the tests."), "Review every finished piece")
    XCTAssertEqual(MarketTemplates.shortJob("Build the feature. Keep it small."), "Build the feature")
    XCTAssertLessThanOrEqual(MarketTemplates.shortJob(String(repeating: "word ", count: 30)).count, 48)
  }

  func testTeamSearchMatchesRolesAndJobs() {
    let found = { (q: String) in TeamTemplate.builtIn.filter { MarketTemplates.matches($0, q) }.map(\.id) }
    XCTAssertTrue(found("fact-checker").contains("research-desk"))
    XCTAssertTrue(found("root cause").contains("bug-squad"))
    XCTAssertEqual(found("zzz"), [])
  }

  func testMembersAreStableAndColoured() throws {
    let t = try XCTUnwrap(TeamTemplate.builtIn.first)
    XCTAssertEqual(MarketTemplates.members(t), MarketTemplates.members(t))
    XCTAssertEqual(MarketTemplates.members(t).count, MarketTemplates.agentCount(t))
    XCTAssertTrue(MarketTemplates.members(t).allSatisfy { MarketTemplates.colors.contains($0.color) })
  }
}
