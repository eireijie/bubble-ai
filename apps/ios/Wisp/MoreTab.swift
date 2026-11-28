import SwiftUI

/**
 * The More tab (round 10): every place that isn't a chat. Agents and the Inbox live here now, beside
 * Memory, Tasks, Storage, Apple, Connect apps, Mods and Help. Your profile and settings are the
 * Profile tab.
 */
struct MoreTab: View {
  @Environment(Store.self) private var store
  @State private var path = NavigationPath()
  /** the page Show me around opened */
  @State private var tourPage: Tour.Place?
  @State private var connectApps = false

  private var guest: Bool { store.role == "guest" }

  var body: some View {
    NavigationStack(path: $path) {
      VStack(spacing: 0) {
        TopBar {
          EmptyView()
        } center: {
          Text("More").font(.system(size: 20, weight: .bold)).foregroundStyle(Palette.text).accessibilityAddTraits(.isHeader)
        } trailing: {
          EmptyView()
        }
        ScrollView {
          VStack(spacing: 14) {
            if !guest, let id = store.workspace?.id, ReadyList.showsFinishSetup(id, agentCount: store.agents.count) {
              CardGroup {
                NavigationLink { HereView() } label: { RowLabel(title: "Finish setup", leading: { rowIcon("checklist") }) }
                  .accessibilityIdentifier("you-finish-setup")
              }
            }
            CardGroup {
              if !guest {
                NavigationLink(value: MorePage.agents) { RowLabel(title: "Agents", value: store.agents.isEmpty ? nil : "\(store.agents.count)", leading: { rowIcon("person.2") }) }
                  .accessibilityIdentifier("more-agents")
              }
              NavigationLink(value: ChatsScreen.inbox) {
                RowLabel(title: "Inbox", value: store.needsYouCount > 0 ? "\(store.needsYouCount) waiting" : nil, leading: { rowIcon("tray") })
              }
              .accessibilityIdentifier("more-inbox")
              NavigationLink { MemoryView() } label: { RowLabel(title: "Memory", value: guest ? "Shared folder" : nil, leading: { rowIcon("book") }) }
                .accessibilityIdentifier("you-memory")
                .tourTarget("more-memory")
              if !guest && store.features.tasks {
                NavigationLink { TasksView() } label: { RowLabel(title: "Tasks", leading: { rowIcon("checklist") }) }
                  .accessibilityIdentifier("you-tasks")
              }
            }
            if !guest {
              CardGroup {
                // the same Connect apps sheet as the pill at the bottom of Chats (round 9)
                Button { connectApps = true } label: { RowLabel(title: "Connect apps", leading: { rowIcon("powerplug") }) }
                  .buttonStyle(.plain)
                  .accessibilityIdentifier("you-marketplace")
                NavigationLink { FeaturesView() } label: { RowLabel(title: "Mods", leading: { rowIcon("square.grid.2x2") }) }
                  .accessibilityIdentifier("you-mods")
                if store.features.storage {
                  NavigationLink { StorageView() } label: { RowLabel(title: "Storage", leading: { rowIcon("externaldrive") }) }
                    .accessibilityIdentifier("you-storage")
                }
                if store.features.apple {
                  NavigationLink { AppleView() } label: { RowLabel(title: "Apple", leading: { rowIcon("macbook.and.iphone") }) }
                    .accessibilityIdentifier("you-apple")
                }
              }
            }
            CardGroup {
              NavigationLink { HelpView() } label: { RowLabel(title: "Help", leading: { rowIcon("lifepreserver") }) }
                .accessibilityIdentifier("you-help")
            }
          }
          .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 30)
        }
      }
      .background(Palette.sheet.ignoresSafeArea())
      .toolbar(.hidden, for: .navigationBar)
      .mainBar()
      .chatDestinations()
      .navigationDestination(for: MorePage.self) { page in
        switch page {
        case .agents: AgentsScreen { path.append($0) }
        }
      }
      .sheet(isPresented: $connectApps) { ConnectAppsSheet() }
      .navigationDestination(isPresented: tourShows(.memory)) { MemoryView() }
      .navigationDestination(isPresented: tourShows(.marketplace)) { MarketplaceView() }
      .navigationDestination(isPresented: tourShows(.mods)) { FeaturesView() }
      .navigationDestination(isPresented: tourShows(.inbox)) { InboxView() }
    }
    .onChange(of: TourRun.shared.nav, initial: true) {
      guard TourRun.shared.active, let place = TourRun.shared.place, place.tab == .more else { return }
      tourPage = place == .more ? nil : place
    }
    // a tapped notification: the Inbox, or the approval it's about
    .task(id: store.route) {
      switch store.route {
      case .inbox:
        store.route = nil
        var p = NavigationPath(); p.append(ChatsScreen.inbox); path = p
      case .approval(let id):
        store.route = nil
        var p = NavigationPath(); p.append(ChatsScreen.inbox); p.append(ChatsScreen.approval(id: id)); path = p
      default: break
      }
    }
  }

  private func tourShows(_ page: Tour.Place) -> Binding<Bool> {
    Binding(get: { tourPage == page }, set: { if !$0 && tourPage == page { tourPage = nil } })
  }
}

/** Pages More opens by value. */
enum MorePage: Hashable { case agents }
