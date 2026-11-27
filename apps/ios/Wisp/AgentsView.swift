import SwiftUI

/**
 * Everyone you work with: each agent's ghost, what it's doing now, and a tap to open its page.
 * A page in More (round 10); it opens agents and chats on More's own stack through `push`.
 */
struct AgentsScreen: View {
  @Environment(Store.self) private var store
  @Environment(\.dismiss) private var dismiss
  var push: (any Hashable) -> Void
  @State private var adding = false

  private var sorted: [Agent] {
    store.agents.sorted { a, b in
      let rank: (Agent.Status) -> Int = { $0 == .busy ? 0 : $0 == .online ? 1 : 2 }
      return rank(a.status) != rank(b.status) ? rank(a.status) < rank(b.status) : a.name < b.name
    }
  }

  var body: some View {
      VStack(spacing: 0) {
        TopBar {
          CircleButton(symbol: "chevron.left", label: "Back", id: "agents-back") { dismiss() }
        } center: {
          EmptyView()
        } trailing: {
          if store.canManage { CircleButton(symbol: "plus", label: "New agent", id: "agents-add") { adding = true } }
        }
        ScrollView {
          VStack(alignment: .leading, spacing: 0) {
            Text("Agents").font(.system(size: 22, weight: .semibold)).foregroundStyle(Palette.text)
              .padding(.horizontal, 4).padding(.top, 8).padding(.bottom, 14)
              .accessibilityAddTraits(.isHeader)
            if store.agents.isEmpty {
              ContentUnavailableView {
                Label("No agents yet", systemImage: "person.crop.circle.badge.plus")
              } description: {
                Text("Give it a job and a computer.")
              } actions: {
                if store.canManage { Button("Add agent") { adding = true }.primaryButton() }
              }.padding(.top, 60)
            } else {
              LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(Array(sorted.enumerated()), id: \.element.id) { i, a in
                  AgentTile(agent: a, doing: store.activity[a.id], openSettings: { push(a) }, openChat: { push($0) })
                    .rowEntrance(i)
                }
              }
            }
          }
          .padding(.horizontal, 18).padding(.bottom, 24)
        }
        .bubbleRefresh { await store.load() }
      }
      .background(Palette.ground.ignoresSafeArea())
      .toolbar(.hidden, for: .navigationBar)
      // a new agent has already said hello in its DM, so that's where you land
      .sheet(isPresented: $adding) { AddAgent { agent in Task { await openNew(agent) } } }
      .navigationBarBackButtonHidden(true)
  }

  private func openNew(_ agent: Agent) async {
    if let ch = try? await store.dm(with: agent) { push(ch) } else { push(agent) }
  }

  /** the dashed tile after the last agent */
  private var newAgentTile: some View {
    Button { adding = true } label: {
      VStack(spacing: 10) {
        Image(systemName: "plus").font(.system(size: 20, weight: .medium)).foregroundStyle(Palette.text)
          .frame(width: 52, height: 52).glassCircle()
        Text("New agent").font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.muted)
      }
      .frame(maxWidth: .infinity, minHeight: 196)
      .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(Palette.hairline, style: StrokeStyle(lineWidth: 1.5, dash: [6, 5])))
      .contentShape(RoundedRectangle(cornerRadius: Corner.card, style: .continuous))
    }
    .buttonStyle(.pressRow)
    .accessibilityLabel("New agent")
    .accessibilityIdentifier("agents-new-tile")
  }
}

struct AgentTile: View {
  @Environment(Store.self) private var store
  @State private var editingLook = false
  var agent: Agent
  var doing: String?
  var openSettings: () -> Void
  var openChat: (Channel) -> Void
  @State private var removing = false
  @State private var action = FormAction()

  var body: some View {
    Button { openSettings() } label: {
      VStack(spacing: 6) {
        GhostView(look: agent.settings?.appearance, seed: agent.handle, offline: store.isOffline(agent), size: 76, mood: store.mood(for: agent))
          .frame(width: 76, height: 76)
        Text(agent.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1).padding(.top, 6)
        Text(harnessLabel).font(.system(size: 13)).foregroundStyle(Palette.faint).lineLimit(1)
        status.padding(.top, 4)
      }
      .frame(maxWidth: .infinity, minHeight: 196)
      .padding(.horizontal, 14).padding(.vertical, 16)
      .background(Palette.card, in: RoundedRectangle(cornerRadius: Corner.card, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(Palette.cardBorder))
      .contentShape(RoundedRectangle(cornerRadius: Corner.card, style: .continuous))
    }
    .buttonStyle(.pressRow)
    .accessibilityIdentifier("agent-tile")
    .contextMenu {
      Button("Message", systemImage: "bubble.left") { action.run { openChat(try await store.dm(with: agent)) } }
      if store.canManage { Button("Edit look", systemImage: "paintpalette") { editingLook = true } }
      Button("Settings", systemImage: "gearshape", action: openSettings)
      if store.canManage { Button("Remove", systemImage: "trash", role: .destructive) { removing = true } }
    }
    .confirmationDialog("Remove \(agent.name) (@\(agent.handle))?", isPresented: $removing, titleVisibility: .visible) {
      Button("Remove \(agent.name)", role: .destructive) { action.run { try await store.deleteAgent(agent.id) } }
    } message: { Text("Its memory notes and personality stay in the vault.") }
    .managementAlert(action)
    .sheet(isPresented: $editingLook) { LookEditor(agent: store.agent(agent.id) ?? agent) }
  }

  /** "Reading release.md" (or "Working") in green with pulsing dots, or "Idle" / "Offline" */
  @ViewBuilder private var status: some View {
    if agent.status == .busy {
      HStack(spacing: 6) {
        WorkingDots()
        Text(ActivityText.line(doing))
          .font(.system(size: 13)).foregroundStyle(Palette.statusWorkingText).lineLimit(2).multilineTextAlignment(.center)
      }
    } else if agent.needsSignIn || store.missingHarness(agent) != nil {
      HStack(spacing: 6) {
        Circle().fill(Palette.statusNeeds).frame(width: 7, height: 7)
        Text(agent.needsSignIn ? "Needs sign-in" : "Not installed").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.statusNeedsText)
      }
      .padding(.horizontal, 10).frame(height: 24)
      .background(Capsule().fill(Palette.statusNeeds.tint16))
      .accessibilityElement(children: .combine)
    } else {
      HStack(spacing: 6) {
        Circle().fill(agent.status == .online ? Palette.statusOnline : Palette.statusOffline).frame(width: 7, height: 7)
        Text(agent.status == .online ? "Online" : "Offline").font(.system(size: 12, weight: .semibold)).foregroundStyle(agent.status == .online ? Palette.statusOnlineText : Palette.statusOfflineText)
      }
      .padding(.horizontal, 10).frame(height: 24)
      .background(Capsule().fill((agent.status == .online ? Palette.statusOnline : Palette.statusOffline).tint16))
      .accessibilityElement(children: .combine)
    }
  }

  private var harnessLabel: String {
    HarnessChoice.label(agent.harness)
  }
}
