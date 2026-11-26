import SwiftUI

// The first run's pages after "Which AI app" and before it (2026-11-26 canvas, iPhone board), each
// on the one stage (OnboardingFlow): How it starts (Simple or Advanced, each shown as the same small
// loop as the desktop), Make it yours (what it helps with, how it talks, when it checks in, with the
// message it would send on top so each pick lands), and Connect (only apps that can connect from
// here right now, each with its own sign-in or, for an Apple app on your Mac, Allow).

// MARK: - How it starts

struct OnboardingStartStep: View {
  var name: String
  @Binding var path: SetupPath
  var onNext: () -> Void
  @ReduceMotion private var reduceMotion

  var body: some View {
    ObScreen(top: 64) {
      VStack(spacing: 14) {
        ObSlot(size: 64)
        Text("How should \(name) start?").obTitle()
        VStack(spacing: 12) {
          PathTile(on: path == .simple, title: "Simple", sub: "Chat now", id: "simple") { SimpleLoop() } action: { pick(.simple) }
          PathTile(on: path == .advanced, title: "Advanced", sub: "Goals and apps first", id: "advanced") { AdvancedLoop() } action: { pick(.advanced) }
        }
        .padding(.top, 8)
        .accessibilityElement(children: .contain).accessibilityLabel("How it starts")
      }
    } bottom: {
      Button("Continue", action: onNext).buttonStyle(ObWide()).accessibilityIdentifier("ob-start-next")
    }
  }

  private func pick(_ p: SetupPath) {
    withAnimation(Motion.pick(Motion.pop, reduceMotion)) { path = p }
  }
}

/** A start to pick: its loop on the left, its name and a few words on the right. */
private struct PathTile<Demo: View>: View {
  var on: Bool
  var title: String
  var sub: String
  var id: String
  @ViewBuilder var demo: Demo
  var action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 14) {
        demo
          .frame(width: 136, height: 118)
          .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.field.opacity(0.6)))
          .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 2) {
          Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Palette.text)
          Text(sub).font(.system(size: 13)).foregroundStyle(Palette.muted)
        }
        Spacer(minLength: 0)
      }
      .padding(12)
      .obTile(on, radius: 20)
    }
    .buttonStyle(.pressRow)
    .accessibilityLabel("\(title). \(sub)")
    .accessibilityAddTraits(on ? .isSelected : [])
    .accessibilityIdentifier("ob-path-\(id)")
  }
}

/** Simple: a chat that just starts, messages coming in. */
private struct SimpleLoop: View {
  @ReduceMotion private var reduceMotion

  var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { ctx in
      let t = reduceMotion ? 2.5 : ctx.date.timeIntervalSinceReferenceDate
      VStack(alignment: .leading, spacing: 8) {
        msg(t, delay: 0, width: 0.62, me: false)
        msg(t, delay: 0.9, width: 0.5, me: true)
        msg(t, delay: 1.8, width: 0.42, me: false)
      }
      .padding(12)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }

  private func msg(_ t: Double, delay: Double, width: CGFloat, me: Bool) -> some View {
    let k = reduceMotion ? 1 : obEnvelope(t, delay: delay, rise: (0, 0.08), fall: (0.82, 0.92))
    return HStack {
      if me { Spacer(minLength: 0) }
      Capsule().fill(me ? Palette.text.opacity(0.85) : Palette.card)
        .overlay(Capsule().strokeBorder(me ? .clear : Palette.hairline))
        .frame(width: 112 * width, height: 22)
      if !me { Spacer(minLength: 0) }
    }
    .opacity(k).offset(y: (1 - k) * 8)
  }
}

/** Advanced: goals get picked, then the apps they need turn on. */
private struct AdvancedLoop: View {
  @ReduceMotion private var reduceMotion

  var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { ctx in
      let t = reduceMotion ? 4 : ctx.date.timeIntervalSinceReferenceDate
      ZStack(alignment: .topLeading) {
        VStack(alignment: .leading, spacing: 8) {
          pick("Research", t, delay: 0)
          pick("Code", t, delay: 1)
          pick("Email", t, delay: 2)
        }
        VStack(alignment: .trailing, spacing: 8) {
          on("Notion ✓", t, delay: 3)
          on("Linear ✓", t, delay: 3.6)
        }
        // a row down, beside the short goals: the tile is too narrow for "Research" and an app side by side
        .padding(.top, 30)
        .frame(maxWidth: .infinity, alignment: .trailing)
      }
      .padding(10)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }

  private func chip(_ text: String) -> some View {
    Text(text).font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
      .padding(.horizontal, 7).frame(height: 22)
      .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Palette.card))
  }

  private func pick(_ text: String, _ t: Double, delay: Double) -> some View {
    let k = reduceMotion ? 1 : obEnvelope(t, delay: delay, rise: (0, 0.1), fall: (0.85, 0.95))
    return chip(text)
      .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(k > 0.5 ? ObTint.wisp : Palette.hairline, lineWidth: k > 0.5 ? 1.5 : 1))
      .opacity(0.35 + 0.65 * k)
  }

  private func on(_ text: String, _ t: Double, delay: Double) -> some View {
    let k = reduceMotion ? 1 : obEnvelope(t, delay: delay, rise: (0.02, 0.1), fall: (0.8, 0.9))
    return chip(text)
      .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Palette.hairline))
      .opacity(k).offset(x: (1 - k) * 8)
  }
}

// MARK: - Make it yours

struct OnboardingYoursStep: View {
  var name: String
  var look: GhostLook
  @Binding var goals: [String]
  @Binding var talk: SetupTalk
  @Binding var checkIn: SetupCheckIn
  var busy: Bool
  var onNext: () -> Void
  @ReduceMotion private var reduceMotion

  private var message: String { SetupGoals.sample(goals, talk: talk, when: checkIn) }

  var body: some View {
    ObScreen(top: 64) {
      VStack(alignment: .leading, spacing: 10) {
        Text("Make \(name) yours").obTitle(24, center: false)
        // what it would actually send, changing as you pick
        VStack(alignment: .leading, spacing: 8) {
          HStack(spacing: 8) {
            ObSlot(size: 24)
            Text(name).font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
            Text(checkIn.when).font(.system(size: 12)).foregroundStyle(Palette.faint)
              .contentTransition(.opacity)
          }
          Text(message).font(.system(size: 15)).foregroundStyle(Palette.text)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 14, bottomTrailingRadius: 14, topTrailingRadius: 14, style: .continuous).fill(Palette.card))
            .overlay(UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 14, bottomTrailingRadius: 14, topTrailingRadius: 14, style: .continuous).strokeBorder(Palette.hairline))
            .id(message)
            .transition(reduceMotion ? .opacity : .asymmetric(insertion: .scale(scale: 0.96, anchor: .topLeading).combined(with: .opacity), removal: .opacity))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.field.opacity(0.6)))
        .animation(Motion.pick(Motion.soft, reduceMotion), value: message)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(name) would send: \(message)")
        .accessibilityIdentifier("ob-yours-preview")

        ObLabel(text: "Help with")
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
          ForEach(SetupGoals.all) { g in
            let on = goals.contains(g.id)
            Button { toggle(g.id) } label: {
              VStack(alignment: .leading, spacing: 0) {
                Image(systemName: g.symbol).font(.system(size: 16)).foregroundStyle(Palette.text)
                Spacer(minLength: 0)
                Text(g.label).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
              }
              .padding(10)
              .frame(maxWidth: .infinity, minHeight: 64, maxHeight: 64, alignment: .leading)
              .overlay(alignment: .topTrailing) {
                if on {
                  Image(systemName: "checkmark").font(.system(size: 9, weight: .heavy)).foregroundStyle(.white)
                    .frame(width: 18, height: 18).background(Circle().fill(ObTint.wisp)).padding(8)
                    .transition(.scale(scale: 0.4).combined(with: .opacity))
                }
              }
              .obTile(on, radius: 14)
            }
            .buttonStyle(.pressRow)
            .accessibilityLabel(g.label).accessibilityAddTraits(on ? .isSelected : [])
            .accessibilityIdentifier("ob-goal-\(g.id)")
          }
        }
        .animation(Motion.pick(Motion.pop, reduceMotion), value: goals)
        ObLabel(text: "Talks")
        ObSegmented(label: "Talks", options: SetupTalk.allCases.map { ($0, $0.label) }, selection: $talk)
        ObLabel(text: "Checks in")
        ObSegmented(label: "Checks in", options: SetupCheckIn.allCases.map { ($0, $0.label) }, selection: $checkIn)
      }
    } bottom: {
      Button {
        onNext()
      } label: {
        HStack(spacing: 8) {
          if busy { ProgressView().controlSize(.small).tint(Palette.ground) }
          Text("Continue")
        }
      }
      .buttonStyle(ObWide()).disabled(busy).accessibilityIdentifier("ob-yours-next")
    }
  }

  private func toggle(_ id: String) {
    if let i = goals.firstIndex(of: id) { goals.remove(at: i) } else { goals.append(id) }
  }
}

// MARK: - Connect

/** Where one app's connecting stands. */
struct AppRowState: Equatable {
  enum Phase: Equatable { case idle, busy, done, failed }
  var phase = Phase.idle
  var error: String?
  /** what to do on the Mac while macOS is being asked (Full Disk Access is a switch, not a prompt) */
  var hint: String?
}

/**
 * Connect what it needs: only apps that connect from here right now. A catalog app signs in on its
 * own page in the system's sign-in sheet (the hub runs the sign-in; the app never sees what's
 * typed); an Apple app is allowed on your Mac, where macOS asks once. A row says Connected only when
 * it really is. Nothing is asked for a key here; keys stay in Apps for later.
 */
struct OnboardingConnectStep: View {
  @Environment(Store.self) private var store
  @Environment(HostStage.self) private var stage
  var workspaceId: String
  var agent: Agent
  var apps: [StartApp]
  var onDone: () -> Void
  @State private var rows: [String: AppRowState] = [:]
  /** the connector each app made, by app id */
  @State private var made: [String: String] = [:]
  @State private var browser = SignInBrowser()
  /** each Apple app being allowed, so it can be cancelled */
  @State private var allowing: [String: Task<Void, Never>] = [:]
  @State private var leaving = false
  @ReduceMotion private var reduceMotion

  private var done: [StartApp] { apps.filter { rows[$0.id]?.phase == .done } }

  var body: some View {
    ObScreen(top: 64) {
      VStack(alignment: .leading, spacing: 12) {
        HStack(spacing: 12) {
          ObSlot(size: 44)
          Text("Connect what \(agent.name) needs").obTitle(22, center: false)
        }
        Text("\(done.count) of \(apps.count) connected").font(.system(size: 14)).foregroundStyle(Palette.muted)
          .contentTransition(.numericText()).animation(Motion.pick(Motion.fade, reduceMotion), value: done.count)
          .accessibilityIdentifier("ob-connect-count")
        VStack(spacing: 0) {
          ForEach(Array(apps.enumerated()), id: \.element.id) { i, a in
            if i > 0 { Rectangle().fill(Palette.separator).frame(height: 1).padding(.leading, 52) }
            ConnectRow(app: a, state: rows[a.id] ?? AppRowState(), signIn: OnboardingCatalog.connector(a.catalogId)?.signIn != nil,
                       onGo: { go(a) },
                       onCancel: { allowing[a.id]?.cancel(); allowing[a.id] = nil; rows[a.id] = AppRowState() })
          }
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.card))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.hairline))
        .animation(Motion.pick(Motion.soft, reduceMotion), value: rows)
      }
    } bottom: {
      if done.isEmpty {
        Button("Skip for now") { finish() }.buttonStyle(ObQuiet()).disabled(leaving).accessibilityIdentifier("ob-connect-skip")
      }
      Button("Continue") { finish() }.buttonStyle(ObWide()).disabled(done.isEmpty || leaving).accessibilityIdentifier("ob-connect-next")
    }
    .task { await restore() }
  }

  private func go(_ a: StartApp) {
    if a.how == .mac { allowing[a.id] = Task { await allow(a) } } else { Task { await signIn(a) } }
  }

  /** Apps connected on an earlier visit stay connected. */
  private func restore() async {
    let prior = OnboardingAnswers.load(workspaceId)
    for a in apps { if let apple = a.apple, prior.appleApps.contains(apple.rawValue), rows[a.id] == nil { rows[a.id] = AppRowState(phase: .done) } }
    guard !prior.apps.isEmpty else { return }
    try? await store.refreshConnectors()
    for a in apps {
      guard let c = store.connectors.first(where: { prior.apps.contains($0.id) && $0.catalogId == a.catalogId && $0.auth?.signedIn != false }), rows[a.id] == nil else { continue }
      made[a.id] = c.id
      rows[a.id] = AppRowState(phase: .done)
    }
  }

  /** The agent gets what got connected, then its chat. */
  private func finish() {
    guard !leaving else { return }
    leaving = true
    let connected = apps.filter { rows[$0.id]?.phase == .done && made[$0.id] != nil }
    let ids = connected.compactMap { made[$0.id] }
    let apple = apps.filter { rows[$0.id]?.phase == .done }.compactMap { $0.apple?.rawValue }
    OnboardingAnswers.save(workspaceId) { $0.apps = ids; $0.appNames = connected.map(\.name); $0.appleApps = apple }
    Task {
      if !ids.isEmpty {
        try? await store.refreshConnectors()
        await AddAgent.giveAppsAndSkills(to: agent, apps: Set(ids), skills: [], store: store)
      }
      onDone()
    }
  }

  // MARK: sign in

  /** One tap: the hub makes the connector and hands back its sign-in page, which opens in the system's sign-in sheet. */
  private func signIn(_ a: StartApp) async {
    guard let catalogId = a.catalogId else { return }
    rows[a.id] = AppRowState(phase: .busy)
    do {
      let start = try await store.connectApps([catalogId])
      var error: String?
      if let page = BrowserPage(start.url) {
        browser.open(page.url)
        error = await waitForSignIn(start.connectors.map(\.id))
        browser.close()
      } else if start.url != nil {
        error = "\(a.name) sent back a sign-in page this phone can't open."
      }
      let c = store.connectors.first { c in start.connectors.contains { $0.id == c.id } && c.catalogId == catalogId } ?? start.connectors.first { $0.catalogId == catalogId }
      if error == nil, let c {
        made[a.id] = c.id
        rows[a.id] = AppRowState(phase: .done)
        stage.react(.grab)
      } else {
        // a connector left half made would sit in Apps saying it's off
        for c in start.connectors where c.auth?.signedIn != true { try? await store.deleteConnector(c.id) }
        rows[a.id] = AppRowState(phase: .failed, error: error ?? "\(a.name) didn't connect. Try again.")
      }
    } catch {
      rows[a.id] = AppRowState(phase: .failed, error: error.localizedDescription)
    }
  }

  /** Look at the connectors until each is signed in, one says why it isn't, the sheet is closed, or time runs out. nil: signed in. */
  private func waitForSignIn(_ ids: [String]) async -> String? {
    let until = Date().addingTimeInterval(5 * 60)
    var closedChecks = 0
    while Date() < until {
      try? await Task.sleep(for: .milliseconds(1500))
      if Task.isCancelled { return "The sign-in didn't finish. Try again." }
      guard (try? await store.refreshConnectors()) != nil else { continue }
      let last = store.connectors.filter { ids.contains($0.id) }
      if !last.isEmpty, last.allSatisfy({ $0.auth?.signedIn == true }) { return nil }
      if let failed = last.first(where: { $0.auth?.error != nil }) { return failed.auth?.error }
      // the sheet was closed: look once more (the hub may just have finished), then stop waiting
      if browser.closed {
        closedChecks += 1
        if closedChecks >= 2 { break }
      }
    }
    return "The sign-in didn't finish. Try again."
  }

  // MARK: an Apple app

  /** The Apple mod reads the app on your Mac; macOS asks there, once. Allowing an app here adds the mod, reading only that app. */
  private func allow(_ a: StartApp) async {
    guard let app = a.apple else { return }
    rows[a.id] = AppRowState(phase: .busy)
    func fail(_ message: String) -> API.Failure { API.Failure(status: 0, message: message) }
    var turnedOn = false
    do {
      let fresh = !store.features.apple
      if fresh {
        guard store.role == "owner" else { throw fail("Only your Bubble AI's owner can turn on the Apple apps.") }
        var next = store.features
        next.apple = true
        try await store.setFeatures(next)
        turnedOn = true
      }
      await store.refreshApple()
      let mine = Set(store.nodes.filter { $0.mine == true }.map(\.id))
      guard let mac = store.apple?.macs.first(where: { $0.online && mine.contains($0.nodeId) }) ?? store.apple?.macs.first(where: \.online) else {
        throw fail("Bubble AI can't reach your Mac right now. Open Bubble AI on it, then try again.")
      }
      // only the app asked for: everything else (Location too) stays off
      var levels: [String: Int] = fresh ? ["messages": 0, "contacts": 0, "calendar": 0, "reminders": 0, "location": 0] : [:]
      levels[app.rawValue] = 1
      _ = try await store.saveApple(AppleSettingsPatch(macNodeId: mac.nodeId, levels: levels))
      let pane = OnboardingCatalog.applePermission(app)
      func status() async -> String? {
        await store.refreshApple()
        guard let s = store.apple?.macs.first(where: { $0.nodeId == mac.nodeId })?.status else { return nil }
        switch pane {
        case "fullDiskAccess": return s.fullDiskAccess
        case "calendars": return s.calendars
        case "reminders": return s.reminders
        default: return s.contacts
        }
      }
      if await status() != "allowed" {
        // macOS shows its own prompt on the Mac (or its System Settings pane for Full Disk Access)
        _ = try? await store.fetch { try await $0.raw("POST", "/api/apple/mac/permission", body: ["pane": pane]) }
        rows[a.id] = AppRowState(phase: .busy, hint: pane == "fullDiskAccess" ? "On \(mac.name), turn on Bubble AI in System Settings › Privacy & Security › Full Disk Access." : "Answer the prompt on \(mac.name).")
        let until = Date().addingTimeInterval(120)
        while true {
          try await Task.sleep(for: .milliseconds(1500))
          _ = try? await store.fetch { try await $0.raw("POST", "/api/apple/mac/refresh", body: Empty()) }
          let s = await status()
          if s == "allowed" { break }
          if s == "denied", pane != "fullDiskAccess" { throw fail("macOS said no. Allow Bubble AI in System Settings › Privacy & Security › \(a.name), then try again.") }
          if Date() > until { throw fail(pane == "fullDiskAccess" ? "Turn on Bubble AI in System Settings › Privacy & Security › Full Disk Access, then try again." : "macOS didn't answer. Try again.") }
        }
      }
      OnboardingAnswers.save(workspaceId) { if !$0.appleApps.contains(app.rawValue) { $0.appleApps.append(app.rawValue) } }
      rows[a.id] = AppRowState(phase: .done)
      stage.react(.grab)
    } catch {
      // given up or cancelled: the mod this turned on goes back off, so nothing stays on that wasn't allowed
      if turnedOn, store.role == "owner", OnboardingAnswers.load(workspaceId).appleApps.isEmpty {
        // its own task: a cancelled one would cancel this request too
        Task { @MainActor in
          var next = store.features
          next.apple = false
          try? await store.setFeatures(next)
        }
      }
      if error is CancellationError || Task.isCancelled { rows[a.id] = AppRowState(); return }
      rows[a.id] = AppRowState(phase: .failed, error: error.localizedDescription)
    }
  }
}

/** One app: its logo, name and what it reads, and the one thing to press, then Connected. */
private struct ConnectRow: View {
  var app: StartApp
  var state: AppRowState
  var signIn: Bool
  var onGo: () -> Void
  var onCancel: () -> Void

  private var mac: Bool { app.how == .mac }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 12) {
        AppLogo(sources: AppLogo.byName(app.apple.map { "Apple \($0.name)" } ?? app.name), symbol: app.symbol, size: 28)
        VStack(alignment: .leading, spacing: 1) {
          Text(app.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.text)
          Text(app.what).font(.system(size: 12)).foregroundStyle(Palette.muted).lineLimit(1)
        }
        Spacer(minLength: 8)
        control
      }
      .frame(minHeight: 46)
      if state.phase == .busy, let hint = state.hint {
        Text(hint).font(.system(size: 13)).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
          .padding(.top, 6).padding(.leading, 40).accessibilityIdentifier("ob-app-\(app.id)-hint")
      }
      if state.phase == .failed, let error = state.error {
        Text(error).font(.system(size: 13)).foregroundStyle(Palette.red).fixedSize(horizontal: false, vertical: true)
          .padding(.top, 6).padding(.leading, 40).accessibilityLabel("Error: \(error)")
      }
    }
    .padding(.horizontal, 14).padding(.vertical, 12)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("ob-app-\(app.id)")
  }

  @ViewBuilder private var control: some View {
    switch state.phase {
    case .done:
      HStack(spacing: 4) {
        DrawnCheck(size: 15)
        Text(mac ? "Allowed" : "Connected").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.statusOnlineText)
      }
      .accessibilityElement(children: .combine)
    case .busy:
      HStack(spacing: 6) {
        ProgressView().controlSize(.small)
        Text(mac ? "Asking macOS" : "Signing in").font(.system(size: 13)).foregroundStyle(Palette.muted)
        if mac {
          Button("Cancel", action: onCancel).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.text).buttonStyle(.plain)
            .padding(.leading, 4).accessibilityIdentifier("ob-app-\(app.id)-cancel")
        }
      }
    case .idle, .failed:
      Button(state.phase == .failed ? "Try again" : mac ? "Allow" : "Connect", action: onGo)
        .buttonStyle(ObPrimary(height: 34))
        .accessibilityIdentifier("ob-app-\(app.id)-action")
    }
  }
}
