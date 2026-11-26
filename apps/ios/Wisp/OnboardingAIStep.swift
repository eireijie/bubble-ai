import SwiftUI

/** What the first agent can think with, and the rules for picking it (AIStep.tsx). */
enum OnboardingAI {
  enum Pick: Hashable { case found, claude, chatgpt, grok, key, harness(String) }
  /** What's already set to go: a connection Bubble AI keeps, or a harness signed in on the computer. */
  struct Found: Equatable { var harness: String; var connectionId: String?; var share = false }

  /** The harnesses a connection is tried on, best first: the one the provider makes, then the open ones. */
  static let preferred = ["claude-code", "codex", "hermes", "opencode", "goose"]
  static func provider(of pick: Pick) -> String? {
    switch pick {
    case .claude: "anthropic"
    case .chatgpt: "openai"
    case .grok: "xai"
    default: nil
    }
  }

  /** The best harness for a provider and kind of connection, from the shared support table. */
  static func harness(for provider: String, kind: String, providers: [ModelProviderInfo], support: [CredentialSupport]) -> String {
    let own = providers.first { $0.id == provider }?.signIn?.first?.harness
    if kind == "oauth", let own { return own }
    return preferred.first { h in support.contains { $0.harness == h && $0.provider == provider && $0.kind == kind } } ?? own ?? "hermes"
  }

  /** What's already set to go on the person's computer, best first: a connection Bubble AI keeps, then a harness signed in there. */
  static func found(on device: AgentNode?, connections: [ModelConnection], support: [CredentialSupport]) -> Found? {
    for h in ["claude-code", "codex"] {
      if let c = connections.first(where: { $0.mine == true && $0.lastError == nil && ModelWords.supports(h, $0, support: support) }) { return Found(harness: h, connectionId: c.id) }
    }
    func signedIn(_ id: String) -> Bool { (device?.harnesses?.first { $0.id == id }?.accounts?["default"] ?? nil) == true }
    if signedIn("claude-code") { return Found(harness: "claude-code") }
    // Codex's own sign-in is shared with Bubble AI ("Use this sign-in"), so it works on every computer
    if signedIn("codex") { return Found(harness: "codex", share: true) }
    if let h = HarnessChoice.all.first(where: { $0.protocolName != "mcp" && signedIn($0.id) }) { return Found(harness: h.id) }
    return nil
  }

  /** The computer the first agent goes on: one of yours first, connected and not paused. */
  static func device(_ nodes: [AgentNode]) -> AgentNode? {
    let usable = ComputerAdd.usable(nodes).filter { $0.online && $0.paused != true }
    return usable.first { $0.mine == true } ?? usable.first
  }
}

/**
 * First-run page 3: what the agent thinks with. What's already signed in on the person's computer
 * is found and picked; a subscription signs in once to Bubble AI; a key becomes a model connection. Any
 * pick makes the agent from page 2's draft (or updates the one made before) and checks it can
 * answer before Continue.
 */
struct OnboardingAIStep: View {
  @Environment(Store.self) private var store
  @Environment(HostStage.self) private var stage
  var workspaceId: String
  var onDone: (_ agentId: String?, _ channelId: String?) -> Void
  var onBack: () -> Void

  private enum Phase { case idle, checking, ready, failed }
  private enum Trying { case signIn, hello, ready }
  private enum Connect: Identifiable {
    case provider(String), list
    var id: String { if case .provider(let p) = self { p } else { "list" } }
  }

  @State private var draft: FirstAgentDraft?
  @State private var pick: OnboardingAI.Pick?
  @State private var phase = Phase.idle
  @State private var trying = Trying.signIn
  @State private var harness = "claude-code"
  @State private var problem: String?
  /** its AI said "signed in" but its first run couldn't sign in (an expired session): sign in again */
  @State private var resign: String?
  @State private var agentId: String?
  @State private var leaving = false
  /** the apps it reads before its hello ("Messages and Calendar"), when any were set up */
  @State private var reading: String?
  /** its real hello, typed in under the host once it's said */
  @State private var hello: String?
  @State private var connections: [ModelConnection] = []
  @State private var providers: [ModelProviderInfo] = []
  @State private var support: [CredentialSupport] = []
  @State private var connect: Connect?
  @State private var path: [String] = []
  @State private var more = false
  @State private var run = 0
  @State private var loaded = false
  @ReduceMotion private var reduceMotion

  private var person: String { store.me?.preferredName ?? store.me?.name ?? "" }
  private var first: String { OnboardingText.first(person) }
  private var name: String { draft?.name.trimmed.isEmpty == false ? draft!.name.trimmed : "Atlas" }
  private var look: GhostLook { OnboardingLook.of(draft) }
  private var device: AgentNode? { OnboardingAI.device(store.nodes) }
  private var found: OnboardingAI.Found? { OnboardingAI.found(on: device, connections: connections, support: support) }
  /** what is found on the computer is picked for you; otherwise nothing starts until you pick */
  private var cur: OnboardingAI.Pick? { pick ?? (found != nil ? .found : nil) }
  private var others: [HarnessChoice] {
    // the ones that keep their own sign-in on the computer and are signed in there
    HarnessChoice.all.filter { h in h.protocolName != "mcp" && h.id != found?.harness && (device?.harnesses?.first { $0.id == h.id }?.accounts?["default"] ?? nil) == true }
  }
  private var cta: String { phase == .ready ? "Meet \(name)" : phase == .failed ? "Continue" : cur == .found ? "Use this" : "Continue" }

  var body: some View {
    OnboardingPage(step: 3, onBack: onBack, focus: phase == .idle ? nil : "\(phase)/\(trying)/\(hello != nil)") {
      VStack(alignment: .leading, spacing: 18) {
        OnboardingHead(title: "What should \(name) think with?", sub: "Sign in once. Every agent you make can use it.")
        VStack(spacing: 8) {
          ForEach(Array(options.enumerated()), id: \.element.id) { i, o in
            AIChoice(on: cur == o.id, title: o.title, sub: o.sub, symbol: o.symbol, badge: o.badge) { choose(o.id) }
              .rowEntrance(i).accessibilityIdentifier("ob-ai-\(o.key)")
          }
          if more {
            ForEach(others) { h in
              AIChoice(on: cur == .harness(h.id), title: h.label, sub: "Signed in on \(device?.name ?? "your computer")", symbol: "ellipsis", badge: nil) {
                choose(.harness(h.id))
                Task { await tryIt(h.id, nil) }
              }
              .obPop()
            }
          }
        }
        .accessibilityElement(children: .contain).accessibilityLabel("What it thinks with")
        if !more, !others.isEmpty {
          Button("More agents (\(others.count))") { withAnimation(Motion.pick(Motion.soft, reduceMotion)) { more = true } }
            .font(.system(size: 15)).foregroundStyle(Palette.muted).buttonStyle(.plain)
        }
        if device == nil, loaded { Text("Waiting for a computer to connect…").font(.system(size: 13)).foregroundStyle(Palette.muted) }
        status
      }
      .animation(Motion.pick(Motion.soft, reduceMotion), value: phase)
      .animation(Motion.pick(Motion.soft, reduceMotion), value: trying)
    } bottom: {
      Button(leaving ? "Opening…" : device == nil && loaded && phase == .idle ? "Continue" : cta) { Task { await proceed() } }
        .buttonStyle(ObPrimary())
        .disabled(leaving || phase == .checking || (phase == .idle && cur != .found && device != nil))
        .accessibilityIdentifier("ob-ai-next")
      // nothing working yet: no one is stuck here; it can be set up later in Settings
      if phase != .ready, phase != .checking, cur != .found {
        Button("Set up later") { onDone(agentId, nil) }.buttonStyle(ObQuiet()).disabled(leaving).accessibilityIdentifier("ob-ai-later")
      }
    }
    .sheet(item: $connect, onDismiss: { path = [] }) { which in
      NavigationStack(path: $path) {
        Group {
          switch which {
          case .provider(let p): ConnectProviderView(provider: p) { connected($0) }
          case .list: ConnectModelList { path.append($0) }
          }
        }
        .navigationDestination(for: String.self) { p in ConnectProviderView(provider: p) { connected($0) } }
      }
      .environment(store)
      .presentationCornerRadius(Corner.sheet)
    }
    .task {
      guard !loaded else { return }
      let answers = OnboardingAnswers.load(workspaceId)
      draft = answers.agentDraft
      agentId = answers.agentId.flatMap { id in store.agent(id) != nil ? id : nil }
      reading = answers.appsLine
      async let nodes: Void? = try? store.refreshNodes()
      async let computers: Void = store.refreshComputers()
      await reload()
      _ = await (nodes, computers)
      loaded = true
    }
    .onDisappear { run += 1 }
  }

  // MARK: the choices

  private struct Option { var id: OnboardingAI.Pick; var key: String; var title: String; var sub: String; var symbol: String; var badge: String? }

  private var options: [Option] {
    var out: [Option] = []
    let there = device?.name ?? "your computer"
    if let found {
      let sub = found.connectionId != nil ? "Already connected to Bubble AI." : found.harness == "claude-code" ? "Signed in on \(there). Uses your Claude plan." : "Signed in on \(there)."
      out.append(Option(id: .found, key: "found", title: HarnessChoice.label(found.harness), sub: sub, symbol: "laptopcomputer", badge: "Found on \(there)"))
    }
    // Claude's sign-in runs in a terminal on the device, which Windows can't do yet
    out.append(Option(id: .claude, key: "claude", title: "Claude subscription", sub: device?.capabilities?.platform == "win32" ? "Needs a Mac or Linux computer for now. On Windows, use an API key." : "Pro or Max. Sign in, then paste the code it shows.", symbol: "sparkle", badge: nil))
    out.append(Option(id: .chatgpt, key: "chatgpt", title: "ChatGPT subscription", sub: "Plus or higher. Sign in with ChatGPT.", symbol: "message", badge: nil))
    out.append(Option(id: .grok, key: "grok", title: "Grok subscription", sub: "Sign in with your Grok account.", symbol: "xmark", badge: nil))
    out.append(Option(id: .key, key: "key", title: "I have an API key", sub: "Claude, OpenAI, OpenRouter, Gemini or Grok.", symbol: "key", badge: nil))
    return out
  }

  /** The host and what it's doing: waiting for a pick, the three live steps, its hello, or what went wrong. */
  private var status: some View {
    VStack(spacing: 14) {
      HostGhost(look: look, size: 88, mood: phase == .checking ? .working : .awake, happy: phase == .ready)
      Group {
        switch phase {
        case .idle:
          Text("Pick one and I'll try it right away.").font(.system(size: 15)).foregroundStyle(Palette.muted)
        case .checking, .ready:
          VStack(alignment: .leading, spacing: 8) {
            LiveStep(state: trying == .signIn ? .now : .done, text: "Signing in to \(HarnessChoice.label(harness))")
            LiveStep(state: trying == .signIn ? .later : trying == .hello ? .now : .done, text: reading.map { "Reading \($0)" } ?? "Trying a hello")
            LiveStep(state: trying == .ready ? .done : .later, text: "Ready")
          }
          .accessibilityElement(children: .contain).accessibilityLabel("Trying it")
          if phase == .ready {
            TypedText(text: hello ?? "I can think. Running on \(HarnessChoice.label(harness)). Ready when you are\(first.isEmpty ? "" : ", \(first)").")
              .font(.system(size: 15)).foregroundStyle(Palette.text)
              .padding(.horizontal, 14).padding(.vertical, 9)
              .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.bubble))
              .frame(maxWidth: .infinity, alignment: .leading)
              .obPop()
          }
        case .failed:
          Text(problem ?? "That didn't work.").font(.system(size: 15)).foregroundStyle(Palette.text).multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true).accessibilityLabel("Error: \(problem ?? "That didn't work.")")
          if let resign, resign == "claude-code" || resign == "codex" {
            Button("Sign in again") { choose(resign == "claude-code" ? .claude : .chatgpt) }.buttonStyle(ObPrimary(height: 36))
          } else {
            Button("Try again") { if let cur { choose(cur); if case .harness(let h) = cur { Task { await tryIt(h, nil) } } } }.buttonStyle(ObOutline(height: 36))
          }
        }
      }
    }
    .frame(maxWidth: .infinity).frame(minHeight: 200, alignment: .top)
    .padding(.top, 6)
    .id(OnboardingFocus.id)
  }

  // MARK: picking

  private func reload() async {
    if let r = try? await store.modelProviders() { providers = r.providers; support = r.support }
    connections = (try? await store.modelConnections()) ?? connections
  }

  private func choose(_ p: OnboardingAI.Pick) {
    run += 1
    pick = p
    phase = .idle
    problem = nil
    stage.react(.nod)
    switch p {
    case .found: Task { await takeFound() }
    case .claude, .chatgpt, .grok: connect = OnboardingAI.provider(of: p).map(Connect.provider)
    case .key: connect = .list
    case .harness: break
    }
  }

  /** A sign-in or key just became a connection Bubble AI keeps: try the agent on it. */
  private func connected(_ connectionId: String) {
    connect = nil
    Task {
      await reload()
      let c = connections.first { $0.id == connectionId }
      let provider = c?.provider ?? cur.flatMap(OnboardingAI.provider(of:)) ?? "openrouter"
      let h = OnboardingAI.harness(for: provider, kind: c?.kind ?? "oauth", providers: providers, support: support)
      await tryIt(h, connectionId.isEmpty ? nil : connectionId)
    }
  }

  private func takeFound() async {
    guard let found, let device else { return }
    guard found.share else { return await tryIt(found.harness, found.connectionId) }
    phase = .checking
    harness = found.harness
    // Codex's own sign-in becomes a connection Bubble AI keeps; if it can't be shared, it's used where it is
    let body: Fields = ["provider": AnyEncodable("openai"), "nodeId": AnyEncodable(device.id)]
    let shared: ModelConnection? = try? await store.fetch { try await $0.post("/api/model-connections/import", body) }
    await reload()
    await tryIt(found.harness, shared?.id)
  }

  // MARK: making it and waiting for its hello

  private struct NeedsSignIn: LocalizedError { var harness: String; var errorDescription: String? }

  /** Make (or point) the agent at this AI, then wait until it can answer. */
  private func tryIt(_ h: String, _ connectionId: String?) async {
    guard let device else { problem = "Waiting for a computer to connect."; phase = .failed; return }
    run += 1
    let n = run
    func live() -> Bool { run == n && !Task.isCancelled }
    harness = h
    phase = .checking
    trying = .signIn
    hello = nil; problem = nil; resign = nil
    stage.react(.nod)
    let label = HarnessChoice.label(h)
    let needsSignIn = NeedsSignIn(harness: h, errorDescription: "\(label) on \(device.name) needs signing in again.")
    do {
      let agent: Agent
      if let id = agentId, store.agent(id) != nil {
        agent = try await store.updateAgent(id, ["harness": AnyEncodable(h), "settings": AnyEncodable(["connectionId": connectionId.map { AnyEncodable($0) } ?? .null] as Fields)])
      } else {
        agent = try await makeAgent(on: device, harness: h, connectionId: connectionId)
        OnboardingAnswers.save(workspaceId) { $0.agentId = agent.id }
        agentId = agent.id
      }
      if let draft {
        _ = try? await store.updateAgent(agent.id, ["instructions": AnyEncodable(draft.instructions), "settings": AnyEncodable(["role": AnyEncodable(draft.role)] as Fields)])
      }
      // the apps set up on "Pick your agent" are its own from the start, so its hello can read them
      try? await store.refreshConnectors()
      await AddAgent.giveAppsAndSkills(to: agent, apps: Set(OnboardingAnswers.load(workspaceId).apps), skills: [], store: store)
      try? await store.refreshAgents()
      await store.refreshComputers()
      // its AI answers where it runs, with no sign-in of its own left to do
      let deadline = Date().addingTimeInterval(3 * 60)
      while live(), Date() < deadline {
        let r = await store.agentHarnessStatus(agent.id)
        if let r, r.signedIn == true || (r.signedIn == nil && connectionId == nil && r.inComputer != true) {
          // a status check can say "signed in" for a session that can't refresh: its hello is the real
          // first run, and only a hello it wrote (or Bubble AI's, if it ran out of time) means it's ready
          trying = .hello
          while live(), Date() < deadline {
            if await store.agentHarnessStatus(agent.id)?.signedIn == false { throw needsSignIn }
            let g = await store.greet(agent.id)
            if g == "signin" { throw needsSignIn }
            if g == "already" || g == "sent" {
              guard live() else { return }
              trying = .ready
              phase = .ready
              stage.react(.hop)
              let text = await readHello(agent.id)
              if live() { hello = text }
              return
            }
            try await Task.sleep(for: .milliseconds(1500))
          }
          break
        }
        if r?.signedIn == false { throw API.Failure(status: 0, message: "\(label) isn't signed in on \(device.name) yet.") }
        try await Task.sleep(for: .seconds(2))
      }
      if live() { throw API.Failure(status: 0, message: "\(label) took too long to start.") }
    } catch {
      guard live() else { return }
      resign = (error as? NeedsSignIn)?.harness
      problem = error.localizedDescription
      phase = .failed
    }
  }

  /**
   * Make the first agent: on the model connection Bubble AI keeps for it when there is one, else on the
   * harness's own sign-in where it runs. Its hello is held until it's asked for (greet "later"),
   * so it can greet with what it was just told.
   */
  private func makeAgent(on device: AgentNode, harness h: String, connectionId: String?) async throws -> Agent {
    let installed = device.harnesses?.contains { $0.id == h } == true
    let canVm = device.role != "headless" && device.role != "screen" && device.capabilities?.vm?.ok == true
    let inVm = !installed && Readiness.runsInVm(h) && canVm
    if !installed && !inVm {
      _ = try await store.fetch { try await $0.raw("POST", "/api/nodes/\(device.id)/install", body: ["harness": h]) }
      _ = try? await store.fetch { try await $0.raw("POST", "/api/nodes/\(device.id)/refresh", body: Empty()) }
    }
    var fields: Fields = ["name": AnyEncodable(name), "handle": AnyEncodable(OnboardingText.freeHandle(name, taken: store.agents.map(\.handle))),
                          "harness": AnyEncodable(h), "nodeId": AnyEncodable(device.id), "greet": AnyEncodable("later")]
    var settings: Fields = ["appearance": AnyEncodable(look)]
    if let connectionId { settings["connectionId"] = AnyEncodable(connectionId) }
    if inVm {
      // an AI that only runs inside a computer gets one of its own, with the AI in it
      var computer = store.computers.first { $0.kind == "vm" && $0.nodeId == device.id && ($0.agents ?? []).isEmpty }
      if computer == nil {
        let body: Fields = ["kind": AnyEncodable("vm"), "nodeId": AnyEncodable(device.id), "name": AnyEncodable("\(name)'s desk"), "cpus": AnyEncodable(2), "memoryGb": AnyEncodable(4)]
        let made: Computer = try await store.fetch { try await $0.post("/api/computers", body) }
        computer = made
      }
      fields["computerId"] = AnyEncodable(computer?.id ?? "")
      settings["runIn"] = AnyEncodable("computer")
    } else {
      // otherwise Bubble AI places it: the AI stays beside its sign-in, and it works on the shared computer
      fields["useDefaults"] = AnyEncodable(true)
    }
    fields["settings"] = AnyEncodable(settings)
    return try await store.createAgent(fields)
  }

  /** The hello it just said, from its chat (nil if it can't be read yet). */
  private func readHello(_ id: String) async -> String? {
    try? await store.refreshAgents()
    guard let setup = store.agent(id)?.settings?.setup, let channel = setup.channelId, let greeting = setup.greetingId else { return nil }
    try? await store.loadMessages(channel)
    guard let text = store.messages[channel]?.first(where: { $0.id == greeting })?.body.trimmed, !text.isEmpty else { return nil }
    return text.count > 280 ? String(text.prefix(277)).trimmed + "…" : text
  }

  private func proceed() async {
    if phase == .idle {
      // no computer yet: go on without an agent (it can be made later)
      if device == nil { return onDone(agentId, nil) }
      if cur == .found { await takeFound() }
      return
    }
    if phase == .checking { return }
    leaving = true
    var channelId: String?
    if let agentId, phase == .ready {
      // its hello comes now, in its chat
      _ = await store.greet(agentId)
      for _ in 0..<8 {
        await store.refreshChannels()
        channelId = store.dmChannel(of: agentId)?.id
        if channelId != nil { break }
        try? await Task.sleep(for: .seconds(1))
      }
      // what the first run switches on by itself (routines, a morning plan), each undoable on Here's your Bubble AI
      await switchOnRecommended(agentId, channelId: channelId)
    }
    onDone(agentId, channelId)
  }

  /** Once the agent exists: one morning routine built from "What I do", only when there's something to build it from. Runs once. */
  private func switchOnRecommended(_ agentId: String, channelId: String?) async {
    guard !OnboardingAnswers.load(workspaceId).setupDone else { return }
    if let plan = OnboardingText.morningPlan(person: person, role: draft?.role ?? "") {
      if store.role == "owner", !store.features.routines {
        var next = store.features
        next.routines = true
        try? await store.setFeatures(next)
      }
      let fields: Fields = ["agentId": AnyEncodable(agentId), "name": AnyEncodable(plan.name), "schedule": AnyEncodable(plan.schedule),
                            "timezone": AnyEncodable(TimeZone.current.identifier), "channelId": channelId.map { AnyEncodable($0) } ?? .null]
      try? await store.saveRoutine(nil, fields: fields, steps: plan.steps)
    }
    OnboardingAnswers.save(workspaceId) { $0.setupDone = true }
  }
}

/** One thing it can think with: a line icon, its name (and "Found on …"), a line under it, and the round mark. */
private struct AIChoice: View {
  var on: Bool
  var title: String
  var sub: String
  var symbol: String
  var badge: String?
  var action: () -> Void
  @ReduceMotion private var reduceMotion

  var body: some View {
    Button(action: action) {
      HStack(spacing: 14) {
        Image(systemName: symbol).font(.system(size: 16)).foregroundStyle(Palette.muted).frame(width: 22)
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 8) {
            Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.text)
            if let badge {
              Text(badge).font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
                .padding(.horizontal, 8).frame(height: 20).background(Capsule().fill(Color(hex: OnboardingText.colors[0]).opacity(0.18)))
            }
          }
          Text(sub).font(.system(size: 13)).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
        }
        Spacer(minLength: 8)
        ChoiceMark(on: on)
      }
      .padding(.horizontal, 16).padding(.vertical, 12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).fill(Palette.card))
      .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(on ? Palette.text : Palette.cardBorder, lineWidth: on ? 2 : 1))
      .contentShape(RoundedRectangle(cornerRadius: Corner.card, style: .continuous))
    }
    .buttonStyle(.pressRow)
    .animation(Motion.pick(Motion.pop, reduceMotion), value: on)
    .accessibilityLabel("\(title). \(sub)")
    .accessibilityAddTraits(on ? .isSelected : [])
  }
}

/** One of the three live steps: a dot before it, a spinner while it runs, a check that draws when it's done. */
private struct LiveStep: View {
  enum Progress { case later, now, done }
  var state: Progress
  var text: String

  var body: some View {
    HStack(spacing: 10) {
      Group {
        switch state {
        case .done: DrawnCheck(size: 15)
        case .now: ProgressView().controlSize(.small)
        case .later: Circle().fill(Palette.hairline).frame(width: 6, height: 6)
        }
      }
      .frame(width: 16, height: 16)
      Text(text).font(.system(size: 15)).foregroundStyle(state == .later ? Palette.faint : Palette.text)
    }
    .accessibilityElement(children: .combine)
    .accessibilityValue(state == .done ? "Done" : state == .now ? "In progress" : "Not started")
  }
}
