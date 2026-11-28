import SwiftUI

// Round 12 (boards 15 and 15b): agent and team templates in the Marketplace. Agents are the
// onboarding's kinds of agent (Daily, Work, Coding, Business, Research); Use opens New agent filled
// in. Teams are your saved teams first, marked "yours", then the ready-made ones; a card opens a
// sheet with each role and its job, and Use this team opens the team builder with it loaded.

/** The plain rules behind the Agents and Teams sections, kept apart from the views so tests can check them. */
enum MarketTemplates {
  /** a card on the page (board 15: --card, #262629 in dark so it stands off the page) */
  static let cardFill = Color(light: 0xFFFFFF, dark: 0x262629)

  /** the bubble colours the cards cycle through */
  static let colors = BubbleColors.all.map(\.hex)

  // MARK: agents

  /** Every kind of agent but "Something else", which has nothing to fill in. */
  static var agents: [AgentType] { OnboardingCatalog.agentTypes.filter { $0.id != "other" } }

  /** Each kind's own colour (board 15b: Daily orange, Work blue, Coding green, Business amber, Research violet). */
  static func color(_ type: AgentType) -> String {
    switch type.id {
    case "daily": "#ff9d6b"
    case "work": "#6cc4ff"
    case "code": "#74dba6"
    case "biz": "#ffc04d"
    case "research": "#a59bff"
    default: colors[abs(stableHash(type.id)) % colors.count]
    }
  }

  static func look(_ type: AgentType) -> GhostLook { GhostLook.newAgent(color: color(type)) }

  /** The apps already connected here that this kind starts with, as connector ids to give the new agent. */
  static func connectorIds(_ type: AgentType, connectors: [AppConnector]) -> Set<String> {
    let catalog = Set(type.apps.compactMap { OnboardingCatalog.startApps[$0]?.catalogId })
    return Set(connectors.filter { c in c.catalogId.map(catalog.contains) == true }.map(\.id))
  }

  /** A name nobody here has yet: "Daily assistant", else "Daily assistant 2", 3, … */
  static func freeName(_ name: String, taken: [String]) -> String {
    let have = Set(taken.map { $0.lowercased() })
    if !have.contains(name.lowercased()) { return name }
    var n = 2
    while have.contains("\(name) \(n)".lowercased()) { n += 1 }
    return "\(name) \(n)"
  }

  static func matches(_ type: AgentType, _ needle: String) -> Bool {
    let n = needle.trimmed
    if n.isEmpty { return true }
    let apps = type.apps.compactMap { OnboardingCatalog.startApps[$0]?.name }
    return ([type.name, type.sub, type.role] + apps).contains { $0.localizedCaseInsensitiveContains(n) }
  }

  // MARK: teams

  struct TeamCard: Identifiable, Hashable {
    var template: TeamTemplate
    var own: Bool
    var id: String { template.id }
  }

  /** Your own saved teams first, then the ready-made ones; a saved one with a ready-made one's id shows once, as the ready-made one. */
  static func teams(own: [TeamTemplate], builtIn: [TeamTemplate] = TeamTemplate.builtIn) -> [TeamCard] {
    let ids = Set(builtIn.map(\.id))
    return own.filter { !ids.contains($0.id) }.map { TeamCard(template: $0, own: true) } + builtIn.map { TeamCard(template: $0, own: false) }
  }

  /** How many agents it takes: one per role, else one per step that needs an agent. */
  static func agentCount(_ t: TeamTemplate) -> Int {
    t.roles.isEmpty ? t.steps.filter(\.needsAgent).count : t.roles.count
  }

  /** "5 agents · yours" */
  static func countLine(_ card: TeamCard) -> String {
    let n = agentCount(card.template)
    return "\(n) \(n == 1 ? "agent" : "agents")" + (card.own ? " · yours" : "")
  }

  /** The people in a template, one per role (or step that needs an agent): a name, a short job and a bubble colour. */
  struct Member: Hashable { var name: String; var job: String; var color: String }

  static func members(_ t: TeamTemplate) -> [Member] {
    let start = abs(stableHash(t.id))
    let list: [(String, String)] = t.roles.isEmpty
      ? t.steps.filter(\.needsAgent).map { ($0.action, $0.prompt.map(shortJob) ?? "") }
      : t.roles.map { ($0.name, job(template: t.id, role: $0)) }
    return list.enumerated().map { i, m in Member(name: m.0, job: m.1, color: colors[(start + i) % colors.count]) }
  }

  /** The ready-made teams' jobs in a few words (board 15b); any other role gets its description's first sentence. */
  static let jobs: [String: [String: String]] = [
    "plan-challenge": ["Lead": "Plans and hands out the work", "Challenger": "Pushes back until the plan is right",
                       "Backend builder": "Server, data and API", "Frontend builder": "The screens", "Reviewer": "Reads and tests every piece"],
    "build-review": ["Builder": "Builds it, with tests", "Reviewer": "Reads the work for what could break", "Tester": "Runs it for real"],
    "research-desk": ["Researcher": "Digs into primary sources", "Fact-checker": "Checks every claim", "Writer": "Writes it up, short and clear"],
    "bug-squad": ["Reproducer": "Finds the exact steps to the bug", "Fixer": "Fixes the root cause", "Verifier": "Checks it's really fixed"],
    "support-queue": ["Triage": "Sorts each request by what and how urgent", "Responder": "Drafts the reply", "Checker": "Reads every reply before it goes"],
    "release-crew": ["Planner": "Writes a short plan", "Researcher": "Compares the options", "Builder": "Builds from the plan and the research"],
  ]

  static func job(template: String, role: ChannelTeam.Role) -> String {
    jobs[template]?[role.name] ?? shortJob(role.description)
  }

  /** "You review every finished piece: read the diff…" → "Review every finished piece" */
  static func shortJob(_ description: String) -> String {
    var s = description.trimmed
    if let cut = s.firstIndex(where: { ".:;\n".contains($0) }) { s = String(s[..<cut]) }
    for lead in ["You ", "you "] where s.hasPrefix(lead) { s = String(s.dropFirst(lead.count)) }
    s = s.trimmed
    if s.count > 48 { s = String(s.prefix(47)).trimmed + "…" }
    return s.prefix(1).uppercased() + s.dropFirst()
  }

  static func matches(_ t: TeamTemplate, _ needle: String) -> Bool {
    let n = needle.trimmed
    if n.isEmpty { return true }
    return ([t.name, t.blurb] + t.roles.map(\.name) + members(t).map(\.job)).contains { $0.localizedCaseInsensitiveContains(n) }
  }

  /** the same number every launch (Swift's own hashValue changes from run to run) */
  static func stableHash(_ s: String) -> Int {
    var h = 7
    for c in s.utf16 { h = (h &* 31 &+ Int(c)) % 99991 }
    return h
  }
}

// MARK: views

/** Presents a sheet without its slide: menus and sheets are instant. */
@MainActor func instantly(_ change: () -> Void) {
  var t = Transaction(animation: nil)
  t.disablesAnimations = true
  withTransaction(t, change)
}

/** One kind of agent: its bubble, name, what it handles and Use. */
struct MarketAgentRow: View {
  var type: AgentType
  var onUse: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      GhostView(look: MarketTemplates.look(type), seed: type.id, size: 44, animate: false)
        .frame(width: 44, height: 44).accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(type.name).font(.system(size: 14.5, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
        Text(type.sub).font(.system(size: 12.5)).foregroundStyle(Palette.muted).lineLimit(1)
      }
      Spacer(minLength: 8)
      Button(action: onUse) {
        Text("Use").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.text)
          .padding(.horizontal, 13).frame(height: 30).background(Capsule().fill(Palette.badge)).contentShape(Capsule())
      }
      .buttonStyle(.press)
      .accessibilityLabel("Use \(type.name)")
      .accessibilityIdentifier("market-agent-use-\(type.id)")
    }
    .padding(.horizontal, 14).padding(.vertical, 12)
    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(MarketTemplates.cardFill))
    .accessibilityElement(children: .contain)
  }
}

/** A row of overlapping bubbles: up to four, then "+N". */
struct StackedBubbles: View {
  var members: [MarketTemplates.Member]
  var seed: String
  var size: CGFloat
  var ring: Color = MarketTemplates.cardFill

  var body: some View {
    let shown = Array(members.prefix(4))
    HStack(spacing: -size * 0.32) {
      ForEach(Array(shown.enumerated()), id: \.offset) { i, m in
        GhostView(look: GhostLook.newAgent(color: m.color), seed: seed + "\(i)", size: size, animate: false)
          .frame(width: size, height: size)
          .background(Circle().fill(ring).padding(-2))
      }
      if members.count > shown.count {
        Text("+\(members.count - shown.count)").font(.system(size: 12.5)).foregroundStyle(Palette.muted)
          .padding(.leading, size * 0.32 + 6)
      }
    }
    .accessibilityHidden(true)
  }
}

/** A team template's card: its bubbles and how many agents, its name and what it does. */
struct MarketTeamCard: View {
  var card: MarketTemplates.TeamCard
  var onOpen: () -> Void

  var body: some View {
    let t = card.template
    Button(action: onOpen) {
      VStack(alignment: .leading, spacing: 9) {
        HStack {
          StackedBubbles(members: MarketTemplates.members(t), seed: t.id, size: 30)
          Spacer()
          Text(MarketTemplates.countLine(card)).font(.system(size: 12.5)).foregroundStyle(Palette.muted)
        }
        Text(t.name).font(.system(size: 14.5, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
        if !t.blurb.isEmpty {
          Text(t.blurb).font(.system(size: 12.5)).foregroundStyle(Palette.muted).lineLimit(2).multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .padding(14).frame(maxWidth: .infinity, alignment: .leading)
      .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(MarketTemplates.cardFill))
      .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
    .buttonStyle(.pressRow)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(t.name). \(MarketTemplates.countLine(card)). \(t.blurb)")
    .accessibilityIdentifier("market-team-\(t.id)")
  }
}

/** A team, opened (board 15b): its bubbles, name and blurb, each role and its job, and one Use this team. */
struct TeamTemplateSheet: View {
  var card: MarketTemplates.TeamCard
  var onUse: () -> Void

  var body: some View {
    let t = card.template
    let members = MarketTemplates.members(t)
    VStack(spacing: 0) {
      Capsule().fill(Palette.hairline).frame(width: 36, height: 5).padding(.top, 10).padding(.bottom, 16)
      ScrollView {
        VStack(spacing: 0) {
          StackedBubbles(members: members, seed: t.id, size: 44)
          Text(t.name).font(.system(size: 21, weight: .bold)).foregroundStyle(Palette.text).multilineTextAlignment(.center)
            .padding(.top, 12).accessibilityAddTraits(.isHeader)
          if !t.blurb.isEmpty {
            Text(t.blurb).font(.system(size: 14)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
              .padding(.horizontal, 10).padding(.top, 4)
          }
          VStack(spacing: 2) {
            ForEach(Array(members.enumerated()), id: \.offset) { i, m in
              HStack(spacing: 11) {
                GhostView(look: GhostLook.newAgent(color: m.color), seed: t.id + "\(i)", size: 34, animate: false).frame(width: 34, height: 34)
                  .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                  Text(m.name).font(.system(size: 14.5, weight: .semibold)).foregroundStyle(Palette.text)
                  if !m.job.isEmpty { Text(m.job).font(.system(size: 13)).foregroundStyle(Palette.muted).lineLimit(2) }
                }
                Spacer(minLength: 0)
              }
              .frame(minHeight: 50)
              .accessibilityElement(children: .combine)
            }
          }
          .padding(.top, 16)
        }
        .padding(.horizontal, 18)
      }
      VStack(spacing: 10) {
        Button(action: onUse) {
          Text("Use this team").font(.system(size: 15.5, weight: .semibold)).foregroundStyle(Palette.sheet)
            .frame(maxWidth: .infinity).frame(height: 48).background(Capsule().fill(Palette.text)).contentShape(Capsule())
        }
        .buttonStyle(.press)
        .accessibilityIdentifier("market-team-use")
        Text("Opens the team builder, ready to change").font(.system(size: 13)).foregroundStyle(Palette.muted)
      }
      .padding(.horizontal, 18).padding(.top, 10).padding(.bottom, 14)
    }
    .presentationDetents([.large])
    .presentationBackground(MarketTemplates.cardFill)
    .presentationCornerRadius(Corner.sheet)
    .presentationDragIndicator(.hidden)
    .accessibilityIdentifier("screen-team-template")
  }
}
