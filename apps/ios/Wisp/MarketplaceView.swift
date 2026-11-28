import SwiftUI

enum MarketSection: String, CaseIterable {
  case all = "All", apps = "Apps", skills = "Skills", devices = "On your devices", installed = "Installed"
}

struct MarketApp: Identifiable {
  var id: String
  var name: String
  var detail: String
  var registry: MarketplaceEntry?
  var builtIn: AppConnector?
}

struct MarketSkill: Identifiable {
  var id: String
  var name: String
  var detail: String
  var who: String
  var library: HelperSkill?
  var store: StoreSkill?
}

/** Something on a device to set up as an app (it needs a key or a sign-in first). */
struct ShelfApp: Hashable, Identifiable {
  var nodeId: String
  var item: ShelfItem
  var id: String { nodeId + "|" + item.key }
}

/** A skill on a device to give to helpers. */
struct ShelfSkill: Identifiable {
  var nodeId: String
  var item: ShelfItem
  var id: String { nodeId + "|" + item.key }
}

/**
 * Connect apps (round 9, the web's 0.1.6 pop-up on the phone): apps, skills and mods in one place,
 * opened as a sheet from the chat list's "Connect apps" pill (and from More). One search; chips for
 * All, Apps, Skills, Your computers and topics; on All, Recommended (Composio first, then what the
 * agent picked from what the person told it), what your computers already have, Apps and Skills.
 * "N connected" shows what's in. Every page and action of the old Marketplace stays.
 */
struct MarketplaceView: View {
  @Environment(Store.self) private var store
  @Environment(\.scenePhase) private var scenePhase
  var start: MarketSection = .all
  /** opened as the Connect apps sheet: X closes it (a pushed page has Back) */
  var inSheet = false
  /** the Marketplace tab (round 11): no Back */
  var asTab = false
  @State private var query = ""
  @State private var library: [HelperSkill] = []
  @State private var builtIn: [AppConnector] = []
  @State private var registry: [MarketplaceEntry]?
  @State private var registryError: String?
  @State private var skillList: SkillStoreList?
  @State private var skillSource = "All"
  @State private var shelves: [DeviceShelf] = []
  @State private var action = FormAction()
  @State private var creating = false
  @State private var editor: ConnectorEditorTarget?
  @State private var chat: ChatTarget?
  @State private var importing = false
  @State private var bringingAll = false
  @State private var bringingSkill: ShelfSkill?
  @State private var settingUp: ShelfApp?
  @State private var started = false

  private static func squash(_ s: String) -> String { String(s.lowercased().filter { $0.isASCII && ($0.isLetter || $0.isNumber) }) }
  private var needle: String { query.trimmed }
  private func match(_ parts: String?...) -> Bool { needle.isEmpty || parts.contains { $0?.localizedCaseInsensitiveContains(needle) == true } }

  // MARK: apps

  private var apps: [MarketApp] {
    let fromRegistry = (registry ?? []).map { MarketApp(id: "r:" + $0.id, name: $0.name, detail: $0.description ?? $0.publisher ?? "", registry: $0) }
    let names = Set(fromRegistry.map { Self.squash($0.name) })
    let own = builtIn.filter { !names.contains(Self.squash($0.name)) && match($0.name, $0.description, $0.category) }
      .map { MarketApp(id: "b:" + $0.id, name: $0.name, detail: $0.description ?? "Bubble AI", builtIn: $0) }
    return fromRegistry + own
  }
  private func added(_ a: MarketApp) -> Bool {
    let id = a.registry.map { "registry:" + $0.id } ?? a.builtIn?.id
    return store.connectors.contains { $0.catalogId == id || Self.squash($0.name) == Self.squash(a.name) }
  }

  // MARK: skills

  private var skillItems: [MarketSkill] {
    library.map { MarketSkill(id: "w:" + $0.id, name: $0.name, detail: $0.description ?? "", who: "Bubble AI", library: $0) }
      + (skillList?.skills ?? []).map { MarketSkill(id: "s:" + $0.id, name: $0.name, detail: $0.description, who: $0.source.label, store: $0) }
  }
  private var sources: [String] { ["All"] + Array(NSOrderedSet(array: skillItems.map(\.who))).compactMap { $0 as? String } }
  private var shownSkills: [MarketSkill] {
    skillItems.filter { (skillSource == "All" || $0.who == skillSource) && match($0.name, $0.detail, $0.who) }
  }
  private func installed(_ s: MarketSkill) -> HelperSkill? {
    let id = s.library?.id ?? s.store?.id
    return store.skills.first { $0.catalogId == id }
  }
  /** one from each maker in turn, so a short shelf shows a bit of everyone's */
  private func takeTurns(_ list: [MarketSkill]) -> [MarketSkill] {
    let order = Array(NSOrderedSet(array: list.map(\.who))).compactMap { $0 as? String }
    let lanes = order.map { who in list.filter { $0.who == who } }
    var out: [MarketSkill] = []
    var i = 0
    while out.count < list.count {
      for lane in lanes where i < lane.count { out.append(lane[i]) }
      i += 1
    }
    return out
  }

  // MARK: devices

  private var pending: [PendingShelfItem] { ShelfLogic.pending(shelves, skills: store.skills, connectors: store.connectors) }
  private func bringIn(_ d: DeviceShelf, _ item: ShelfItem) {
    if item.isSkill { bringingSkill = ShelfSkill(nodeId: d.nodeId, item: item) } else { settingUp = ShelfApp(nodeId: d.nodeId, item: item) }
  }

  // MARK: Connect apps (round 9): chips, sections, rows

  /** the chip that's on: all, apps, skills, devices, installed (Connected), or a topic */
  @State private var chip = "all"
  @State private var connecting = AppConnecting()
  @State private var askingMod: FeatureKey?
  @State private var modAction = FormAction()
  @Environment(\.dismiss) private var dismiss

  private var searching: Bool { !needle.isEmpty }
  private var topic: AppTopic? { AppTopic(rawValue: chip) }
  private var mainChips: [(String, String)] {
    var out = [("all", "All")]
    // this phone's own features, each with an Allow (round 11, board 14)
    if store.role != "guest" { out.append(("iphone", "This iPhone")) }
    out += [("apps", "Apps"), ("skills", "Skills")]
    // what your computers already have: on a phone that's never "This iPhone", so it's named for where it is
    if store.canManage && (!shelves.isEmpty || chip == "devices") { out.append(("devices", "Your computers")) }
    out += [("productivity", "Productivity"), ("communication", "Communication")]
    return out
  }

  private func category(_ a: MarketApp) -> String? {
    if let b = a.builtIn { return AppTopic.builtInCategory(b) }
    return AppTopic.category(a.name, a.detail)
  }
  private func topics(_ a: MarketApp) -> [AppTopic] { AppTopic.of(name: a.name, description: a.detail, category: category(a)) }
  private func recommended(_ a: MarketApp) -> Bool { a.builtIn?.recommended != nil }
  /** the always-recommended one first, then the rest as they come */
  private var orderedApps: [MarketApp] { searching ? ranked(apps) : apps.filter(recommended) + apps.filter { !recommended($0) } }
  /** search results, best first: a word of the name starting with what's typed, then Bubble AI's own and the recommended, then the rest in the order they came */
  private func ranked(_ list: [MarketApp]) -> [MarketApp] {
    let q = needle.lowercased()
    let known = Set(builtIn.map { Self.squash($0.name) })
    func score(_ a: MarketApp) -> Int {
      let words = a.name.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber })
      var s = words.contains { $0 == Substring(q) } ? 0 : words.contains { $0.hasPrefix(q) } ? 2 : 4
      if a.builtIn != nil || known.contains(Self.squash(a.name)) { s -= 1 }
      return s
    }
    return list.enumerated().sorted { (score($0.element), $0.offset) < (score($1.element), $1.offset) }.map(\.element)
  }

  /** Composio, then what the agent picked from what the person told it (round 7). */
  private var picks: (agentId: String?, apps: [ConnectSuggestion])? { AgentPicks.latest(store.messages, first: store.openChannel ?? store.wallChannel) }
  private var pickedApps: [(app: MarketApp, why: String)] {
    (picks?.apps ?? []).filter { $0.recommended != true }.compactMap { p in
      builtIn.first { $0.id == p.id }.map { (MarketApp(id: "b:" + $0.id, name: $0.name, detail: $0.description ?? "", builtIn: $0), p.why) }
    }
  }
  private var connectedCount: Int { store.connectors.count + store.skills.count }

  var body: some View {
    VStack(spacing: 0) {
      header
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          MarketSearch(text: $query, prompt: chip == "installed" ? "Search apps" : "Search apps and skills")
            .tourTarget("market-page")
          chips
          InlineError(error: action.error ?? modAction.error)
          content
        }
        .padding(.horizontal, 18).padding(.top, 4).padding(.bottom, 40)
      }
      .scrollDismissesKeyboard(.interactively)
      .bubbleRefreshSlot()
    }
    .background(Palette.sheet.ignoresSafeArea())
    .toolbar(.hidden, for: .navigationBar)
    .accessibilityIdentifier("screen-marketplace")
    .sheet(isPresented: $creating) { SkillEditor() }
    .sheet(isPresented: $importing) { SkillShareSheet(skill: nil, onBrought: { _ in chip = "installed" }, onDevices: { chip = "devices" }) }
    .sheet(isPresented: $bringingAll) {
      BringAllSheet(pending: pending, onSetUp: { d, item in settingUp = ShelfApp(nodeId: d.nodeId, item: item) })
    }
    .sheet(item: $bringingSkill) { target in
      SkillInstallSheet(title: "Add \(MarketText.skillTitle(target.item.name))", request: [
        "nodeId": AnyEncodable(target.nodeId), "harness": AnyEncodable(target.item.harness), "skillId": AnyEncodable(target.item.skillId)
      ])
    }
    .confirmationDialog(askingMod.map { "Turn on \($0.name)?" } ?? "", isPresented: Binding(get: { askingMod != nil }, set: { if !$0 { askingMod = nil } }), titleVisibility: .visible, presenting: askingMod) { key in
      Button("Turn on") { setMod(key) }
    } message: { key in Text(key.detail) }
    .connectFlow($editor, chat: $chat)
    .navigationDestination(item: $chat) { ChannelView(channel: $0.channel, draft: $0.draft) }
    .navigationDestination(item: $settingUp) { target in
      ConnectorCatalogDetail(entry: ShelfLogic.connector(target.nodeId, target.item), summary: ShelfLogic.summary(target.item), presetEnv: target.item.env ?? [:])
    }
    .task { if !started { started = true; chip = Self.chipFor(start) }; await loadAll() }
    .task(id: query) { await searchRegistry() }
    .onChange(of: scenePhase) { _, phase in if phase == .active { action.run { try await store.refreshConnectors() } } }
  }

  static func chipFor(_ s: MarketSection) -> String {
    switch s {
    case .all: "all"
    case .apps: "apps"
    case .skills: "skills"
    case .devices: "devices"
    case .installed: "installed"
    }
  }

  /** "Connect apps"; at the right the connected logos and "N connected ›"; X closes the sheet (Back on a page). */
  private var header: some View {
    HStack(spacing: 10) {
      if !inSheet && !asTab { CircleButton(symbol: "chevron.left", label: "Back") { dismiss() } }
      Text("Connect apps").font(.system(size: 20, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
        .accessibilityAddTraits(.isHeader)
      Spacer(minLength: 6)
      if connectedCount > 0 {
        Button { query = ""; chip = chip == "installed" ? "all" : "installed" } label: {
          HStack(spacing: 6) {
            LogoStack(logos: ConnectedLogos.of(store.connectors), size: 18)
            Text("\(connectedCount) connected").font(.system(size: 13.5)).foregroundStyle(Palette.muted)
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.faint)
          }
          .padding(.vertical, 6).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(connectedCount) connected").accessibilityIdentifier("market-connected")
      }
      if inSheet { CircleButton(symbol: "xmark", label: "Close", size: 34) { dismiss() } }
    }
    .padding(.horizontal, 18).padding(.top, inSheet ? 16 : 8).padding(.bottom, 8)
  }

  /** All · Apps · Skills · Your computers · Productivity · Communication · More ⌄ */
  private var chips: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 6) {
        ForEach(mainChips, id: \.0) { key, label in
          chipButton(label, on: chip == key, count: key == "devices" ? pending.count : 0) { pick(key) }
        }
        Menu {
          ForEach(AppTopic.more.filter { $0 != .mods || store.canManage }, id: \.self) { t in
            Button(t.label) { pick(t.rawValue) }
          }
        } label: {
          let on = AppTopic.more.contains { $0.rawValue == chip }
          chipLabel(on ? (topic?.label ?? "More") : "More", on: on, chevron: true)
        }
        .accessibilityIdentifier("market-more")
      }
      .padding(.horizontal, 18)
    }
    .padding(.horizontal, -18)
  }

  private func pick(_ key: String) {
    query = ""
    chip = chip == key && key != "all" ? "all" : key
  }

  private func chipButton(_ label: String, on: Bool, count: Int = 0, action: @escaping () -> Void) -> some View {
    Button(action: action) { chipLabel(count > 0 ? "\(label) \(count)" : label, on: on) }
      .buttonStyle(.plain).accessibilityAddTraits(on ? .isSelected : [])
  }

  private func chipLabel(_ text: String, on: Bool, chevron: Bool = false) -> some View {
    HStack(spacing: 4) {
      Text(text)
      if chevron { Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)) }
    }
    .font(.system(size: 13.5, weight: on ? .semibold : .regular))
    .foregroundStyle(on ? Palette.sheet : Palette.text)
    .padding(.horizontal, 13).frame(height: 32)
    .background(Capsule().fill(on ? Palette.text : Color.clear))
    .overlay(Capsule().strokeBorder(on ? Color.clear : Palette.hairline))
    .contentShape(Capsule())
  }

  // MARK: what shows

  @ViewBuilder private var content: some View {
    if chip == "installed" && !searching {
      installedTab
    } else if searching {
      section("Results") {
        if store.canManage && !pending.isEmpty { devicesSection(title: nil) }
        appRows(orderedApps, limit: 12)
        skillRows(shownSkills, limit: 12)
        modRows(matching: true)
      }
    } else {
      switch chip {
      case "apps":
        if let registryError { registryProblem(registryError) }
        appRows(orderedApps, limit: nil)
      case "skills":
        skillsTab
      case "devices":
        DeviceShelfList(shelves: shelves, query: needle, onBring: bringIn, onBringAll: { bringingAll = true }, onRefresh: refresh)
      case "mods":
        modRows(matching: false)
      case "iphone":
        ThisIPhoneList()
      case "all":
        allTab
      default:
        let list = orderedApps.filter { a in topic.map { topics(a).contains($0) } ?? false }
        section(topic?.label ?? "Apps") {
          if list.isEmpty && registry != nil {
            MarketNote(text: "Nothing here yet. Ask your agent to find one.")
          } else {
            appRows(list, limit: nil)
          }
        }
      }
    }
  }

  @ViewBuilder private var allTab: some View {
    let rec = apps.filter(recommended)
    let picked = pickedApps
    let recIds = Set(rec.map(\.id) + picked.map(\.app.id))
    if !rec.isEmpty || !picked.isEmpty {
      let picker = picks?.agentId.flatMap { store.agent($0) }
      section("Recommended", note: picker != nil && !picked.isEmpty ? "\(picker!.name) picked these from what you told it" : nil) {
        VStack(spacing: 0) {
          ForEach(rec) { appRow($0) }
          ForEach(picked, id: \.app.id) { appRow($0.app, why: $0.why) }
        }
      }
      .tourTarget("market-apps")
    }
    if store.canManage && !pending.isEmpty { devicesSection(title: "Your computers") }
    section("Apps", more: { chip = "apps" }) { appRows(orderedApps.filter { !recIds.contains($0.id) }, limit: 10) }
    section("Skills", more: { chip = "skills" }) { skillRows(takeTurns(shownSkills), limit: 6).tourTarget("market-skills") }
    makeYourOwn
  }

  private func section<C: View>(_ title: String, note: String? = nil, more: (() -> Void)? = nil, @ViewBuilder _ rows: () -> C) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
        if let note { Text(note).font(.system(size: 12.5)).foregroundStyle(Palette.faint).lineLimit(1) }
        Spacer()
        if let more { Button("Show all", action: more).font(.system(size: 13)).foregroundStyle(Palette.muted).buttonStyle(.plain) }
      }
      .padding(.horizontal, 2).padding(.top, 8)
      rows()
    }
  }

  @ViewBuilder private func devicesSection(title: String?) -> some View {
    let rows = pending.filter { needle.isEmpty || $0.item.name.localizedCaseInsensitiveContains(needle) }
    if !rows.isEmpty {
      VStack(alignment: .leading, spacing: 4) {
        if let title {
          HStack {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
            Spacer()
            if rows.count > 1 { Button("Bring all in") { bringingAll = true }.font(.system(size: 13)).foregroundStyle(Palette.muted).buttonStyle(.plain) }
          }.padding(.horizontal, 2).padding(.top, 8)
        }
        ForEach(rows.prefix(searching ? 12 : 4), id: \.id) { p in
          ConnectRowView(name: p.item.isSkill ? MarketText.skillTitle(p.item.name) : p.item.name, desc: "On \(p.device.nodeName)") {
            if p.item.isSkill { LineTile(symbol: "wand.and.stars") } else { AppTile(name: p.item.name, symbol: "desktopcomputer") }
          } trailing: {
            GoPill(title: "Bring in") { bringIn(p.device, p.item) }
          }
        }
      }
    }
  }

  @ViewBuilder private var skillsTab: some View {
    if sources.count > 2 {
      ChipRow(options: sources, selection: skillSource) { skillSource = skillSource == $0 ? "All" : $0 }
    }
    ForEach(skillList?.errors ?? [], id: \.self) { Text($0).font(.footnote).foregroundStyle(Palette.muted) }
    skillRows(shownSkills, limit: nil)
  }

  @ViewBuilder private var makeYourOwn: some View {
    if store.canManage {
      MarketLabel("Make or bring your own")
      CardGroup {
        Button { creating = true } label: { MarketRow(symbol: "hammer", title: "Create a skill") }.buttonStyle(.plain).accessibilityIdentifier("market-create-skill")
        Button { editor = ConnectorEditorTarget() } label: { MarketRow(symbol: "powerplug", title: "Add your own app") }.buttonStyle(.plain).accessibilityIdentifier("market-add-app")
        Button { importing = true } label: { MarketRow(symbol: "square.and.arrow.down", title: "Bring a skill in") }.buttonStyle(.plain)
      }
    }
  }

  @ViewBuilder private var installedTab: some View {
    let connectors = store.connectors.filter { match($0.name, $0.url, $0.command) }
    let connected = connectors.filter { $0.catalogId != nil }
    let own = connectors.filter { $0.catalogId == nil }
    let skills = store.skills.filter { match($0.name, $0.description) }
    if store.connectors.isEmpty {
      MarketNote(text: "Nothing connected yet")
    }
    if !connected.isEmpty {
      MarketLabel("Connected")
      CardGroup { ForEach(connected) { connectorRow($0) } }
    }
    if !own.isEmpty {
      MarketLabel("Your own apps")
      CardGroup { ForEach(own) { connectorRow($0) } }
    }
    MarketLabel("Skills")
    if store.skills.isEmpty { Text("No skills yet.").font(.system(size: 13)).foregroundStyle(Palette.muted).padding(.horizontal, 4) }
    else {
      CardGroup {
        ForEach(skills) { s in
          NavigationLink { SkillDetail(skill: s) } label: {
            MarketRow(symbol: MarketText.skillSymbol((s.slug ?? "") + " " + s.name), title: s.name, subtitle: "\(MarketText.origin(s)) · \(helpers(s))")
          }.buttonStyle(.plain)
        }
      }
    }
  }

  private func connectorRow(_ c: AppConnector) -> some View {
    NavigationLink { ConnectorDetail(connector: c) } label: {
      HStack(spacing: 12) {
        AppTile(name: c.name, ids: [c.catalogId], size: 40)
        VStack(alignment: .leading, spacing: 2) {
          Text(c.name).font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.text).lineLimit(1)
          Text(connectorLine(c)).font(.system(size: 13)).foregroundStyle(Palette.faint).lineLimit(1)
        }
        Spacer(minLength: 8)
        if c.enabled == false { MarketPill(text: "Off") }
        else if c.needsSignIn { MarketPill(text: "Sign in", tone: .warn) }
        else { DoneMark(word: "Connected") }
      }
      .padding(.horizontal, 16).padding(.vertical, 10).frame(minHeight: 60).contentShape(Rectangle())
    }.buttonStyle(.plain)
  }

  private func connectorLine(_ c: AppConnector) -> String {
    if let error = c.auth?.error { return error }
    if c.needsSignIn { return "Needs sign-in again" }
    if c.auth?.signedIn == true { return "Signed in" }
    return c.url ?? c.command ?? "Set up"
  }
  private func helpers(_ s: HelperSkill) -> String {
    if s.forAll { return "All agents" }
    let n = s.agentIds?.count ?? 0
    return n == 0 ? "no one yet" : "\(n) agent\(n == 1 ? "" : "s")"
  }

  // MARK: rows

  /** One app: its page opens from the row; Connect at the right signs in with one tap (catalog apps that can), else opens its page. */
  @ViewBuilder private func appRow(_ a: MarketApp, why: String? = nil) -> some View {
    let have = added(a)
    let oneTap = a.builtIn.flatMap { b in b.signIn != nil && (b.fields ?? []).isEmpty ? b.id : nil }
    let state = oneTap.map { connecting.state($0) } ?? .idle
    let failed: String? = if case .failed(let w) = state { w } else { nil }
    HStack(spacing: 8) {
      NavigationLink {
        if let entry = a.registry { MarketplaceDetail(entry: entry) }
        else if let c = a.builtIn { ConnectorCatalogDetail(entry: c, summary: MarketText.summary(builtIn: c)) }
      } label: {
        ConnectRowView(name: a.name, recommended: recommended(a), desc: failed ?? why ?? a.builtIn?.recommended ?? MarketText.whatItsFor(a.detail, max: 60)) {
          if recommended(a) { LineTile(symbol: "square.stack.3d.up") }
          else { AppTile(name: a.name, ids: [a.builtIn?.id], sources: a.registry?.logos, symbol: "powerplug") }
        } trailing: { EmptyView() }
      }
      .buttonStyle(.plain)
      if have || state == .on {
        DoneMark(word: "Connected")
      } else if state == .out, let oneTap {
        HStack(spacing: 6) {
          ProgressView().controlSize(.small).accessibilityLabel("Finish signing in")
          Button("Cancel") { connecting.cancel(oneTap) }.font(.system(size: 13)).foregroundStyle(Palette.muted).buttonStyle(.plain)
        }
      } else if store.canManage {
        if let oneTap {
          GoPill(title: failed == nil ? "Connect" : "Try again") { Task { await connecting.connect(oneTap, name: a.name, store: store) } }
            .accessibilityLabel("Connect \(a.name)")
        } else {
          NavigationLink {
            if let entry = a.registry { MarketplaceDetail(entry: entry) }
            else if let c = a.builtIn { ConnectorCatalogDetail(entry: c, summary: MarketText.summary(builtIn: c)) }
          } label: { GoPillLabel(title: "Connect") }
            .buttonStyle(.press)
            .accessibilityLabel("Connect \(a.name)")
        }
      }
    }
  }

  @ViewBuilder private func appRows(_ list: [MarketApp], limit: Int?) -> some View {
    if registry == nil && list.isEmpty {
      ProgressView().frame(maxWidth: .infinity)
    } else if list.isEmpty {
      Text(needle.isEmpty ? "No apps here yet." : "No apps match \"\(needle)\".").font(.system(size: 13)).foregroundStyle(Palette.muted).padding(.horizontal, 4)
    }
    VStack(spacing: 0) {
      ForEach(Array(list.prefix(limit ?? list.count))) { appRow($0) }
    }
    if let registryError, limit != nil { registryProblem(registryError) }
  }

  @ViewBuilder private func skillRows(_ list: [MarketSkill], limit: Int?) -> some View {
    if skillList == nil && list.isEmpty {
      ProgressView().frame(maxWidth: .infinity)
    } else if list.isEmpty {
      Text(needle.isEmpty ? "No skills here yet." : "No skills match \"\(needle)\".").font(.system(size: 13)).foregroundStyle(Palette.muted).padding(.horizontal, 4)
    }
    VStack(spacing: 0) {
      ForEach(Array(list.prefix(limit ?? list.count))) { s in
        HStack(spacing: 8) {
          NavigationLink { skillPage(s) } label: {
            ConnectRowView(name: s.name, desc: s.detail.isEmpty ? (s.who == "Bubble AI" ? "Made by Bubble AI" : "From \(s.who)") : s.detail) {
              LineTile(symbol: MarketText.skillSymbol(s.id + " " + s.name))
            } trailing: { EmptyView() }
          }.buttonStyle(.plain)
          if installed(s) != nil { DoneMark(word: "Added") }
          else if store.canManage {
            NavigationLink { skillPage(s) } label: { GoPillLabel(title: s.store?.license.open == false ? "View" : "Add") }
              .buttonStyle(.press)
          }
        }
      }
    }
  }

  @ViewBuilder private func skillPage(_ s: MarketSkill) -> some View {
    if let have = installed(s) { SkillDetail(skill: have) }
    else if let lib = s.library { SkillDetail(skill: lib, library: true) }
    else if let entry = s.store { StoreSkillDetail(skill: entry) }
  }

  /** Mods change the whole app: on with one tap for owners (ones that reach outside ask first). */
  @ViewBuilder private func modRows(matching: Bool) -> some View {
    let keys = FeatureKey.allCases.filter { !matching || match($0.name, $0.detail, "mod") }
    if store.canManage && !keys.isEmpty {
      VStack(alignment: .leading, spacing: 0) {
        if !matching { Text("Mods").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted).padding(.horizontal, 2).padding(.top, 8).padding(.bottom, 4) }
        ForEach(keys) { k in
          HStack(spacing: 8) {
            NavigationLink { FeaturesView() } label: {
              ConnectRowView(name: k.name, desc: "A mod: \(k.detail.prefix(1).lowercased() + k.detail.dropFirst())") { LineTile(symbol: k.symbol) } trailing: { EmptyView() }
            }.buttonStyle(.plain)
            if store.features[k] { DoneMark(word: "On") }
            else if store.isOwner { GoPill(title: "Add") { if FeaturesView.needOk.contains(k) { askingMod = k } else { setMod(k) } } }
          }
        }
        if !store.isOwner { Text("Only owners can change mods.").font(.system(size: 13)).foregroundStyle(Palette.muted).padding(.top, 6) }
      }
    }
  }

  private func setMod(_ k: FeatureKey) {
    var next = store.features
    next[k] = true
    modAction.run { try await store.setFeatures(next) }
  }

  private func registryProblem(_ message: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(message).font(.footnote).foregroundStyle(Palette.red)
      Button("Try again") { Task { await searchRegistry() } }.font(.footnote)
    }.padding(.horizontal, 4)
  }

  // MARK: loading

  private func loadAll() async {
    library = (try? NativeCatalog.read("SkillCatalog", as: [HelperSkill].self)) ?? []
    // apps that only sign in connect with one tap from their row (round 9)
    builtIn = (try? NativeCatalog.read("ConnectorCatalog", as: [AppConnector].self)) ?? []
    do { try await store.refreshConnectors(); try await store.refreshSkills() } catch { action.error = error.localizedDescription }
    do { skillList = try await store.skillStore() }
    catch { skillList = SkillStoreList(skills: [], errors: ["Couldn't load the skill store: \(error.localizedDescription)"]) }
    if store.canManage { shelves = (try? await store.deviceShelves()) ?? [] }
  }

  private func searchRegistry() async {
    if !needle.isEmpty { try? await Task.sleep(for: .milliseconds(350)) }
    if Task.isCancelled { return }
    do {
      let found = try await store.marketplace(needle)
      if !Task.isCancelled { registry = found; registryError = nil }
    } catch {
      if !Task.isCancelled { registryError = error.localizedDescription; registry = registry ?? [] }
    }
  }

  private func refresh(_ d: DeviceShelf) {
    action.run {
      try await store.refreshShelf(d.nodeId)
      try await Task.sleep(for: .milliseconds(2500))
      shelves = try await store.deviceShelves()
    }
  }
}
