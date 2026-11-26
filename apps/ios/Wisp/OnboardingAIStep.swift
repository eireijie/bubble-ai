import SwiftUI

/** What the first agent can run on, and the rules for picking it (AIStep.tsx). */
enum OnboardingAI {
  /** What's already set to go: a connection Bubble AI keeps, or a harness signed in on the computer. */
  struct Found: Equatable { var harness: String; var connectionId: String?; var share = false }

  /** The harnesses a connection is tried on, best first: the one the provider makes, then the open ones. */
  static let preferred = ["claude-code", "codex", "hermes", "opencode", "goose"]

  /** The three apps most people already use, shown big; Hermes runs any of the big model companies. */
  static let featured: [(harness: String, sub: String, provider: String?)] = [
    ("claude-code", "Claude models", "anthropic"),
    ("codex", "ChatGPT models", "openai"),
    ("hermes", "Claude, ChatGPT, Grok, Gemini", nil),
  ]
  /** every other app an agent can run on, smaller, under "More apps" */
  static var more: [HarnessChoice] { HarnessChoice.all.filter { h in h.protocolName != "mcp" && !featured.contains { $0.harness == h.id } } }

  /** The best harness for a provider and kind of connection, from the shared support table. */
  static func harness(for provider: String, kind: String, providers: [ModelProviderInfo], support: [CredentialSupport]) -> String {
    let own = providers.first { $0.id == provider }?.signIn?.first?.harness
    if kind == "oauth", let own { return own }
    return preferred.first { h in support.contains { $0.harness == h && $0.provider == provider && $0.kind == kind } } ?? own ?? "hermes"
  }

  /**
   * What's already set to go on the person's computer, best first: a connection Bubble AI keeps,
   * then a harness signed in there. With `only`, just that harness, so each row can say "Signed in".
   */
  static func found(on device: AgentNode?, connections: [ModelConnection], support: [CredentialSupport], only: String? = nil) -> Found? {
    func wanted(_ h: String) -> Bool { only == nil || only == h }
    for h in ["claude-code", "codex"] where wanted(h) {
      if let c = connections.first(where: { $0.mine == true && $0.lastError == nil && ModelWords.supports(h, $0, support: support) }) { return Found(harness: h, connectionId: c.id) }
    }
    func signedIn(_ id: String) -> Bool { wanted(id) && (device?.harnesses?.first { $0.id == id }?.accounts?["default"] ?? nil) == true }
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

  /** The one button under the apps, for what's picked: use it, install it, or sign in to it. */
  enum Next: Equatable { case none, use, install, signIn, model }
  static func next(_ harness: String?, signedIn: Bool, installed: Bool, hasDevice: Bool) -> Next {
    guard let harness else { return .none }
    if signedIn { return .use }
    if harness == "hermes" { return .model }
    if hasDevice && !installed { return .install }
    return .signIn
  }
}

/**
 * "Which AI app runs it?" (canvas iPhone board): every app an agent can run on, each with its own
 * logo; the three most people use are big, the rest sit in a grid. What's already signed in on your
 * computer says so and is picked for you. The one button under them does what the picked app needs:
 * Use it, Install it on your computer (Claude Code missing there is offered, not a dead end), or
 * Sign in (Claude and ChatGPT through Bubble AI, Hermes with the model company you pick, the rest
 * on the computer). Then the agent is pointed at it and the page moves on only once it has really
 * answered. "Set up later" keeps the agent, on an AI app that's really on your computer.
 */
struct OnboardingAIStep: View {
  @Environment(Store.self) private var store
  @Environment(HostStage.self) private var stage
  var workspaceId: String
  var agentId: String
  var onBusy: (Bool) -> Void
  /** it answered (true), or Set up later (false) */
  var onDone: (_ answered: Bool) -> Void

  private enum Phase: Equatable { case idle, working(String), failed }
  private enum Sheet: Identifiable {
    case provider(String, harness: String), models, harness(AgentSignInButton.Target)
    var id: String {
      switch self {
      case .provider(let p, let h): "p/\(p)/\(h)"
      case .models: "models"
      case .harness(let t): "h/\(t.id)"
      }
    }
  }

  @State private var sel: String?
  @State private var phase = Phase.idle
  @State private var problem: String?
  /** its first run couldn't sign in (an expired session): sign in again */
  @State private var resign: String?
  /** what failed, to try again */
  @State private var retry: (() -> Void)?
  @State private var connections: [ModelConnection] = []
  @State private var providers: [ModelProviderInfo] = []
  @State private var support: [CredentialSupport] = []
  @State private var sheet: Sheet?
  @State private var path: [String] = []
  @State private var justInstalled: Set<String> = []
  @State private var leaving = false
  @State private var run = 0
  @State private var loaded = false
  @ReduceMotion private var reduceMotion

  private var agent: Agent? { store.agent(agentId) }
  private var name: String { agent?.name ?? "your agent" }
  private var device: AgentNode? { OnboardingAI.device(store.nodes) }
  private var working: Bool { if case .working = phase { true } else { false } }
  private func signedIn(_ h: String) -> Bool { OnboardingAI.found(on: device, connections: connections, support: support, only: h) != nil }
  private func installed(_ h: String) -> Bool { justInstalled.contains(h) || device?.harnesses?.contains { $0.id == h } == true }
  private var next: OnboardingAI.Next { OnboardingAI.next(sel, signedIn: sel.map(signedIn) ?? false, installed: sel.map(installed) ?? false, hasDevice: device != nil) }

  private var cta: String {
    let label = sel.map(HarnessChoice.label) ?? ""
    if device == nil && loaded { return "Continue" }
    switch next {
    case .none: return "Continue"
    case .use: return "Use \(label)"
    case .install: return "Install \(label)"
    case .signIn: return "Sign in to \(label)"
    case .model: return "Choose a model"
    }
  }

  var body: some View {
    ObScreen(top: 64, focus: phase == .idle ? nil : "\(phase)") {
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 12) {
          ObSlot(size: 44)
          Text("Which AI app runs \(name)?").obTitle(22, center: false)
        }
        .padding(.bottom, 4)
        VStack(spacing: 8) {
          ForEach(OnboardingAI.featured, id: \.harness) { f in
            Button { pick(f.harness) } label: {
              HStack(spacing: 12) {
                BrandLogo(id: f.harness, size: 30)
                VStack(alignment: .leading, spacing: 1) {
                  Text(HarnessChoice.label(f.harness)).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.text)
                  Text(f.sub).font(.system(size: 13)).foregroundStyle(Palette.muted).lineLimit(1)
                }
                Spacer(minLength: 8)
                if signedIn(f.harness) {
                  Text("Signed in").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.statusOnlineText)
                }
              }
              .padding(14)
              .obTile(sel == f.harness)
            }
            .buttonStyle(.pressRow)
            .disabled(working && sel != f.harness)
            .accessibilityLabel("\(HarnessChoice.label(f.harness)), runs \(f.sub)\(signedIn(f.harness) ? ", signed in" : "")")
            .accessibilityAddTraits(sel == f.harness ? .isSelected : [])
            .accessibilityIdentifier("ob-ai-\(f.harness)")
          }
        }
        ObLabel(text: "More apps")
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
          ForEach(OnboardingAI.more) { h in
            Button { pick(h.id) } label: {
              HStack(spacing: 8) {
                BrandLogo(id: h.id, size: 22)
                Text(h.label).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
                Spacer(minLength: 0)
                if signedIn(h.id) {
                  Image(systemName: "checkmark").font(.system(size: 8, weight: .heavy)).foregroundStyle(.white)
                    .frame(width: 15, height: 15).background(Circle().fill(Palette.statusOnline))
                }
              }
              .padding(.horizontal, 10).frame(height: 46)
              .obTile(sel == h.id, radius: 12)
            }
            .buttonStyle(.pressRow)
            .disabled(working && sel != h.id)
            .accessibilityLabel("\(h.label)\(signedIn(h.id) ? ", signed in" : "")")
            .accessibilityAddTraits(sel == h.id ? .isSelected : [])
            .accessibilityIdentifier("ob-ai-\(h.id)")
          }
        }
        status.id(OnboardingFocus.id)
      }
      .animation(Motion.pick(Motion.soft, reduceMotion), value: phase)
      .animation(Motion.pick(Motion.pop, reduceMotion), value: sel)
    } bottom: {
      if !leaving && !working {
        Button("Set up later") { Task { await later() } }.buttonStyle(ObQuiet()).accessibilityIdentifier("ob-ai-later")
      }
      Button(leaving ? "Opening…" : cta) { primary() }
        .buttonStyle(ObWide())
        .disabled(leaving || working || (next == .none && device != nil) || !loaded)
        .contentTransition(.opacity)
        .accessibilityIdentifier("ob-ai-next")
    }
    .sheet(item: $sheet, onDismiss: { path = [] }) { which in
      switch which {
      case .provider(let p, let h):
        NavigationStack { ConnectProviderView(provider: p) { cid in connected(cid, harness: h) } }
          .environment(store).presentationCornerRadius(Corner.sheet)
      case .models:
        NavigationStack(path: $path) {
          ConnectModelList { path.append($0) }
            .navigationDestination(for: String.self) { p in ConnectProviderView(provider: p) { cid in connected(cid, harness: "hermes") } }
        }
        .environment(store).presentationCornerRadius(Corner.sheet)
      case .harness(let t):
        HarnessSignInSheet(device: t.device, settings: t.settings, account: t.account) {
          let h = t.settings.harness
          Task { try? await store.refreshNodes(); await tryIt(h, nil) }
        }
        .environment(store)
      }
    }
    .task {
      guard !loaded else { return }
      async let nodes: Void? = try? store.refreshNodes()
      async let computers: Void = store.refreshComputers()
      await reload()
      _ = await (nodes, computers)
      // what's already signed in on the computer is picked for you
      sel = OnboardingAI.found(on: device, connections: connections, support: support)?.harness ?? "claude-code"
      loaded = true
    }
    .onChange(of: working) { _, w in onBusy(w) }
    .onDisappear { run += 1; onBusy(false) }
  }

  /** What's happening under the apps: a spinner with what it's doing, or what went wrong and one fix. */
  @ViewBuilder private var status: some View {
    switch phase {
    case .idle:
      if device == nil && loaded {
        Text("Waiting for a computer to connect").font(.system(size: 13)).foregroundStyle(Palette.muted)
          .frame(maxWidth: .infinity).padding(.top, 10)
      }
    case .working(let text):
      HStack(spacing: 10) {
        ProgressView().controlSize(.small)
        Text(text).font(.system(size: 15)).foregroundStyle(Palette.text)
      }
      .frame(maxWidth: .infinity).padding(.top, 14)
      .obPop()
      .accessibilityElement(children: .combine)
      .accessibilityIdentifier("ob-ai-status")
    case .failed:
      VStack(spacing: 10) {
        Text(problem ?? "That didn't work.").font(.system(size: 15)).foregroundStyle(Palette.text).multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true).accessibilityLabel("Error: \(problem ?? "That didn't work.")")
        Button(resign != nil ? "Sign in again" : "Try again") {
          if let resign { sel = resign; phase = .idle; problem = nil; primary(force: true) } else { retry?() }
        }
        .buttonStyle(ObOutline(height: 36))
        .accessibilityIdentifier("ob-ai-retry")
      }
      .frame(maxWidth: .infinity).padding(.top, 14)
      .obPop()
    }
  }

  // MARK: picking

  private func reload() async {
    if let r = try? await store.modelProviders() { providers = r.providers; support = r.support }
    connections = (try? await store.modelConnections()) ?? connections
  }

  private func pick(_ h: String) {
    guard !working else { return }
    run += 1
    sel = h
    phase = .idle
    problem = nil
    stage.answer(.nod, reduceMotion: reduceMotion)
  }

  private func fail(_ text: String, resign h: String? = nil) {
    resign = h
    problem = text
    phase = .failed
  }

  /** The button under the apps. `force`: sign in again even if it says signed in. */
  private func primary(force: Bool = false) {
    guard let sel else { if device == nil { Task { await later() } }; return }
    guard device != nil else { Task { await later() }; return }
    let n = force ? (sel == "hermes" ? .model : installed(sel) ? .signIn : .install) : next
    switch n {
    case .none: return
    case .use: Task { await use(sel) }
    case .install: Task { await install(sel) }
    case .model: sheet = .models
    case .signIn:
      if let p = OnboardingAI.featured.first(where: { $0.harness == sel })?.provider { sheet = .provider(p, harness: sel) }
      else { Task { await harnessSignIn(sel) } }
    }
  }

  /** Signed in already: share Codex's own sign-in when it can be, else use it where it is. */
  private func use(_ h: String) async {
    guard let found = OnboardingAI.found(on: device, connections: connections, support: support, only: h), let device else { return }
    guard found.share else { return await tryIt(found.harness, found.connectionId) }
    phase = .working("Signing in to \(HarnessChoice.label(h))")
    let body: Fields = ["provider": AnyEncodable("openai"), "nodeId": AnyEncodable(device.id)]
    let shared: ModelConnection? = try? await store.fetch { try await $0.post("/api/model-connections/import", body) }
    await reload()
    await tryIt(found.harness, shared?.id)
  }

  /** Install it on the computer and stay here: its sign-in comes next. */
  private func install(_ h: String) async {
    guard let device else { return fail("Waiting for a computer to connect.") }
    retry = { Task { await install(h) } }
    phase = .working("Installing \(HarnessChoice.label(h)) on \(device.name)")
    do {
      _ = try await store.installHarness(h, node: device.id)
      justInstalled.insert(h)
      phase = .idle
      stage.react(.grab)
    } catch {
      fail(error.localizedDescription)
    }
  }

  /** A harness that keeps its sign-in on the computer: its own sign-in, right here. */
  private func harnessSignIn(_ h: String) async {
    guard let device else { return fail("Waiting for a computer to connect.") }
    retry = { Task { await harnessSignIn(h) } }
    do {
      let r = try await store.harnessSettings(device: device.id, harness: h, account: "default")
      guard let s = r.harnesses.first(where: { $0.harness == h }), let acct = s.accounts.first(where: \.isDefault) ?? s.accounts.first else {
        throw API.Failure(status: 0, message: "\(HarnessChoice.label(h)) isn't on \(device.name) yet.")
      }
      sheet = .harness(AgentSignInButton.Target(device: r.device, settings: s, account: acct))
    } catch {
      fail(error.localizedDescription)
    }
  }

  /** A sign-in or key just became a connection Bubble AI keeps: run the agent on it. */
  private func connected(_ connectionId: String, harness wanted: String) {
    sheet = nil
    Task {
      await reload()
      let c = connections.first { $0.id == connectionId }
      var h = wanted
      if let c, !ModelWords.supports(wanted, c, support: support) { h = OnboardingAI.harness(for: c.provider, kind: c.kind, providers: providers, support: support) }
      await tryIt(h, connectionId.isEmpty ? nil : connectionId)
    }
  }

  // MARK: running it and waiting for its hello

  private struct NeedsSignIn: LocalizedError { var harness: String; var errorDescription: String? }

  /** Point the agent at this AI, then wait until it has really answered (its hello). */
  private func tryIt(_ h: String, _ connectionId: String?) async {
    guard let device else { return fail("Waiting for a computer to connect.") }
    run += 1
    let n = run
    func live() -> Bool { run == n && !Task.isCancelled }
    retry = { Task { await tryIt(h, connectionId) } }
    resign = nil; problem = nil
    let label = HarnessChoice.label(h)
    phase = .working("Signing in to \(label)")
    let needsSignIn = NeedsSignIn(harness: h, errorDescription: "\(label) on \(device.name) needs signing in again.")
    do {
      try await point(h, connectionId: connectionId, on: device)
      await store.refreshComputers()
      let deadline = Date().addingTimeInterval(3 * 60)
      while live(), Date() < deadline {
        let r = await store.agentHarnessStatus(agentId)
        if let r, r.signedIn == true || (r.signedIn == nil && connectionId == nil && r.inComputer != true) {
          // a status check can say "signed in" for a session that can't refresh: only its hello, its real first run, counts
          phase = .working("\(name) is saying hello")
          while live(), Date() < deadline {
            if await store.agentHarnessStatus(agentId)?.signedIn == false { throw needsSignIn }
            let g = await store.greet(agentId)
            if g == "signin" { throw needsSignIn }
            if g == "already" || g == "sent" {
              guard live() else { return }
              phase = .working("Opening")
              stage.react(.celebrate)
              try? await Task.sleep(for: .milliseconds(600))
              if live() { onDone(true) }
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
      fail(error.localizedDescription, resign: (error as? NeedsSignIn)?.harness)
    }
  }

  /**
   * The agent made on "Your agent" now runs on this AI: on the model connection Bubble AI keeps
   * when there is one, else on the harness's own sign-in where it runs. An AI that only runs
   * inside a computer gets one of its own; one missing on the computer is installed first.
   */
  private func point(_ h: String, connectionId: String?, on device: AgentNode) async throws {
    let installed = installed(h)
    let canVm = device.role != "headless" && device.role != "screen" && device.capabilities?.vm?.ok == true
    let inVm = !installed && Readiness.runsInVm(h) && canVm
    if !installed && !inVm {
      phase = .working("Installing \(HarnessChoice.label(h)) on \(device.name)")
      _ = try await store.installHarness(h, node: device.id)
      justInstalled.insert(h)
      phase = .working("Signing in to \(HarnessChoice.label(h))")
    }
    var fields: Fields = ["harness": AnyEncodable(h), "nodeId": AnyEncodable(device.id)]
    var settings: Fields = ["connectionId": connectionId.map { AnyEncodable($0) } ?? .null]
    if inVm {
      var computer = store.computers.first { $0.kind == "vm" && $0.nodeId == device.id && ($0.agents ?? []).isEmpty }
      if computer == nil {
        let body: Fields = ["kind": AnyEncodable("vm"), "nodeId": AnyEncodable(device.id), "name": AnyEncodable("\(name)'s desk"), "cpus": AnyEncodable(2), "memoryGb": AnyEncodable(4)]
        let made: Computer = try await store.fetch { try await $0.post("/api/computers", body) }
        computer = made
      }
      fields["computerId"] = AnyEncodable(computer?.id ?? "")
      settings["runIn"] = AnyEncodable("computer")
    }
    fields["settings"] = AnyEncodable(settings)
    _ = try await store.updateAgent(agentId, fields)
    // the apps set up earlier are its own from the start, so its hello can read them
    try? await store.refreshConnectors()
    if let agent { await AddAgent.giveAppsAndSkills(to: agent, apps: Set(OnboardingAnswers.load(workspaceId).apps), skills: [], store: store) }
    try? await store.refreshAgents()
  }

  /**
   * "Set up later": the agent stays, on this computer and on an AI app that's really here (one
   * signed in first), not "Claude Code, no device yet". It says hello anyway, saying what it still
   * needs, and the first run carries on.
   */
  private func later() async {
    run += 1
    leaving = true
    phase = .idle
    if let device, let agent {
      let ready = OnboardingAI.found(on: device, connections: connections, support: support)
      let here = HarnessChoice.all.first { h in h.protocolName != "mcp" && device.harnesses?.contains { $0.id == h.id } == true }?.id
      let harness = ready?.harness ?? here ?? agent.harness
      var patch: Fields = [:]
      if harness != agent.harness { patch["harness"] = AnyEncodable(harness) }
      if agent.nodeId == nil { patch["nodeId"] = AnyEncodable(device.id) }
      if let cid = ready?.connectionId { patch["settings"] = AnyEncodable(["connectionId": AnyEncodable(cid)] as Fields) }
      if !patch.isEmpty { _ = try? await store.updateAgent(agent.id, patch) }
      try? await store.refreshAgents()
    }
    _ = await store.greet(agentId)
    leaving = false
    onDone(false)
  }
}
