import SwiftUI

/**
 * First-run page 1: "What should your first agent do?" More than one kind can be picked; each
 * brings the apps it starts with, merged into one sheet where every app is one row with one
 * button. The agent reads them once, before its hello, and changes nothing without a yes.
 * Skipping is always there, and the hello works with nothing connected.
 */
struct OnboardingTypeStep: View {
  @Environment(Store.self) private var store
  @Environment(HostStage.self) private var stage
  var workspaceId: String
  var onContinue: () -> Void
  var onClose: () -> Void
  @State private var types: [String] = []
  @State private var other = ""
  @State private var sheet = false
  @State private var loaded = false
  @FocusState private var otherFocused: Bool
  @ReduceMotion private var reduceMotion

  private var apps: [StartApp] { OnboardingCatalog.apps(for: types, other: other, onMac: store.onAMac) }
  private var ready: [StartApp] { apps.filter { $0.how != .soon } }
  private var names: [String] { OnboardingCatalog.pickedNames(types, other: other) }

  var body: some View {
    OnboardingPage(step: 1, onClose: onClose) {
      VStack(alignment: .leading, spacing: 22) {
        VStack(spacing: 10) {
          HostGhost(look: OnboardingLook.host, size: 84)
          Text(names.isEmpty ? "Pick what I'll help with." : names.joined(separator: " · "))
            .font(.system(size: 13)).foregroundStyle(Palette.muted).multilineTextAlignment(.center).lineLimit(2)
            .padding(.horizontal, 24)
            .contentTransition(.opacity)
            .animation(Motion.pick(Motion.fade, reduceMotion), value: names)
        }
        .frame(maxWidth: .infinity).frame(height: 144)
        .background(RoundedRectangle(cornerRadius: Corner.sheet, style: .continuous).fill(Palette.card))
        .overlay(RoundedRectangle(cornerRadius: Corner.sheet, style: .continuous).strokeBorder(Palette.cardBorder))

        OnboardingHead(title: "What should your first agent do?", sub: "Pick one or more. I'll set up the apps it needs.")

        VStack(spacing: 8) {
          ForEach(Array(OnboardingCatalog.agentTypes.enumerated()), id: \.element.id) { i, t in
            TypeChoice(type: t, on: types.contains(t.id)) { toggle(t.id) }.rowEntrance(i)
          }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Kind of agent")

        if types.contains("other") {
          ObField(placeholder: "In your words, e.g. plan my garden", text: $other, id: "ob-other")
            .focused($otherFocused)
            .accessibilityLabel("What it should do, in your words")
            .obPop()
        }
      }
      .animation(Motion.pick(Motion.soft, reduceMotion), value: types)
    } bottom: {
      Button(ready.isEmpty ? "Continue" : "Set up apps", action: next)
        .buttonStyle(ObPrimary()).disabled(types.isEmpty).accessibilityIdentifier("ob-type-next")
      Button("Skip for now", action: skip).buttonStyle(ObQuiet()).accessibilityIdentifier("ob-type-skip")
    }
    .sheet(isPresented: $sheet) {
      AppsSheet(workspaceId: workspaceId, apps: apps, macMissing: OnboardingCatalog.missesMac(types, onMac: store.onAMac)) { connectorIds, appleApps, appNames in
        save { $0.apps = connectorIds; $0.appleApps = appleApps; $0.appNames = appNames }
        sheet = false
        onContinue()
      }
      .environment(store).environment(stage)
    }
    .task {
      guard !loaded else { return }
      loaded = true
      let saved = OnboardingAnswers.load(workspaceId)
      types = saved.agentTypes; other = saved.agentOther
      // Apple apps show only when one of your own devices is a Mac
      try? await store.refreshNodes()
    }
  }

  private func toggle(_ id: String) {
    if let i = types.firstIndex(of: id) { types.remove(at: i) } else { types.append(id) }
    if id == "other", types.contains("other") { otherFocused = true }
    stage.answer(.nod, reduceMotion: reduceMotion)
  }

  private func save(_ extra: (inout OnboardingAnswers) -> Void = { _ in }) {
    OnboardingAnswers.save(workspaceId) {
      $0.agentTypes = types; $0.agentOther = other.trimmed; $0.typeDone = true
      extra(&$0)
    }
  }

  private func skip() {
    types = []; other = ""
    save()
    onContinue()
  }

  private func next() {
    otherFocused = false
    if !ready.isEmpty { sheet = true; return }
    save()
    onContinue()
  }
}

/** One kind of agent: its line icon, name, what it handles, and the mark that fills when it's picked. */
private struct TypeChoice: View {
  var type: AgentType
  var on: Bool
  var action: () -> Void
  @ReduceMotion private var reduceMotion

  var body: some View {
    Button(action: action) {
      HStack(alignment: .top, spacing: 12) {
        Image(systemName: type.symbol).font(.system(size: 16, weight: .regular)).foregroundStyle(Palette.text).frame(width: 22, height: 20)
        VStack(alignment: .leading, spacing: 1) {
          Text(type.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.text)
          Text(type.sub).font(.system(size: 13)).foregroundStyle(Palette.muted)
        }
        Spacer(minLength: 8)
        ChoiceMark(on: on).padding(.top, 1)
      }
      .padding(.horizontal, 14).padding(.vertical, 12)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).fill(Palette.card))
      .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(on ? Palette.text : Palette.cardBorder, lineWidth: on ? 2 : 1))
      .contentShape(RoundedRectangle(cornerRadius: Corner.card, style: .continuous))
    }
    .buttonStyle(.pressRow)
    .animation(Motion.pick(Motion.pop, reduceMotion), value: on)
    .accessibilityLabel("\(type.name). \(type.sub)")
    .accessibilityAddTraits(on ? .isSelected : [])
    .accessibilityIdentifier("ob-type-\(type.id)")
  }
}

/** Where an app's setup stands in the sheet. */
struct AppRowState: Equatable {
  enum Phase: Equatable { case idle, key, busy, done, failed }
  var phase = Phase.idle
  var error: String?
  /** false: saved, but Wisp has no way to try the key */
  var checked = true
}

/**
 * The apps for the picked kinds, one row each with one button: Allow (an Apple app, macOS asks
 * once on the Mac), Sign in (the hub's sign-in page, in the system's sign-in sheet), Add key (the key goes
 * to Wisp, never shown again), or a greyed "Soon".
 */
struct AppsSheet: View {
  @Environment(Store.self) private var store
  @Environment(HostStage.self) private var stage
  var workspaceId: String
  var apps: [StartApp]
  var macMissing: Bool
  var onDone: (_ connectorIds: [String], _ appleApps: [String], _ appNames: [String]) -> Void
  @State private var rows: [String: AppRowState] = [:]
  @State private var values: [String: [String: String]] = [:]
  /** which apps sign in from here (asked once; on failure every app falls back to its key) */
  @State private var options: [String: SignInOption]?
  /** the connector each app made, by app id */
  @State private var made: [String: String] = [:]
  /** the system's sign-in sheet, while someone is signing in to an app */
  @State private var browser = SignInBrowser()
  /** the row whose key form opened last */
  @State private var keyRow: String?
  @ReduceMotion private var reduceMotion

  private var modes: [String: AppRowMode] { Dictionary(uniqueKeysWithValues: apps.map { ($0.id, AppRows.mode($0, options: options)) }) }
  /** apps that can't connect from here go last, as Soon */
  private var shown: [StartApp] { apps.filter { modes[$0.id] != .soon } + apps.filter { modes[$0.id] == .soon } }
  private var doneIds: [String] { apps.filter { rows[$0.id]?.phase == .done }.map(\.id) }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 3) {
        Text("Set up apps").font(.system(size: 18, weight: .semibold)).tracking(-0.2).foregroundStyle(Palette.text).accessibilityAddTraits(.isHeader)
        Text("I only read while we set up. Anything I'd change waits for your yes.").font(.system(size: 13)).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
        if macMissing {
          Text("Messages, Calendar and Reminders need Wisp on a Mac. You can add them later from one.").font(.system(size: 13)).foregroundStyle(Palette.muted)
            .fixedSize(horizontal: false, vertical: true).padding(.top, 6)
        }
      }
      .padding(.horizontal, 20).padding(.top, 22).padding(.bottom, 12)
      ScrollViewReader { proxy in
        ScrollView {
          CardGroup {
            ForEach(shown) { a in
              AppRow(app: a, mode: modes[a.id] ?? .soon, reason: options?[a.catalogId ?? ""]?.reason, state: rows[a.id] ?? AppRowState(),
                     values: Binding(get: { values[a.id] ?? [:] }, set: { values[a.id] = $0 }),
                     onAllow: { Task { await allow(a) } }, onKey: { set(a.id, AppRowState(phase: .key)); keyRow = a.id }, onSave: { Task { await addKey(a) } }, onSignIn: { Task { await signIn(a) } })
            }
          }
          .padding(.horizontal, 20).padding(.bottom, 8)
          .animation(Motion.pick(Motion.soft, reduceMotion), value: rows)
        }
        .scrollDismissesKeyboard(.interactively)
        // a key form opens with the keyboard: bring it to the middle of what's left, so the field and Connect stay in view
        .task(id: keyRow) {
          guard let keyRow else { return }
          try? await Task.sleep(for: .milliseconds(350))
          if !Task.isCancelled { withAnimation(Motion.pick(Motion.soft, reduceMotion)) { proxy.scrollTo(AppRow.formId(keyRow), anchor: .center) } }
        }
      }
      HStack(spacing: 4) {
        Button(OnboardingCatalog.sheetCta(doneIds.count), action: finish).buttonStyle(ObPrimary()).disabled(doneIds.isEmpty)
          .contentTransition(.opacity).animation(Motion.pick(Motion.fade, reduceMotion), value: doneIds.count)
          .accessibilityIdentifier("ob-apps-continue")
        Button("Skip for now", action: finish).buttonStyle(ObQuiet()).accessibilityIdentifier("ob-apps-skip")
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 12)
    }
    .background(Palette.sheet.ignoresSafeArea())
    .presentationDetents([.large])
    .presentationDragIndicator(.visible)
    .presentationCornerRadius(Corner.sheet)
    .task {
      async let asked: [String: SignInOption]? = try? await store.signInOptions()
      await restore()
      options = await asked ?? [:]
    }
    .accessibilityIdentifier("ob-apps-sheet")
  }

  private func set(_ id: String, _ state: AppRowState) { rows[id] = state }

  /** Apps connected on an earlier visit to this sheet stay connected. */
  private func restore() async {
    let prior = OnboardingAnswers.load(workspaceId)
    for a in apps { if let apple = a.apple, prior.appleApps.contains(apple.rawValue), rows[a.id] == nil { set(a.id, AppRowState(phase: .done)) } }
    guard !prior.apps.isEmpty else { return }
    try? await store.refreshConnectors()
    for a in apps {
      guard let c = store.connectors.first(where: { prior.apps.contains($0.id) && $0.catalogId == a.catalogId }), rows[a.id] == nil else { continue }
      made[a.id] = c.id
      set(a.id, AppRowState(phase: .done))
    }
  }

  private func finish() {
    let connected = apps.filter { rows[$0.id]?.phase == .done && made[$0.id] != nil }
    let apple = apps.filter { rows[$0.id]?.phase == .done }.compactMap { $0.apple?.rawValue }
    onDone(connected.compactMap { made[$0.id] }, apple, connected.map(\.name))
  }

  // MARK: sign in

  /** One click: the hub makes the connectors and hands back its sign-in page, which opens in the system's sign-in sheet. */
  private func signIn(_ a: StartApp) async {
    let group = AppRows.signInGroup(a, apps: apps, modes: modes) { rows[$0]?.phase == .done }
    // a key form's keyboard would sit under the sign-in sheet
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    for g in group { set(g.id, AppRowState(phase: .busy)) }
    do {
      // agents get them when the first one is made, like keys added here
      let start = try await store.connectApps(group.compactMap(\.catalogId))
      var error: String?
      if let page = BrowserPage(start.url) {
        browser.open(page.url)
        error = await waitForSignIn(start.connectors.map(\.id))
        browser.close()
      } else if start.url != nil {
        error = "\(a.name) sent back a sign-in page this phone can't open."
      }
      for g in group {
        let c = store.connectors.first { c in start.connectors.contains { $0.id == c.id } && c.catalogId == g.catalogId } ?? start.connectors.first { $0.catalogId == g.catalogId }
        if error == nil, let c {
          made[g.id] = c.id
          set(g.id, AppRowState(phase: .done))
        } else {
          set(g.id, AppRowState(phase: .failed, error: error ?? "\(g.name) didn't connect. Try again."))
        }
      }
      if error == nil { stage.react(.grab) }
    } catch {
      for g in group { set(g.id, AppRowState(phase: .failed, error: error.localizedDescription)) }
    }
  }

  /** Look at the connectors until each is signed in, one says why it isn't, the person closes the page, or time runs out. nil: signed in. */
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
      // the page was closed: look once more (the hub may just have finished), then stop waiting
      if browser.closed {
        closedChecks += 1
        if closedChecks >= 2 { break }
      }
    }
    return "The sign-in didn't finish. Try again."
  }

  // MARK: a key

  private func addKey(_ a: StartApp) async {
    guard let entry = OnboardingCatalog.connector(a.catalogId) else { return set(a.id, AppRowState(phase: .failed, error: "\(a.name) isn't in this Wisp's catalog.")) }
    let env = (values[a.id] ?? [:]).mapValues(\.trimmed).filter { !$0.value.isEmpty }
    if let missing = AppRows.missing(entry, values: env) { return set(a.id, AppRowState(phase: .key, error: missing)) }
    set(a.id, AppRowState(phase: .busy))
    var created: String?
    do {
      var body: Fields = ["kind": AnyEncodable(entry.kind), "name": AnyEncodable(entry.name), "catalogId": AnyEncodable(entry.id), "env": AnyEncodable(env), "agentIds": AnyEncodable([String]())]
      if entry.kind == "mcp-stdio" { body["command"] = AnyEncodable(entry.command ?? ""); body["args"] = AnyEncodable(entry.args ?? []) }
      if entry.kind == "mcp-http" { body["url"] = AnyEncodable(entry.url ?? ""); body["headers"] = AnyEncodable(entry.headers ?? [:]) }
      let id: String
      do {
        id = try await store.saveConnector(nil, body).id
        created = id
      } catch let clash as API.Failure where clash.status == 409 {
        // already connected under this name: give it the new key
        try await store.refreshConnectors()
        guard let have = store.connectors.first(where: { $0.name == entry.name }) else { throw clash }
        id = try await store.saveConnector(have.id, ["env": AnyEncodable(env)]).id
      }
      // one read to check the key works (only for apps Wisp can read itself)
      let check = await store.checkConnector(id)
      if !check.ok {
        if let created { try? await store.deleteConnector(created) }
        throw API.Failure(status: 0, message: check.error ?? "\(a.name) didn't accept that key.")
      }
      made[a.id] = id
      values[a.id] = [:]
      set(a.id, AppRowState(phase: .done, checked: check.checked != false))
      stage.react(.grab)
    } catch {
      set(a.id, AppRowState(phase: .key, error: error.localizedDescription))
    }
  }

  // MARK: an Apple app

  /** The Apple mod reads the app on your Mac; macOS asks there, once. Allowing an app here adds the mod, reading only that app. */
  private func allow(_ a: StartApp) async {
    guard let app = a.apple else { return }
    set(a.id, AppRowState(phase: .busy))
    func fail(_ message: String) -> API.Failure { API.Failure(status: 0, message: message) }
    do {
      let fresh = !store.features.apple
      if fresh {
        guard store.role == "owner" else { throw fail("Only your Wisp's owner can turn on the Apple apps.") }
        var next = store.features
        next.apple = true
        try await store.setFeatures(next)
      }
      await store.refreshApple()
      let mine = Set(store.nodes.filter { $0.mine == true }.map(\.id))
      guard let mac = store.apple?.macs.first(where: { $0.online && mine.contains($0.nodeId) }) ?? store.apple?.macs.first(where: \.online) else {
        throw fail("Wisp can't reach your Mac right now. Open Wisp on it, then try again.")
      }
      var levels: [String: Int] = fresh ? ["messages": 0, "contacts": 0, "calendar": 0, "reminders": 0] : [:]
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
        let until = Date().addingTimeInterval(120)
        while true {
          try await Task.sleep(for: .milliseconds(1500))
          _ = try? await store.fetch { try await $0.raw("POST", "/api/apple/mac/refresh", body: Empty()) }
          let s = await status()
          if s == "allowed" { break }
          if s == "denied", pane != "fullDiskAccess" { throw fail("macOS said no. Allow Wisp in System Settings › Privacy & Security › \(a.name), then try again.") }
          if Date() > until { throw fail(pane == "fullDiskAccess" ? "Turn on Wisp in System Settings › Privacy & Security › Full Disk Access, then try again." : "macOS didn't answer. Try again.") }
        }
      }
      OnboardingAnswers.save(workspaceId) { if !$0.appleApps.contains(app.rawValue) { $0.appleApps.append(app.rawValue) } }
      set(a.id, AppRowState(phase: .done))
      stage.react(.grab)
    } catch {
      set(a.id, AppRowState(phase: .failed, error: error.localizedDescription))
    }
  }
}

/** One app: its icon, name and what it reads, and the one thing to press. A key row opens a small form under it. */
struct AppRow: View {
  var app: StartApp
  var mode: AppRowMode
  var reason: String?
  var state: AppRowState
  @Binding var values: [String: String]
  var onAllow: () -> Void
  var onKey: () -> Void
  var onSave: () -> Void
  var onSignIn: () -> Void
  @FocusState private var focused: String?

  /** where the sheet scrolls to when this row's key form opens */
  static func formId(_ appId: String) -> String { "key-form-\(appId)" }

  private var entry: AppConnector? { OnboardingCatalog.connector(app.catalogId) }
  private var fields: [ConnectorField] { (entry?.fields ?? []).filter { $0.optional != true } }
  private var soon: Bool { mode == .soon }
  /** can sign in, but this row has a key too (Slack, GitHub, Notion, Linear, Vercel) */
  private var keyToo: Bool { mode == .signIn && !fields.isEmpty }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 12) {
        Image(systemName: app.symbol).font(.system(size: 16)).foregroundStyle(Palette.muted).frame(width: 22)
        VStack(alignment: .leading, spacing: 1) {
          Text(app.name).font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.text)
          Text(app.what).font(.system(size: 13)).foregroundStyle(Palette.muted).lineLimit(1)
        }
        Spacer(minLength: 8)
        control
      }
      .frame(minHeight: 36)
      if state.phase == .key { keyForm.padding(.top, 10).padding(.leading, 34).id(Self.formId(app.id)).obPop() }
      if state.phase == .failed, let error = state.error {
        Text(error).font(.system(size: 13)).foregroundStyle(Palette.red).fixedSize(horizontal: false, vertical: true)
          .padding(.top, 6).padding(.leading, 34).accessibilityLabel("Error: \(error)")
      }
      if keyToo, state.phase == .failed {
        Button("Use a key instead", action: onKey).font(.system(size: 13)).foregroundStyle(Palette.muted).buttonStyle(.plain)
          .padding(.top, 4).padding(.leading, 34)
      }
    }
    .padding(.horizontal, 14).padding(.vertical, 11)
    .opacity(soon ? 0.55 : 1)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("ob-app-\(app.id)")
  }

  @ViewBuilder private var control: some View {
    if soon {
      Text("Soon").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.faint).accessibilityHint(reason ?? "")
    } else if mode == .loading {
      ProgressView().controlSize(.small).accessibilityLabel("Checking")
    } else {
      switch state.phase {
      case .done:
        HStack(spacing: 4) {
          DrawnCheck(size: 15, color: Palette.text)
          Text(app.how == .mac ? "Allowed" : state.checked ? "Connected" : "Added").font(.system(size: 13)).foregroundStyle(Palette.muted)
        }
      case .busy:
        HStack(spacing: 6) {
          ProgressView().controlSize(.small)
          Text(app.how == .mac ? "Asking macOS" : mode == .signIn ? "Signing in" : "Checking").font(.system(size: 13)).foregroundStyle(Palette.muted)
        }
      case .key:
        EmptyView()
      case .idle, .failed:
        Button(app.how == .mac || mode == .signIn ? (state.phase == .failed ? "Try again" : app.how == .mac ? "Allow" : "Sign in") : "Add key",
               action: app.how == .mac ? onAllow : mode == .signIn ? onSignIn : onKey)
          .buttonStyle(ObOutline(height: 32))
          .accessibilityIdentifier("ob-app-\(app.id)-action")
      }
    }
  }

  private var keyForm: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(fields) { f in
        Group {
          if f.secret == true {
            SecureField(f.placeholder ?? f.label, text: Binding(get: { values[f.key] ?? "" }, set: { values[f.key] = $0 })).textContentType(.password)
          } else {
            TextField(f.placeholder ?? f.label, text: Binding(get: { values[f.key] ?? "" }, set: { values[f.key] = $0 }))
          }
        }
        .font(.system(size: 15)).textInputAutocapitalization(.never).autocorrectionDisabled()
        .padding(.horizontal, 14).frame(height: 40)
        .background(RoundedRectangle(cornerRadius: Corner.tile, style: .continuous).fill(Palette.control))
        .overlay(RoundedRectangle(cornerRadius: Corner.tile, style: .continuous).strokeBorder(Palette.hairline))
        .focused($focused, equals: f.key)
        .submitLabel(.done).onSubmit(onSave)
        .accessibilityLabel("\(app.name) \(f.label)")
      }
      if let error = state.error {
        Text(error).font(.system(size: 13)).foregroundStyle(Palette.red).fixedSize(horizontal: false, vertical: true).accessibilityLabel("Error: \(error)")
      }
      HStack(spacing: 12) {
        Button("Connect", action: onSave).buttonStyle(ObPrimary(height: 32)).accessibilityIdentifier("ob-app-\(app.id)-connect")
        if let link = entry?.fields?.compactMap(\.link).first.flatMap(URL.init(string:)) {
          Link("Get a key ›", destination: link).font(.system(size: 13)).foregroundStyle(Palette.muted)
        }
      }
      Text("Paste it, or fill it from your password manager. Wisp keeps it and never shows it again.").font(.system(size: 12)).foregroundStyle(Palette.faint).fixedSize(horizontal: false, vertical: true)
    }
    .onAppear { focused = fields.first?.key }
  }
}
