import SwiftUI

/** The profile's four tabs, in order (web PROFILE_TAB_TITLES, board ProfileSide). */
enum ProfileTab: String, CaseIterable, Identifiable {
  case activity = "Activity", memory = "Memory", background = "Background", settings = "Settings"
  var id: String { rawValue }
}

/**
 * An agent's profile, as on the desktop (board ProfileSide, PR 154): a big avatar and its name, then
 * four tabs. Activity: what it's on now, its computer, voice and recent runs. Memory: its notes and
 * skills. Background: its chat's background, previewed before it's set. Settings: Model, Harness,
 * Computer, Permissions; Apps and skills, Routines; then everything else under More.
 */
struct AgentPage: View {
  @Environment(Store.self) private var store
  @Environment(\.dismiss) private var dismiss
  var agent: Agent
  var startTab: ProfileTab = .activity
  @State private var tab: ProfileTab?
  @State private var editing = false
  @State private var editingLook = false
  @State private var removing = false
  @State private var voice = false
  @State private var chat: Channel?
  @State private var catalog: AgentModels.Catalog?
  @State private var action = FormAction()

  private var current: Agent { store.agent(agent.id) ?? agent }
  private var shown: ProfileTab { tab ?? startTab }
  private var device: AgentNode? { store.nodes.first { $0.id == current.nodeId } }
  private var computer: Computer? { store.computers.first { $0.id == current.computerId } }
  private var routines: [Routine] { store.routines.filter { $0.agentId == current.id } }
  private var skillCount: Int { store.skills.filter { $0.has(current.id) }.count }
  private var appCount: Int { store.connectors.filter { $0.has(current.id) && $0.enabled != false }.count }
  private var canAsk: Bool {
    ((store.isOwner || current.settings?.createdBy == store.me?.id) && (store.features.invite || store.members.count > 1)) ||
    (device != nil && store.harnessOnDevice(current))
  }
  @State private var run = RunInfo()
  private var dmChannel: Channel? { store.channels.first { $0.isDM && store.dmAgent($0)?.id == current.id } }

  var body: some View {
    VStack(spacing: 0) {
      TopBar {
        CircleButton(symbol: "chevron.left", label: "Back", id: "agent-back") { dismiss() }
      } center: {
        EmptyView()
      } trailing: {
        EmptyView()
      }
      ScrollView {
        VStack(spacing: 14) {
          header
          tabs
          switch shown {
          case .activity: activityTab
          case .memory: memoryTab
          case .background: AgentBackgroundTab(agent: current)
          case .settings: settingsTab
          }
          AgentError(text: action.error)
        }
        .padding(.horizontal, 18).padding(.bottom, 60)
      }
      .bubbleRefresh { await reload() }
    }
    .background(Palette.sheet.ignoresSafeArea())
    .toolbar(.hidden, for: .navigationBar)
    .navigationBarBackButtonHidden(true)
    .navigationDestination(item: $chat) { ChannelView(channel: $0) }
    .sheet(isPresented: $editing) { AgentEditSheet(agent: current) }
    .sheet(isPresented: $editingLook) { LookEditor(agent: current) }
    .sheet(isPresented: $voice) { AgentVoiceSheet(agent: current) }
    .sheet(isPresented: $removing) {
      AgentConfirm(agent: current, title: "Remove \(current.name)?", message: "Its memory notes and personality stay in the vault. Its routines and chats with you stop.",
                   confirm: "Remove \(current.name)", destructive: true, busy: action.busy, error: action.error) {
        action.run { try await store.deleteAgent(current.id); removing = false; dismiss() }
      }
    }
    .task { await reload() }
    .onChange(of: store.agents.contains { $0.id == agent.id }) { _, exists in if !exists { dismiss() } }
  }

  // MARK: tabs

  /** Activity · Memory · Background · Settings, one row of plain words with the picked one underlined */
  private var tabs: some View {
    HStack(spacing: 0) {
      ForEach(ProfileTab.allCases) { t in
        let on = shown == t
        Button { tab = t } label: {
          VStack(spacing: 7) {
            Text(t.rawValue).font(.system(size: 15, weight: on ? .semibold : .regular))
              .foregroundStyle(on ? Palette.text : Palette.muted).lineLimit(1).minimumScaleFactor(0.85)
            Capsule().fill(on ? Palette.text : .clear).frame(height: 2)
          }
          .frame(maxWidth: .infinity).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
        .accessibilityIdentifier("profile-tab-\(t.rawValue.lowercased())")
      }
    }
    .overlay(alignment: .bottom) { Rectangle().fill(Palette.hairline).frame(height: 1) }
  }

  @ViewBuilder private var activityTab: some View {
    if current.status == .busy {
      HStack(spacing: 10) {
        Circle().fill(Palette.statusWorking).frame(width: 8, height: 8)
        Text(activityValue ?? "Working").font(.system(size: 15)).foregroundStyle(Palette.text).lineLimit(2)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 14).frame(minHeight: 48)
      .background(Palette.card, in: RoundedRectangle(cornerRadius: Corner.card, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(Palette.cardBorder))
    }
    if store.canViewComputers {
      CardCaption("Computer")
      CardGroup {
        link("Computer", id: "agent-computer", icon: "desktopcomputer", value: AgentLine.computer(agent: current, computer: computer, device: device)) { AgentComputerView(agent: current) }
      }
    }
    CardCaption("Voice chat")
    CardGroup {
      Button { voice = true } label: { RowLabel(title: "Voice and calls", leading: { rowIcon("waveform") }) }
        .buttonStyle(.plain).accessibilityIdentifier("agent-voice")
    }
    CardGroup {
      link("Recent runs", id: "agent-activity", icon: "list.bullet") { AgentActivityPage(agent: current) }
    }
  }

  @ViewBuilder private var memoryTab: some View {
    CardGroup {
      link("Notes", id: "agent-memory", icon: "book") { AgentMemoryPage(agent: current) }
      link("Skills", id: "agent-skills", icon: "bolt", value: AgentLine.count(skillCount)) { AgentSkillsPage(agent: current) }
    }
  }

  @ViewBuilder private var settingsTab: some View {
    CardGroup {
      link("Model", id: "agent-model", icon: "dial.medium", value: AgentLine.model(agent: current, catalog: catalog)) { AgentModelPage(agent: current) }
      NavigationLink { HarnessPicker(agent: current, info: run).task { if let dm = dmChannel { await run.load(store, agent: current, channel: dm.id, thread: nil) } } } label: {
        RowLabel(title: "Harness", value: HarnessChoice.label(current.harness), leading: { BrandLogo(id: current.harness, size: 20).frame(width: 24) })
      }.buttonStyle(.plain).accessibilityIdentifier("agent-harness")
      if store.canViewComputers {
        link("Computer", id: "agent-computer-settings", icon: "desktopcomputer", value: AgentLine.computer(agent: current, computer: computer, device: device)) { AgentComputerView(agent: current) }
      }
      link("Permissions", id: "agent-permissions", icon: "lock") { AgentPermissions(agent: current) }
    }
    CardGroup {
      link("Apps and skills", id: "agent-apps", icon: "square.grid.2x2", value: AgentLine.count(appCount + skillCount)) { AgentAppsPage(agent: current) }
      if store.features.routines {
        link("Routines", id: "agent-routines", icon: "clock", value: AgentLine.routines(routines)) { RoutinesView(agent: current) }
      }
    }
    CardCaption("More")
    CardGroup {
      if canAsk {
        link("Who can message", id: "agent-who", icon: "person.2", value: AgentLine.respond(current, device: device)) { AgentWhoPage(agent: current) }
      }
      if store.features.background {
        link("Background checks", id: "agent-background", icon: "moon", value: backgroundValue) { BackgroundView(agent: current) }
      }
      link("Connections", id: "agent-connect", icon: "link") { AgentConnect(agent: current) }
      if store.canManage {
        Button { editingLook = true } label: { RowLabel(title: "Look", value: nil, leading: { rowIcon("paintpalette") }) }
          .buttonStyle(.plain).accessibilityIdentifier("agent-look")
      }
    }
    notifications
    if store.canManage {
      CardGroup {
        Button { removing = true } label: { RowLabel(title: "Remove \(current.name)", chevron: false, tint: Palette.red, leading: { rowIcon("trash").foregroundStyle(Palette.red) }) }
          .buttonStyle(.plain).accessibilityIdentifier("agent-remove")
      }
    }
  }

  // MARK: top

  private var header: some View {
    VStack(spacing: 8) {
      AgentAvatar(agent: current, size: 104, showStatus: false, interactive: true)
        .simultaneousGesture(TapGesture().onEnded { if store.canManage { editingLook = true } })
        .accessibilityLabel("Edit \(current.name)'s look")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { if store.canManage { editingLook = true } }
      Text(current.name).font(.system(size: 24, weight: .bold)).foregroundStyle(Palette.text).accessibilityAddTraits(.isHeader)
      Text("@\(current.handle) · \(HarnessChoice.label(current.harness))").font(.system(size: 15)).foregroundStyle(Palette.faint)
      if let description = current.settings?.role ?? current.settings?.roleNotes, !description.isEmpty {
        Text(description).font(.system(size: 15)).foregroundStyle(Palette.muted).multilineTextAlignment(.center).lineLimit(3).padding(.horizontal, 18)
      }
      HStack(spacing: 10) {
        if store.canManage { SmallPill(title: "Edit", id: "agent-edit") { editing = true } }
        SmallPill(title: "Message", symbol: "bubble.left", id: "agent-message") { action.run { chat = try await store.dm(with: current) } }
          .disabled(action.busy)
      }.padding(.top, 2)
    }
    .frame(maxWidth: .infinity)
    .padding(.top, 2).padding(.bottom, 10)
  }

  private var notifications: some View {
    VStack(alignment: .leading, spacing: 8) {
      Toggle(isOn: Binding(get: { dmChannel?.isMuted != true }, set: { on in
        action.run {
          let channel: Channel
          if let existing = dmChannel { channel = existing } else { channel = try await store.dm(with: current) }
          try await store.setChannelPrefs(channel.id, ["notify": AnyEncodable(on ? "default" : "mute")])
        }
      })) {
        Text("Notifications").font(.system(size: 15)).foregroundStyle(Palette.text)
      }
      .tint(Palette.accent)
      .padding(.horizontal, 18).frame(minHeight: 60)
      .background(Palette.card, in: RoundedRectangle(cornerRadius: Corner.card, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(Palette.cardBorder))
      .disabled(action.busy)
      .accessibilityIdentifier("agent-notifications")
      CardCaption("Get told when \(current.name) finishes or needs you")
    }
  }

  // MARK: rows

  private func link<Destination: View>(_ title: String, id: String, icon: String, value: String? = nil, @ViewBuilder _ destination: () -> Destination) -> some View {
    NavigationLink { destination() } label: {
      RowLabel(title: title, value: value?.isEmpty == true ? nil : value, leading: { rowIcon(icon) })
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier(id)
  }

  private var backgroundValue: String? {
    guard let work = store.backgrounds[current.id]?.background else { return nil }
    return work.enabled == true ? "On" : "Off"
  }

  private var activityValue: String? {
    if let doing = store.activity[current.id], doing != "started" { return doing }
    return current.status == .busy ? "Working" : nil
  }

  private func reload() async {
    do { try await store.refreshManagement() } catch { action.error = error.localizedDescription }
    try? await store.refreshRoutines()
    try? await store.refreshSkills()
    try? await store.refreshConnectors()
    try? await store.refreshBackground(current.id)
    catalog = try? await store.agentModels(current.id).catalog
  }
}
