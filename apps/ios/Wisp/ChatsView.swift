import SwiftUI

/** One line in the Chats list: an agent's direct chat or a team. */
struct ChatEntry: Identifiable, Hashable {
  enum Kind: Hashable { case agent(Agent), team(Channel) }
  var kind: Kind
  /** the agent's direct chat (nil until the first message makes it) or the team's chat */
  var channel: Channel?
  var last: Message?
  /** when it was last active: its newest loaded message, else what the channel list says */
  var lastAt: Date? { last?.date ?? channel?.last.flatMap { Wire.date($0.at) } }

  var id: String {
    switch kind {
    case .agent(let a): "agent:\(a.id)"
    case .team(let c): "team:\(c.id)"
    }
  }
  var name: String {
    switch kind {
    case .agent(let a): a.name
    case .team(let c): c.name
    }
  }
  var isTeam: Bool { if case .team = kind { true } else { false } }
  /** the key the hub's chat layout (UserPrefs.sidebar) uses: "a:<agentId>" or "c:<channelId>" */
  var key: String {
    switch kind {
    case .agent(let a): "a:\(a.id)"
    case .team(let c): "c:\(c.id)"
    }
  }
  var pinned: Bool { channel?.starred == true }
  var sectionId: String? { isTeam ? channel?.sectionId : nil }
  var badge: Int { channel?.badge ?? 0 }
}

/** What the Chats list shows and in what order. Pure, so it can be tested. */
enum ChatList {
  /** Agents' chats and teams in one flat list: pinned first, then the most recent, then by name. */
  static func entries(agents: [Agent], channels: [Channel], messages: [String: [Message]], dmAgent: (Channel) -> Agent?) -> [ChatEntry] {
    var out: [ChatEntry] = []
    for agent in agents {
      let dm = channels.first { $0.isDM && dmAgent($0)?.id == agent.id }
      out.append(ChatEntry(kind: .agent(agent), channel: dm, last: dm.flatMap { messages[$0.id]?.last }))
    }
    for c in channels where !c.isDM && c.joined == true && c.archivedAt == nil {
      out.append(ChatEntry(kind: .team(c), channel: c, last: messages[c.id]?.last))
    }
    return out.sorted { a, b in
      if a.pinned != b.pinned { return a.pinned }
      let (da, db) = (a.lastAt, b.lastAt)
      if da != db { return (da ?? .distantPast) > (db ?? .distantPast) }
      return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }
  }

  /** "9:36 PM" today, "Oct 23" before. */
  static func timeText(_ date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
    if calendar.isDate(date, inSameDayAs: now) { return date.formatted(date: .omitted, time: .shortened) }
    if calendar.isDate(date, equalTo: now, toGranularity: .year) { return date.formatted(.dateTime.month(.abbreviated).day()) }
    return date.formatted(.dateTime.month(.abbreviated).day().year())
  }
}

/**
 * Your agents and teams in one list (2026-11-25 "Wisp, bubbles", phone list): search and +, up to
 * 9 pins in a 3×3 grid, All / Your turn, then your sections and No section. Pins and sections are
 * kept in the hub (UserPrefs.sidebar), the same as on the desktop. Press and hold a chat for its menu.
 */
struct ChatsView: View {
  @Environment(Store.self) private var store
  @Environment(\.openSettings) private var openSettings
  @Environment(\.openOrganizations) private var openOrganizations
  @State private var path = NavigationPath()
  @State private var search = ""
  @FocusState private var searchFocused: Bool
  @State private var sheet: String?
  @State private var action = FormAction()
  /** what the hub found for the search box, with the text it was found for */
  @State private var found: (query: String, results: SearchResults)?
  @State private var searching = false
  @AppStorage("wisp.chats.filter", store: WispPreferences.standard) private var filter = "all"
  /** "9 pinned is the most…" */
  @State private var notice: String?
  @State private var renaming: ChatEntry?
  @State private var renamingSection: SideLayout.Placed?
  @State private var newName = ""
  @State private var deleting: ChatEntry?
  @State private var leaving: ChatEntry?

  private var query: String { search.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var searchMode: Bool { searchFocused || !query.isEmpty }
  private var guest: Bool { store.role == "guest" }

  private var entries: [ChatEntry] {
    ChatList.entries(agents: store.agents, channels: store.channels, messages: store.messages, dmAgent: store.dmAgent)
  }
  private var matches: [ChatEntry] {
    entries.filter { e in
      query.isEmpty || e.name.localizedCaseInsensitiveContains(query) || { if case .agent(let a) = e.kind { a.handle.localizedCaseInsensitiveContains(query) } else { false } }()
    }
  }
  private var layoutChats: [SideLayout.Chat] {
    entries.map { SideLayout.Chat(key: $0.key, pinned: $0.pinned, sectionId: $0.sectionId, unread: $0.badge) }
  }
  private var layout: SidebarLayout { SideLayout.base(store.prefs?.sidebar, chats: layoutChats, sections: store.sections) }

  var body: some View {
    NavigationStack(path: $path) {
      VStack(spacing: 0) {
        searchRow
        list
      }
      .background(Palette.ground.ignoresSafeArea())
      .toolbar(.hidden, for: .navigationBar)
      .animation(Motion.settle, value: searchMode)
      .task(id: query) { await runSearch() }
      .chatDestinations()
      .sheet(isPresented: Binding(get: { sheet != nil }, set: { if !$0 { sheet = nil } })) {
        switch sheet {
        case "team": NewChannel(onBrowse: { sheet = "browse" }) { path.append($0) }
        case "browse": BrowseChannels { path.append($0) }
        // a new agent has already said hello in its DM, so that's where you land
        case "agent": AddAgent { agent in Task { if let ch = try? await store.dm(with: agent) { path.append(ch) } else { path.append(agent) } } }
        case "chat": NewChatSheet(onNewAgent: store.canManage ? { sheet = "agent" } : nil) { path.append($0) }
        default: EmptyView()
        }
      }
      .alert("Rename \(renaming?.name ?? "")", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
        TextField("Name", text: $newName).textInputAutocapitalization(.words)
        Button("Cancel", role: .cancel) {}
        Button("Save") { if let e = renaming { rename(e, newName) } }
      }
      .alert("Rename section", isPresented: Binding(get: { renamingSection != nil }, set: { if !$0 { renamingSection = nil } })) {
        TextField("Name", text: $newName)
        Button("Cancel", role: .cancel) {}
        Button("Save") { if let s = renamingSection { save(SideLayout.renameSection(layout, s.id, newName)) } }
      }
      .confirmationDialog("Delete \(deleting?.name ?? "")?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
        Button("Delete", role: .destructive) { if let e = deleting { delete(e) } }
        Button("Keep it", role: .cancel) {}
      } message: {
        Text(deleting?.isTeam == true ? "Its messages and threads are deleted for everyone. This can't be undone." : "Its notes and personality stay in memory. Its schedules and chats stop.")
      }
      .confirmationDialog("Leave \(leaving?.name ?? "")?", isPresented: Binding(get: { leaving != nil }, set: { if !$0 { leaving = nil } }), titleVisibility: .visible) {
        Button("Leave team", role: .destructive) { if let id = leaving?.channel?.id { action.run { try await store.leaveChannel(id) } } }
      }
      .managementAlert(action)
    }
    .task(id: store.route) { await open(store.route) }
    .task(id: entries.count) { await warmPreviews() }
  }

  // MARK: top of the page

  /** Search and + on one line (and your profile, for Settings and other workspaces). */
  private var searchRow: some View {
    HStack(spacing: 8) {
      if !searchMode {
        Button { openSettings() } label: { ProfileCircle(size: 38) }
          .buttonStyle(.press)
          .accessibilityIdentifier("profile-button")
          .contextMenu { Button("Switch workspace", systemImage: "building.2") { openOrganizations() } }
      }
      HStack(spacing: 8) {
        Image(systemName: "magnifyingglass").font(.system(size: 16, weight: .medium)).foregroundStyle(Palette.faint)
        TextField("Search", text: $search)
          .font(.system(size: 16)).foregroundStyle(Palette.text)
          .focused($searchFocused)
          .submitLabel(.search)
          .textInputAutocapitalization(.never).autocorrectionDisabled()
          .accessibilityIdentifier("chats-search")
        if !search.isEmpty {
          Button { search = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Palette.faint) }
            .buttonStyle(.plain).accessibilityLabel("Clear")
        }
      }
      .padding(.horizontal, 14).frame(height: 38)
      .background(Capsule().fill(Palette.field))
      if searchMode {
        Button("Cancel") { search = ""; searchFocused = false }
          .font(.system(size: 15)).foregroundStyle(Palette.text).buttonStyle(.plain)
      } else {
        Menu {
          Button("New chat", systemImage: "square.and.pencil") { sheet = "chat" }
          if store.canManage {
            Button("New agent", systemImage: "sparkles") { sheet = "agent" }
            Button("New team", systemImage: "person.2") { sheet = "team" }
          } else {
            Button("Browse teams", systemImage: "magnifyingglass") { sheet = "browse" }
          }
          if !guest { Button("New section", systemImage: "folder.badge.plus") { newSection() } }
        } label: { CircleLabel(symbol: "plus", size: 38, weight: .regular) }
          .accessibilityLabel("New chat, agent or team").accessibilityIdentifier("new-menu")
      }
    }
    .padding(.horizontal, 16).padding(.top, 6).padding(.bottom, 8)
  }

  // MARK: the list

  private var list: some View {
    List {
      if searchMode {
        searchRows
      } else {
        chatRows
      }
    }
    .listStyle(.plain)
    .scrollContentBackground(.hidden)
    .listRowSpacing(0)
    .environment(\.defaultMinListRowHeight, 1)
    .refreshable {
      await store.refreshChannels()
      await store.refreshApprovals()
      await store.refreshComputers()
      do { try await store.refreshAgents(); try await store.refreshManagement() }
      catch { action.error = error.localizedDescription }
    }
    .overlay {
      if !searchMode && store.agents.isEmpty && entries.isEmpty {
        ContentUnavailableView {
          Label("Add your first agent", systemImage: "sparkles")
        } description: {
          Text("Give it a job and a computer.")
        } actions: {
          if store.canManage { Button("New agent") { sheet = "agent" }.primaryButton() }
        }
      }
    }
  }

  private func plain<V: View>(_ v: V) -> some View {
    v.listRowInsets(EdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12))
      .listRowSeparator(.hidden)
      .listRowBackground(Color.clear)
  }

  @ViewBuilder private var chatRows: some View {
    let all = entries
    let byKey = Dictionary(all.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
    let l = layout
    let placed = SideLayout.place(l, chats: layoutChats)
    if let notice {
      plain(SuggestionBanner(symbol: "pin", text: notice, onClose: { self.notice = nil }, closeLabel: "OK").padding(.horizontal, -12).padding(.bottom, 8))
    }
    let pins = placed.pins.compactMap { byKey[$0] }
    if !pins.isEmpty { plain(pinGrid(pins, layout: l)) }
    plain(filterTabs(all))
    if filter == "turn" {
      let waiting = all.filter(needsYou)
      ForEach(Array(waiting.enumerated()), id: \.element.id) { i, e in rowView(e, i, layout: l) }
      plain(Text(waiting.isEmpty ? "Nobody is waiting on you." : "Everyone else is under All.")
        .font(.system(size: 13)).foregroundStyle(Palette.muted).padding(.horizontal, 6).padding(.top, 10).padding(.bottom, 6))
    } else {
      let shown = placed.sections.filter { !$0.isNone || !$0.keys.isEmpty || placed.sections.count == 1 }
      ForEach(shown) { section in
        let rows = section.keys.compactMap { byKey[$0] }
        if !(section.isNone && l.sections.isEmpty) { plain(sectionHeader(section, count: rows.count, layout: l)) }
        if !section.folded {
          ForEach(Array(rows.enumerated()), id: \.element.id) { i, e in rowView(e, i, layout: l) }
          if !section.isNone && rows.isEmpty {
            plain(Text("Hold an agent or team, then choose Move to section")
              .font(.system(size: 13)).foregroundStyle(Palette.muted)
              .frame(maxWidth: .infinity).frame(height: 52)
              .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.hairline, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
              .padding(.horizontal, 4).padding(.bottom, 6))
          }
        }
      }
      if !guest {
        plain(Button { newSection() } label: {
          Label("New section", systemImage: "plus").font(.system(size: 14)).foregroundStyle(Palette.muted)
            .frame(maxWidth: .infinity, alignment: .leading).frame(height: 40).padding(.horizontal, 6).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier("new-section"))
      }
    }
  }

  // MARK: pins

  private func pinCell(_ e: ChatEntry, layout l: SidebarLayout) -> some View {
    VStack(spacing: 6) {
      ChatAvatar(entry: e, size: 70)
        .overlay(alignment: .topTrailing) { dot(e, size: 70, layout: l) }
      Text(e.name).font(.system(size: 14, weight: isUnread(e, l) ? .semibold : .regular))
        .foregroundStyle(isUnread(e, l) ? Palette.text : Palette.muted).lineLimit(1).frame(maxWidth: 96)
    }
  }

  private func pinGrid(_ pins: [ChatEntry], layout l: SidebarLayout) -> some View {
    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 3), spacing: 4) {
      ForEach(pins) { e in
        // A menu whose tap opens the chat: inside one List row, .contextMenu on several pins
        // would all show the first pin's menu, so each pin holds its own.
        Menu { menu(e, layout: l) } label: {
          pinCell(e, layout: l)
            .frame(maxWidth: .infinity).frame(height: 100)
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        } primaryAction: { openEntry(e) }
        .menuStyle(.button)
        .buttonStyle(.press)
        .accessibilityLabel("\(e.name), pinned\(isUnread(e, l) ? ", unread" : "")\(needsYou(e) ? ", needs you" : "")")
        .accessibilityIdentifier("pin")
      }
    }
    .padding(.bottom, 6)
    .accessibilityElement(children: .contain).accessibilityLabel("Pinned")
  }

  /** a blue dot when unread, orange when a team waits on you (an agent's own bubble shows that) */
  @ViewBuilder private func dot(_ e: ChatEntry, size: CGFloat, layout l: SidebarLayout) -> some View {
    let d = max(8, size * 0.22)
    if needsYou(e) && e.isTeam {
      Circle().fill(Color(hex: 0xFF9F0A)).frame(width: d, height: d).overlay(Circle().stroke(Palette.ground, lineWidth: 2)).offset(x: 2, y: -2)
    } else if !needsYou(e) && isUnread(e, l) {
      Circle().fill(Color(hex: 0x0A84FF)).frame(width: d, height: d).overlay(Circle().stroke(Palette.ground, lineWidth: 2)).offset(x: 2, y: -2)
    }
  }

  // MARK: All / Your turn

  private func filterTabs(_ all: [ChatEntry]) -> some View {
    let waiting = all.filter(needsYou).count
    return HStack(spacing: 0) {
      ForEach(["all", "turn"], id: \.self) { f in
        Button { withAnimation(Motion.settle) { filter = f } } label: {
          HStack(spacing: 4) {
            Text(f == "all" ? "All" : "Your turn")
            if f == "turn" && waiting > 0 { Text("\(waiting)").fontWeight(.bold).foregroundStyle(Color(light: 0xB25E00, dark: 0xFF9F0A)) }
          }
          .font(.system(size: 15, weight: filter == f ? .semibold : .regular))
          .foregroundStyle(filter == f ? Palette.text : Palette.muted)
          .frame(maxWidth: .infinity).frame(height: 32)
          .background { if filter == f { RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Palette.control).shadow(color: .black.opacity(0.12), radius: 1.5, y: 1) } }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(filter == f ? [.isSelected] : [])
        .accessibilityIdentifier(f == "all" ? "filter-all" : "filter-turn")
      }
    }
    .padding(3)
    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.field))
    .padding(.horizontal, 4).padding(.bottom, 6)
  }

  // MARK: rows and sections

  private func rowView(_ entry: ChatEntry, _ index: Int = 0, layout l: SidebarLayout? = nil) -> some View {
    ChatRow(entry: entry, unread: l.map { isUnread(entry, $0) } ?? (entry.badge > 0), open: { openEntry(entry) }, path: $path) {
      if let l { menu(entry, layout: l) }
    }
    .rowEntrance(index)
    .listRowInsets(EdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12))
    .listRowSeparator(.hidden)
    .listRowBackground(Color.clear)
  }

  private func sectionHeader(_ s: SideLayout.Placed, count: Int, layout l: SidebarLayout) -> some View {
    Button {
      withAnimation(Motion.settle) { save(SideLayout.fold(l, s.id, !s.folded)) }
    } label: {
      HStack(spacing: 6) {
        Image(systemName: "chevron.down").font(.system(size: 12, weight: .bold)).rotationEffect(.degrees(s.folded ? -90 : 0))
        Text(s.name).font(.system(size: 15, weight: .medium)).lineLimit(1)
        if count > 0 { Text("\(count)").font(.system(size: 15)) }
        Spacer()
      }
      .foregroundStyle(Palette.muted)
      .padding(.horizontal, 6).frame(height: 36)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(s.name), \(count) \(count == 1 ? "chat" : "chats"), \(s.folded ? "collapsed" : "expanded")")
    .contextMenu {
      if !guest && !s.isNone {
        Button("Rename section", systemImage: "pencil") { newName = s.name; renamingSection = s }
        Button("Delete section", systemImage: "trash", role: .destructive) { save(SideLayout.deleteSection(l, s.id)) }
      }
    }
  }

  /** Press and hold (board 7): Pin, Move to section, Mark as unread, Rename, Hide, and the rest of what a chat can do. */
  @ViewBuilder private func menu(_ e: ChatEntry, layout l: SidebarLayout) -> some View {
    let pinned = l.pins.contains(e.key)
    let channel = e.channel.flatMap { c in store.channels.first { $0.id == c.id } } ?? e.channel
    let muted = channel?.isMuted == true
    if pinned { Button("Unpin", systemImage: "pin.slash") { unpin(e, l) } }
    else { Button("Pin", systemImage: "pin") { pin(e, l) } }
    if !guest {
      let here = l.sections.first { $0.items.contains(e.key) }?.id ?? SideLayout.none
      Menu("Move to section", systemImage: "folder") {
        Button { move(e, to: SideLayout.none, l) } label: { Label("No section", systemImage: here == SideLayout.none && !pinned ? "checkmark" : "tray") }
        ForEach(l.sections, id: \.id) { s in
          Button { move(e, to: s.id, l) } label: { Label(s.name, systemImage: here == s.id && !pinned ? "checkmark" : "folder") }
        }
        Button("New section", systemImage: "plus") { newSection(with: e) }
      }
    }
    if isUnread(e, l) {
      Button("Mark as read", systemImage: "checkmark.message") {
        save(SideLayout.clearUnread(l, e.key))
        if let id = channel?.id, e.badge > 0 { action.run { try await store.readChannel(id) } }
      }
    } else {
      Button("Mark as unread", systemImage: "message.badge") { save(SideLayout.markUnread(l, e.key)) }
    }
    if canRename(e) { Button("Rename", systemImage: "pencil") { newName = e.name; renaming = e } }
    Button("Hide", systemImage: "eye.slash") { save(SideLayout.hide(l, e.key)) }
    Button(muted ? "Unmute" : "Mute", systemImage: muted ? "bell" : "bell.slash") {
      action.run { let c = try await ensureChannel(e); try await store.setChannelPrefs(c.id, ["notify": AnyEncodable(muted ? "default" : "mute")]) }
    }
    if case .agent(let a) = e.kind { Button("Agent profile", systemImage: "person.crop.circle") { path.append(store.agent(a.id) ?? a) } }
    if e.isTeam, channel?.name != "general" { Button("Leave team", systemImage: "rectangle.portrait.and.arrow.right") { leaving = e } }
    if store.canManage, !(e.isTeam && channel?.name == "general") {
      Button("Delete", systemImage: "trash", role: .destructive) { deleting = e }
    }
  }

  // MARK: what the menu does

  private func isUnread(_ e: ChatEntry, _ l: SidebarLayout) -> Bool { e.badge > 0 || (l.unread ?? []).contains(e.key) }

  /** Waiting on you: an agent that needs signing in, an approval, or a chat that waits for your answer (web: preview line "needs"). */
  private func needsYou(_ e: ChatEntry) -> Bool {
    if case .agent(let a) = e.kind, (store.agent(a.id) ?? a).needsSignIn { return true }
    let channel = e.channel.flatMap { c in store.channels.first { $0.id == c.id } } ?? e.channel
    if store.role != "guest", let id = channel?.id, store.pendingApprovals.contains(where: { $0.channelId == id }) { return true }
    if let c = channel, case .waiting = Loops.listLine(c) { return true }
    return false
  }

  private func canRename(_ e: ChatEntry) -> Bool {
    guard store.canManage else { return false }
    if e.isTeam { return e.channel?.name != "general" }
    return true
  }

  private func save(_ next: SidebarLayout) {
    guard next != store.prefs?.sidebar else { return }
    action.run { try await store.saveSidebar(next) }
  }

  private func pin(_ e: ChatEntry, _ l: SidebarLayout) {
    guard let next = SideLayout.pin(l, e.key) else {
      withAnimation(Motion.settle) { notice = SideLayout.pinsFullNotice(e.name) }
      return
    }
    notice = nil
    save(next)
    if let id = e.channel?.id, e.channel?.starred != true { Task { try? await store.setChannelPrefs(id, ["starred": AnyEncodable(true)]) } }
  }

  private func unpin(_ e: ChatEntry, _ l: SidebarLayout) {
    save(SideLayout.unpin(l, e.key))
    if let id = e.channel?.id, e.channel?.starred == true { Task { try? await store.setChannelPrefs(id, ["starred": AnyEncodable(false)]) } }
  }

  private func move(_ e: ChatEntry, to id: String, _ l: SidebarLayout) {
    let wasPinned = l.pins.contains(e.key)
    save(SideLayout.move(l, e.key, to: id))
    if wasPinned, let cid = e.channel?.id, e.channel?.starred == true { Task { try? await store.setChannelPrefs(cid, ["starred": AnyEncodable(false)]) } }
  }

  private func newSection(with e: ChatEntry? = nil) {
    let l = layout
    let id = "s\(String(Int(Date().timeIntervalSince1970 * 1000), radix: 36))"
    let name = SideLayout.newSectionName(l)
    filter = "all"
    save(SideLayout.addSection(l, name: name, id: id, key: e?.key))
    newName = name
    renamingSection = SideLayout.Placed(id: id, name: name, folded: false, keys: [])
  }

  private func rename(_ e: ChatEntry, _ name: String) {
    let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !clean.isEmpty, clean != e.name else { return }
    action.run {
      switch e.kind {
      case .agent(let a): _ = try await store.updateAgent(a.id, ["name": AnyEncodable(String(clean.prefix(80)))])
      case .team(let c):
        let slug = ManagementText.channelName(clean)
        guard !slug.isEmpty else { return }
        try await store.updateChannel(c.id, ["name": AnyEncodable(slug)])
      }
    }
  }

  private func delete(_ e: ChatEntry) {
    let l = layout
    action.run {
      switch e.kind {
      case .agent(let a): try await store.deleteAgent(a.id)
      case .team(let c): try await store.deleteChannel(c.id)
      }
      try? await store.saveSidebar(SideLayout.forget(l, e.key))
    }
  }

  /** the chat to change a setting on; an agent's chat is made the first time you do */
  private func ensureChannel(_ e: ChatEntry) async throws -> Channel {
    if let c = e.channel { return c }
    guard case .agent(let a) = e.kind else { throw API.Failure(status: 0, message: "That chat isn't available.") }
    return try await store.dm(with: a)
  }

  // MARK: search

  @ViewBuilder private var searchRows: some View {
    let chats = matches.filter { !$0.isTeam }
    let teams = matches.filter { $0.isTeam }
    if !chats.isEmpty { Section { ForEach(chats) { rowView($0, layout: layout) } } header: { searchHeader("Chats") } }
    if !teams.isEmpty { Section { ForEach(teams) { rowView($0, layout: layout) } } header: { searchHeader("Teams") } }
    if !query.isEmpty { searchResults(shown: matches) }
  }

  private func searchHeader(_ title: String) -> some View {
    Text(title).font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.muted)
      .padding(.horizontal, 6).padding(.top, 10)
      .listRowInsets(EdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12))
  }

  @ViewBuilder private func searchResults(shown: [ChatEntry]) -> some View {
    if let found, found.query == query {
      SearchResultsSections(
        results: found.results, query: query,
        shownChannels: Set(shown.compactMap { $0.isTeam ? $0.channel?.id : nil }),
        shownAgents: Set(shown.compactMap { if case .agent(let a) = $0.kind { a.id } else { nil } }),
        open: openResult
      )
      if found.results.isEmpty && shown.isEmpty {
        Section { Text("Nothing found for “\(query)”.").foregroundStyle(Palette.muted) }
      }
    } else if searching {
      Section { HStack(spacing: 8) { ProgressView(); Text("Searching…").foregroundStyle(Palette.muted) } }
    }
  }

  /** Asks the hub once typing pauses; a newer search drops this one. */
  private func runSearch() async {
    guard !query.isEmpty else { found = nil; searching = false; return }
    searching = true
    try? await Task.sleep(for: .milliseconds(250))
    guard !Task.isCancelled else { return }
    let q = query
    let results = try? await store.search(q)
    guard !Task.isCancelled else { return }
    found = results.map { (q, $0) }
    searching = false
  }

  // MARK: opening things

  /** Loads the newest messages of the first chats, so each row can say what was said last. */
  private func warmPreviews() async {
    for entry in entries.prefix(25) {
      guard let id = entry.channel?.id, store.messages[id] == nil, !Task.isCancelled else { continue }
      try? await store.loadMessages(id)
    }
  }

  private func openEntry(_ entry: ChatEntry) {
    // opening a chat you marked unread clears the mark
    let l = layout
    if (l.unread ?? []).contains(entry.key) { save(SideLayout.clearUnread(l, entry.key)) }
    if let channel = entry.channel { path.append(channel); return }
    if case .agent(let agent) = entry.kind {
      action.run { path.append(try await store.dm(with: agent)) }
    }
  }

  private func openResult(_ target: SearchTarget) {
    action.run {
      switch target {
      case .channel(let c):
        if c.joined != true && c.isDM == false { try await store.joinChannel(c.id); await store.refreshChannels() }
        path.append(store.channels.first { $0.id == c.id } ?? c)
      case .agent(let a):
        path.append(try await store.dm(with: store.agent(a.id) ?? a))
      case .message(let m):
        if !store.channels.contains(where: { $0.id == m.message.channelId }) { await store.refreshChannels() }
        guard let ch = store.channels.first(where: { $0.id == m.message.channelId }) else {
          throw API.Failure(status: 404, message: "That conversation isn't available any more.")
        }
        path.append(ch)
        if let thread = m.message.threadId { path.append(ThreadRef(channelId: ch.id, rootId: thread)) }
      case .note(let notePath):
        path.append(ChatsScreen.note(path: notePath))
      }
      search = ""
      searchFocused = false
    }
  }

  private func open(_ route: Route?) async {
    guard case .chat(let channelId, let threadId) = route else { return }
    if !store.channels.contains(where: { $0.id == channelId }) { await store.refreshChannels() }
    store.route = nil
    guard let ch = store.channels.first(where: { $0.id == channelId }) else { return }
    var p = NavigationPath()
    p.append(ch)
    if let threadId { p.append(ThreadRef(channelId: channelId, rootId: threadId)) }
    path = p
  }
}

/** A chat's bubble: an agent's own, or a team's image or its first two agents' bubbles overlapped. */
struct ChatAvatar: View {
  @Environment(Store.self) private var store
  var entry: ChatEntry
  var size: CGFloat

  var body: some View {
    switch entry.kind {
    case .agent(let a): AgentAvatar(agent: store.agent(a.id) ?? a, size: size, showStatus: false)
    case .team(let c): TeamGhosts(agents: c.iconAgents(store.agents), seed: c.name, size: size, iconFileId: c.settings?.iconFileId).frame(width: size, height: size)
    }
  }
}

/** A row (80pt): the bubble, its name and time, and up to two lines of what was said or what it's doing. */
struct ChatRow<Menu: View>: View {
  @Environment(Store.self) private var store
  var entry: ChatEntry
  var unread: Bool
  var open: () -> Void
  @Binding var path: NavigationPath
  @ViewBuilder var menu: Menu
  @State private var action = FormAction()

  private var channel: Channel? { entry.channel.flatMap { c in store.channels.first { $0.id == c.id } } ?? entry.channel }
  private var muted: Bool { channel?.isMuted == true }

  var body: some View {
    Button(action: open) {
      HStack(spacing: 12) {
        ChatAvatar(entry: entry, size: 48)
          .overlay(alignment: .topTrailing) {
            if unread && !needsTeam {
              Circle().fill(Color(hex: 0x0A84FF)).frame(width: 11, height: 11).overlay(Circle().stroke(Palette.ground, lineWidth: 2)).offset(x: 2, y: -2)
            } else if needsTeam {
              Circle().fill(Color(hex: 0xFF9F0A)).frame(width: 11, height: 11).overlay(Circle().stroke(Palette.ground, lineWidth: 2)).offset(x: 2, y: -2)
            }
          }
        VStack(alignment: .leading, spacing: 2) {
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(entry.name).font(.system(size: 17, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
            Spacer(minLength: 8)
            if muted { Image(systemName: "bell.slash").font(.system(size: 12)).foregroundStyle(Palette.faint).accessibilityLabel("Muted") }
            if let at = entry.lastAt { Text(ChatList.timeText(at)).font(.system(size: 14)).foregroundStyle(Palette.muted) }
          }
          HStack(alignment: .top, spacing: 8) {
            subtitle
            Spacer(minLength: 0)
            if entry.badge > 0 { UnreadBadge(count: entry.badge) }
          }
        }
        .frame(maxHeight: .infinity)
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.separator).frame(height: 0.5) }
        .opacity(muted ? 0.6 : 1)
      }
      .padding(.leading, 4)
      .frame(height: 80)
      .contentShape(Rectangle())
    }
    .buttonStyle(.pressRow)
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier(entry.isTeam ? "team-row" : "chat-row")
    .contextMenu { menu }
    .swipeActions(edge: .leading, allowsFullSwipe: false) {
      if channel != nil { Button("Mark as read", systemImage: "checkmark") { action.run { try await store.readChannel(channel!.id) } }.tint(.blue) }
    }
    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
      muteButton.tint(.gray)
    }
    .managementAlert(action)
  }

  /** a team that waits on you gets the orange dot (an agent's bubble hops with its own) */
  private var needsTeam: Bool {
    guard entry.isTeam, store.role != "guest", let id = channel?.id else { return false }
    return store.pendingApprovals.contains { $0.channelId == id }
  }

  /** an agent is replying in this team right now */
  private var workingHere: Agent? {
    guard let id = channel?.id else { return nil }
    return store.activityChannel.compactMap { agentId, ch in ch == id ? store.agent(agentId) : nil }.first { $0.status == .busy }
  }

  private static var line: Font { .system(size: 15) }

  @ViewBuilder private var subtitle: some View {
    if case .agent(let a) = entry.kind, (store.agent(a.id) ?? a).status == .busy {
      let doing = store.activity[a.id].flatMap { $0 == "started" ? nil : $0 }
      HStack(spacing: 6) {
        WorkingDots(color: Palette.statusWorking)
        Text(ActivityText.line(doing)).font(Self.line).foregroundStyle(Palette.statusWorkingText).lineLimit(1)
      }
    } else if let agent = workingHere {
      HStack(spacing: 6) {
        WorkingDots(color: Palette.statusWorking)
        Text("\(agent.name) is working").font(Self.line).foregroundStyle(Palette.statusWorkingText).lineLimit(1)
      }
    } else if case .agent(let a) = entry.kind, let live = store.agent(a.id) ?? Optional(a), live.needsSignIn, let signIn = live.signIn {
      Text("Needs sign-in · \(HarnessChoice.label(signIn.harness)) on \(signIn.where_)").font(Self.line).foregroundStyle(Palette.statusNeedsText).lineLimit(2)
    } else if let waiting = needsApproval {
      Text("Needs approval" + (waiting.isEmpty ? "" : " · \(waiting)")).font(Self.line).foregroundStyle(Palette.statusNeedsText).lineLimit(2)
    } else if let line = channel.flatMap({ Loops.listLine($0) }) {
      // where a chat with an agent stands: waiting on you, when it comes back, or done
      switch line {
      case .waiting(let text):
        Text(text).font(Self.line).foregroundStyle(Palette.statusNeedsText).lineLimit(2)
      case .back(let text):
        HStack(spacing: 5) {
          Image(systemName: "clock").font(.system(size: 13)).foregroundStyle(Palette.faint)
          Text(text).font(Self.line).foregroundStyle(Palette.muted).lineLimit(2)
        }
      case .done:
        HStack(alignment: .firstTextBaseline, spacing: 5) {
          Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.statusOnline).accessibilityLabel("Done")
          Text(Self.mentioned(preview)).font(Self.line).foregroundStyle(Palette.muted).lineLimit(2)
        }
      }
    } else {
      Text(Self.mentioned(preview)).font(Self.line).foregroundStyle(Palette.muted).lineLimit(2)
    }
  }

  /** the agents whose pending approvals wait on you here: "" when there is nothing to name, nil when nothing waits */
  private var needsApproval: String? {
    guard store.role != "guest", let id = channel?.id,
          let waiting = store.pendingApprovals.first(where: { $0.channelId == id }) else { return nil }
    return store.agent(waiting.agentId).map { entry.isTeam ? $0.name : "" } ?? ""
  }

  /** a preview with its @mentions in purple */
  static func mentioned(_ text: String) -> AttributedString {
    var out = AttributedString(text)
    var index = text.startIndex
    while let at = text[index...].firstIndex(of: "@") {
      var end = text.index(after: at)
      while end < text.endIndex, text[end].isLetter || text[end].isNumber || text[end] == "_" || text[end] == "-" { end = text.index(after: end) }
      if end > text.index(after: at), let r = Range(at ..< end, in: out) { out[r].foregroundColor = Palette.mention }
      index = end
    }
    return out
  }

  private var preview: String {
    if let m = entry.last, m.deletedAt == nil {
      var text = SearchText.clean(m.body, max: 120)
      if text.isEmpty, !m.files.isEmpty { text = "Sent \(m.files.count == 1 ? "a file" : "\(m.files.count) files")" }
      if !text.isEmpty {
        if m.author.kind == .user && m.author.id == store.me?.id { return "You: \(text)" }
        if entry.isTeam && m.author.id != "system" { return "\(store.name(of: m.author)): \(text)" }
        return text
      }
    }
    switch entry.kind {
    case .agent(let a): return a.settings?.description.flatMap { $0.isEmpty ? nil : $0 } ?? "@\(a.handle)"
    case .team(let c):
      if let leads = c.leadLine(agents: store.agents) { return leads }
      return c.topic.isEmpty ? "No messages yet" : c.topic
    }
  }

  /** the chat to change a setting on; an agent's chat is made the first time you do */
  private func ensureChannel() async throws -> Channel {
    if let channel { return channel }
    guard case .agent(let a) = entry.kind else { throw API.Failure(status: 0, message: "That chat isn't available.") }
    return try await store.dm(with: a)
  }

  private var muteButton: some View {
    Button(muted ? "Unmute" : "Mute", systemImage: muted ? "bell" : "bell.slash") {
      action.run { let c = try await ensureChannel(); try await store.setChannelPrefs(c.id, ["notify": AnyEncodable(muted ? "default" : "mute")]) }
    }
  }
}

/** "New chat": pick an agent to talk to. */
struct NewChatSheet: View {
  @Environment(Store.self) private var store
  @Environment(\.dismiss) private var dismiss
  var onNewAgent: (() -> Void)?
  var onOpen: (Channel) -> Void
  @State private var action = FormAction()

  var body: some View {
    VStack(spacing: 0) {
      SheetHeader(title: "New chat") { dismiss() }
      ScrollView {
        VStack(spacing: 14) {
          if store.agents.isEmpty {
            Text("You don't have any agents yet.").foregroundStyle(Palette.muted).padding(.top, 24)
          } else {
            CardGroup {
              ForEach(store.agents) { agent in
                Button {
                  action.run { let c = try await store.dm(with: agent); dismiss(); onOpen(c) }
                } label: {
                  RowLabel(title: agent.name, subtitle: agent.settings?.description.flatMap { $0.isEmpty ? nil : $0 } ?? HarnessChoice.label(agent.harness), chevron: false) {
                    AgentAvatar(agent: agent, size: 40, showStatus: false)
                  }
                }.buttonStyle(.plain).disabled(action.busy)
              }
            }
          }
          if let onNewAgent {
            CardGroup {
              Button { dismiss(); onNewAgent() } label: {
                RowLabel(title: "New agent", chevron: false) { Image(systemName: "plus").foregroundStyle(Palette.muted).frame(width: 40) }
              }.buttonStyle(.plain)
            }
          }
          InlineError(error: action.error)
        }
        .padding(.horizontal, 18).padding(.top, 8)
      }
    }
    .background(Palette.sheet.ignoresSafeArea())
    .presentationDetents([.medium, .large])
    .presentationBackground(Palette.sheet)
    .presentationCornerRadius(Corner.sheet)
    .managementAlert(action)
  }
}

/** The blue count on a chat or tab with new messages. */
struct UnreadBadge: View {
  var count: Int
  @ReduceMotion private var reduceMotion
  var body: some View {
    if count > 0 {
      Text(count > 99 ? "99+" : "\(count)")
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 6)
        .frame(minWidth: 20, minHeight: 20)
        .background(Capsule().fill(Palette.blue))
        .badgePop(count)
        .transition(reduceMotion ? .opacity : .scale(scale: 0.4).combined(with: .opacity))
    }
  }
}
