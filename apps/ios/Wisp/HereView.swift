import AVFAudio
import SwiftUI

/**
 * "Here's your Bubble AI": what setup really turned on, read from the hub, ticking in one by one. Each
 * row can be undone where Bubble AI has a way to (routines and watches pause, mods turn off); what
 * isn't ready says so with the one step that fixes it. Below, "When you're ready", which stays in
 * More as "Finish setup" until it's done.
 */
struct HereView: View {
  @Environment(Store.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  var agentId: String? = nil
  /** opened from its chat: "Back to …" just goes back */
  var fromChat = false

  private struct Row: Identifiable {
    var id: String
    var symbol: String
    var title: String
    var sub: String
    var warn = false
    /** not done yet (no check, not counted as ready), without the warning colour */
    var pending = false
    /** Undo/Redo: `off` is the undone state */
    var toggle: (off: Bool, run: (Bool) async throws -> Void)? = nil
    var action: (label: String, run: () -> Void)? = nil
    var ready: Bool { !warn && !pending && toggle?.off != true }
  }
  private enum Place: Hashable { case agent(Agent), apps, logins, apple, harnesses }

  @State private var routines: [Routine]?
  @State private var watches: [AppWatch]?
  @State private var apps: [String]?
  @State private var notes: Int?
  @State private var shown = 0
  /** mods that were on when the page opened: undoing one keeps its row, as "Undone." */
  @State private var mods: [FeatureKey]?
  @State private var firstLook = false
  @State private var cheered = false
  @State private var place: Place?
  @State private var addingAgent = false
  @State private var ticks = 0
  @State private var stage = HostStage()
  @ReduceMotion private var reduceMotion

  private var workspaceId: String { store.workspace?.id ?? "" }
  private var agent: Agent? {
    if let agentId { return store.agent(agentId) }
    let mine = store.agents.filter { $0.settings?.setup?.userId == store.me?.id }
    return mine.max { ($0.settings?.setup?.startedAt ?? "") < ($1.settings?.setup?.startedAt ?? "") } ?? store.agents.first
  }
  private var first: String { store.me?.preferredName ?? OnboardingText.first(store.me?.name ?? "") }
  private var loading: Bool { agent != nil && (routines == nil || watches == nil || apps == nil) }
  private var filling: Bool { loading || shown < rows.count }

  var body: some View {
    let rows = self.rows
    let readyTotal = rows.count
    let readyCount = rows.prefix(shown).filter(\.ready).count
    VStack(spacing: 0) {
      HStack { CircleButton(symbol: "chevron.left", label: "Back", id: "here-back") { dismiss() }; Spacer() }
        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 6)
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          HostGhost(look: agent?.settings?.appearance ?? OnboardingLook.host, size: 64, mood: filling ? .working : .awake, happy: !filling)
          Text("Here's your Bubble AI, \(first).").font(.system(size: 22, weight: .semibold)).tracking(-0.4).foregroundStyle(Palette.text)
            .fixedSize(horizontal: false, vertical: true).padding(.top, 16).accessibilityAddTraits(.isHeader)
          Text("I set this up from your answers. Undo anything.").font(.system(size: 15)).foregroundStyle(Palette.muted).padding(.top, 4)
          if readyTotal > 0 {
            (Text("\(readyCount)").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.text) + Text(" of \(readyTotal) ready").font(.system(size: 13)).foregroundStyle(Palette.muted))
              .monospacedDigit().contentTransition(reduceMotion ? .identity : .numericText(value: Double(readyCount)))
              .animation(Motion.pick(Motion.soft, reduceMotion), value: readyCount)
              .padding(.top, 10).accessibilityIdentifier("here-count")
          }
          CardGroup {
            ForEach(rows.prefix(shown)) { r in HereRow(symbol: r.symbol, title: r.title, sub: r.sub, warn: r.warn, ready: r.ready, toggle: r.toggle, action: r.action).transition(rise) }
            if loading { Text("Checking…").font(.system(size: 13)).foregroundStyle(Palette.faint).padding(.horizontal, 14).frame(height: 44) }
          }
          .padding(.top, 20)
          if let agent {
            Button("Back to \(agent.name)") { back(agent) }.buttonStyle(ObPrimary()).padding(.top, 20).accessibilityIdentifier("here-back-to-agent")
          }
          ready.padding(.top, 28)
          VStack(alignment: .leading, spacing: 8) {
            Text("Thanks for trying Bubble AI. Your agents will get things wrong sometimes. Tell them, and they'll remember.").font(.system(size: 15)).foregroundStyle(Palette.text).fixedSize(horizontal: false, vertical: true)
            Text("The Bubble AI team").font(.system(size: 13)).foregroundStyle(Palette.muted)
          }
          .padding(16).frame(maxWidth: .infinity, alignment: .leading)
          .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(Palette.cardBorder))
          .padding(.top, 14)
        }
        .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 40)
        .frame(maxWidth: 560).frame(maxWidth: .infinity)
        .animation(Motion.pick(.spring(response: 0.42, dampingFraction: 0.9), reduceMotion), value: shown)
      }
    }
    .background(Palette.ground.ignoresSafeArea())
    .toolbar(.hidden, for: .navigationBar)
    .toolbar(.hidden, for: .tabBar)
    .environment(stage)
    .navigationDestination(item: $place) { p in
      switch p {
      case .agent(let a): AgentPage(agent: a)
      case .apps: MarketplaceView()
      case .logins: LoginsView()
      case .apple: AppleView()
      case .harnesses: HarnessesView()
      }
    }
    .sheet(isPresented: $addingAgent) { AddAgent { _ in } }
    .task(id: agent?.id) { await load() }
    // rows tick in one by one
    .task(id: "\(loading)/\(shown)/\(rows.count)") {
      guard !loading, shown < rows.count else {
        if !loading, !cheered, firstLook, shown >= rows.count, !rows.isEmpty {
          // the first look at this page ends in one celebration; coming back later doesn't repeat it
          cheered = true
          try? await Task.sleep(for: .milliseconds(450))
          stage.react(.celebrate)
        }
        return
      }
      if reduceMotion { shown = rows.count; return }
      try? await Task.sleep(for: .milliseconds(shown == 0 ? 250 : 140))
      if !Task.isCancelled { shown += 1 }
    }
    .accessibilityIdentifier("screen-here")
  }

  private var rise: AnyTransition { reduceMotion ? .opacity : .offset(y: 10).combined(with: .opacity) }

  // MARK: what's set up

  private var rows: [Row] {
    var rows: [Row] = []
    if let agent {
      let knows = (notes ?? 0) > 0 ? "Knows \(notes!) thing\(notes == 1 ? "" : "s") about you." : "Nothing in its notes yet."
      // only says it runs when it can: a harness that isn't installed or signed in where it runs says so, with the fix
      let label = HarnessChoice.label(agent.harness)
      if let node = store.missingHarness(agent) {
        rows.append(Row(id: "agent", symbol: "person", title: agent.name, sub: "\(label) isn't installed on \(node.name), so it can't answer yet.", warn: true, action: ("Install", { place = .harnesses })))
      } else if let signIn = agent.signIn {
        rows.append(Row(id: "agent", symbol: "person", title: agent.name, sub: "\(HarnessChoice.label(signIn.harness)) isn't signed in on \(signIn.where_), so it can't answer yet.", warn: true, action: ("Sign in", { place = .agent(agent) })))
      } else {
        rows.append(Row(id: "agent", symbol: "person", title: agent.name, sub: "Runs on \(label). \(knows)", action: ("Change", { place = .agent(agent) })))
      }
      if let computer = agent.computerId.flatMap({ id in store.computers.first { $0.id == id } }) {
        let shared = store.agents.filter { $0.computerId == computer.id }.count > 1
        let sub = computer.status == "ready" ? "Started. \(shared ? "Your agents take turns on it." : "\(agent.name) works on it.")" : "Starts when \(agent.name) needs it."
        rows.append(Row(id: "computer", symbol: "desktopcomputer", title: shared ? "Shared computer" : computer.name, sub: sub, action: ("Change", { place = .agent(agent) })))
      }
      // the apps it can read, set up on "Pick your agent": read only until the person says yes
      if let apps {
        rows.append(apps.isEmpty
          ? Row(id: "apps", symbol: "square.grid.2x2", title: "Apps", sub: "None yet.", pending: true, action: ("Add", { place = .apps }))
          : Row(id: "apps", symbol: "square.grid.2x2", title: "Apps", sub: "\(OnboardingText.list(apps)). Read only until you say yes.", action: ("Add", { place = .apps })))
      }
      // an Apple app it was given that the Mac won't let it read yet (Full Disk Access, …)
      for (app, problem) in appleProblems(agent) {
        rows.append(Row(id: "apple:\(app.rawValue)", symbol: "applelogo", title: app.name, sub: problem, warn: true, action: ("Fix", { place = .apple })))
      }
      for r in routines ?? [] {
        rows.append(Row(id: "r:\(r.id)", symbol: "clock", title: r.name, sub: OnboardingText.cronLine(r.schedule), toggle: (r.enabled == false, { off in
          try await store.setRoutineEnabled(r.id, !off)
          routines = routines?.map { x in var x = x; if x.id == r.id { x.enabled = !off }; return x }
        })))
      }
      for w in watches ?? [] {
        rows.append(Row(id: "w:\(w.id)", symbol: "eye", title: "Watching \(w.label)", sub: "Tells you when something needs you.", toggle: (w.paused, { off in
          try await store.setWatchPaused(w.id, off)
          watches = watches?.map { x in var x = x; if x.id == w.id { x.paused = off }; return x }
        })))
      }
    }
    for k in mods ?? [] {
      let toggle: (off: Bool, run: (Bool) async throws -> Void)? = store.role == "owner" ? (!store.features[k], { off in
        var next = store.features
        next[k] = !off
        try await store.setFeatures(next)
      }) : nil
      rows.append(Row(id: "m:\(k.rawValue)", symbol: "puzzlepiece", title: "\(k.name) mod", sub: "Turned on.", toggle: toggle))
    }
    // asked for only after its first finished job (in its chat); until then it waits, uncounted
    let status = store.notificationStatus
    let on = store.pushAvailable && [.authorized, .provisional, .ephemeral].contains(status)
    rows.append(Row(id: "notif", symbol: "bell", title: "Notifications",
                    sub: on ? "On. Only when something's done or needs a yes." : !store.pushAvailable ? "Your Bubble AI isn't set up to send them yet." : status == .denied ? "Off for Bubble AI." : "I'll ask after my first finished job.",
                    pending: !on,
                    action: store.pushAvailable && status == .denied ? ("Open the switch", { if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) } }) : nil))
    if let agent {
      // calls need the microphone: only ready once it's allowed
      switch AVAudioApplication.shared.recordPermission {
      case .granted:
        rows.append(Row(id: "calls", symbol: "phone", title: "Calls", sub: "Ready. Call \(agent.name) from the top of its chat."))
      case .denied:
        rows.append(Row(id: "calls", symbol: "phone", title: "Calls", sub: "The microphone is off for Bubble AI.", warn: true,
                        action: ("Turn on", { if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) } })))
      default:
        rows.append(Row(id: "calls", symbol: "phone", title: "Calls", sub: "Asks for the microphone on your first call.", pending: true))
      }
    }
    return rows
  }

  /** Apple apps this agent was given that its Mac can't read yet, each with what's missing. */
  private func appleProblems(_ agent: Agent) -> [(AppleApp, String)] {
    guard store.features.apple, let apple = store.apple, apple.settings.allAgents || apple.settings.agentIds.contains(agent.id), let mac = apple.mac else { return [] }
    return [AppleApp.messages, .calendar, .reminders, .contacts].compactMap { app in
      guard apple.settings.levels[app] > 0 else { return nil }
      if !mac.online { return (app, "\(mac.name) is offline.") }
      return mac.status?.problem(for: app, mac: mac.name).map { (app, $0) }
    }
  }

  private func load() async {
    guard let agent else { return }
    if mods == nil { mods = FeatureKey.allCases.filter { store.features[$0] && !Features.simple[$0] } }
    firstLook = !WispPreferences.standard.bool(forKey: FirstChat.hereSeenKey(agent.id))
    WispPreferences.standard.set(true, forKey: FirstChat.hereSeenKey(agent.id))
    if ReadyList.ticks(workspaceId)["started"] != true { ReadyList.set(workspaceId, "started", true) }
    async let routinesDone: Void? = try? store.refreshRoutines()
    async let connectorsDone: Void? = try? store.refreshConnectors()
    async let notesDone: Void? = try? store.refreshNotes()
    async let allWatches = store.watches()
    if store.features.apple { await store.refreshApple() }
    await store.refreshComputers()
    _ = await (routinesDone, connectorsDone, notesDone)
    routines = store.routines.filter { $0.agentId == agent.id }
    watches = await allWatches.filter { $0.agentIds.contains(agent.id) }
    apps = appNames(agent)
    let me = store.me?.id ?? ""
    notes = store.notes.filter { n in
      (n.path.hasPrefix("agents/\(agent.id)/") && !n.path.hasSuffix("/About.md") && !n.path.hasSuffix("/SOUL.md") && !n.path.contains("/skills/")) || n.path.hasPrefix("people/\(me)/")
    }.count
  }

  /** The apps this agent can read: its connected apps, then the Apple apps the Apple mod lets it read. */
  private func appNames(_ agent: Agent) -> [String] {
    var names = store.connectors.filter { $0.enabled != false && $0.has(agent.id) }.map(\.name)
    if store.features.apple, let apple = store.apple, apple.settings.allAgents || apple.settings.agentIds.contains(agent.id), !apple.macs.isEmpty {
      let blocked = Set(appleProblems(agent).map(\.0))
      for app in [AppleApp.messages, .calendar, .reminders, .contacts] where apple.settings.levels[app] > 0 && !blocked.contains(app) { names.append(app.name) }
    }
    return names
  }

  private func back(_ agent: Agent) {
    if fromChat { return dismiss() }
    Task {
      var channel = agent.settings?.setup?.channelId
      if channel == nil { channel = try? await store.dm(with: agent).id }
      dismiss()
      if let channel { store.route = .chat(channelId: channel, threadId: nil) }
    }
  }

  // MARK: when you're ready

  private var ready: some View {
    let items = ReadyList.list(workspaceId, agentCount: store.agents.count)
    return VStack(alignment: .leading, spacing: 0) {
      Text("When you're ready").font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.text).accessibilityAddTraits(.isHeader)
      Text("This list stays in More until it's done.").font(.system(size: 13)).foregroundStyle(Palette.muted).padding(.top, 2).padding(.bottom, 8)
      ForEach(items) { item in
        HStack(spacing: 10) {
          Button {
            ReadyList.set(workspaceId, item.id, !item.done)
            ticks += 1
          } label: { ChoiceMark(on: item.done).frame(width: 30, height: 34).contentShape(Rectangle()) }
            .buttonStyle(.plain)
            .accessibilityLabel("\(item.label): \(item.done ? "done" : "not done")")
          Button { open(item.id) } label: {
            Text(item.label).font(.system(size: 15)).foregroundStyle(item.done ? Palette.muted : Palette.text).strikethrough(item.done)
              .frame(maxWidth: .infinity, alignment: .leading).frame(height: 34).contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
      }
      .animation(Motion.pick(Motion.pop, reduceMotion), value: ticks)
    }
    .padding(16)
    .background(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).fill(Palette.card))
    .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(Palette.cardBorder))
    .id(ticks)
  }

  private func open(_ id: String) {
    switch id {
    case "logins": place = .logins
    case "email": place = .apps
    case "second": addingAgent = true
    default: break
    }
  }
}

/** One thing that's set up: its icon, name with a check that draws in, a line under it, and Undo/Redo or the one step that fixes it. */
private struct HereRow: View {
  var symbol: String
  var title: String
  var sub: String
  var warn: Bool
  var ready: Bool
  var toggle: (off: Bool, run: (Bool) async throws -> Void)?
  var action: (label: String, run: () -> Void)?
  @State private var busy = false
  @State private var failed = false

  var body: some View {
    let off = toggle?.off == true
    HStack(spacing: 12) {
      Image(systemName: symbol).font(.system(size: 15)).foregroundStyle(Palette.text)
        .frame(width: 36, height: 36).background(Circle().fill(Palette.field)).opacity(off ? 0.6 : 1)
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 6) {
          Text(title).font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.text).lineLimit(1)
          if ready { DrawnCheck(size: 14) }
        }
        Text(off ? "Undone." : sub).font(.system(size: 13)).foregroundStyle(warn ? Palette.statusNeedsText : Palette.muted).fixedSize(horizontal: false, vertical: true)
      }
      .opacity(off ? 0.6 : 1)
      Spacer(minLength: 6)
      if let toggle {
        Button(failed ? "Try again" : off ? "Redo" : "Undo") {
          busy = true; failed = false
          Task {
            do { try await toggle.run(!off) } catch { failed = true }
            busy = false
          }
        }
        .buttonStyle(ObOutline(height: 32)).disabled(busy)
        .accessibilityHint(failed ? "That didn't work. Try again." : "")
      }
      if let action { Button(action.label, action: action.run).buttonStyle(ObOutline(height: 32)) }
    }
    .padding(.horizontal, 14).padding(.vertical, 11)
    .accessibilityElement(children: .contain)
  }
}
