import SwiftUI

/** The More tab: the same list the rail's More menu holds on the desktop. */
struct MoreTab: View {
  @Environment(Store.self) private var store
  @Environment(\.openSettings) private var openSettings
  /** the page Show me around opened */
  @State private var tourPage: Tour.Place?

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        TopBar {
          Button { openSettings() } label: { ProfileCircle() }.buttonStyle(.press).accessibilityIdentifier("profile-button")
        } center: {
          Text("More").font(.system(size: 20, weight: .bold)).foregroundStyle(Palette.text).accessibilityAddTraits(.isHeader)
        } trailing: {
          EmptyView()
        }
        ScrollView {
          if store.role != "guest", let id = store.workspace?.id, ReadyList.showsFinishSetup(id, agentCount: store.agents.count) {
            CardGroup {
              NavigationLink { HereView() } label: { RowLabel(title: "Finish setup", leading: { rowIcon("checklist") }) }
                .accessibilityIdentifier("you-finish-setup")
            }
            .padding(.horizontal, 18).padding(.top, 8)
          }
          CardGroup {
            NavigationLink { MemoryView() } label: { RowLabel(title: "Memory", value: store.role == "guest" ? "Shared folder" : nil, leading: { rowIcon("book") }) }
              .accessibilityIdentifier("you-memory")
              .tourTarget("more-memory")
            if store.role != "guest" {
              if store.features.tasks {
                NavigationLink { TasksView() } label: { RowLabel(title: "Tasks", leading: { rowIcon("checklist") }) }
                  .accessibilityIdentifier("you-tasks")
              }
              if store.features.storage {
                NavigationLink { StorageView() } label: { RowLabel(title: "Storage", leading: { rowIcon("externaldrive") }) }
                  .accessibilityIdentifier("you-storage")
              }
              if store.features.apple {
                NavigationLink { AppleView() } label: { RowLabel(title: "Apple", leading: { rowIcon("macbook.and.iphone") }) }
                  .accessibilityIdentifier("you-apple")
              }
              NavigationLink { MarketplaceView() } label: { RowLabel(title: "Marketplace", leading: { rowIcon("storefront") }) }
                .accessibilityIdentifier("you-marketplace")
              NavigationLink { FeaturesView() } label: { RowLabel(title: "Mods", leading: { rowIcon("square.grid.2x2") }) }
                .accessibilityIdentifier("you-mods")
            }
            NavigationLink { HelpView() } label: { RowLabel(title: "Help", leading: { rowIcon("lifepreserver") }) }
              .accessibilityIdentifier("you-help")
          }
          .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 30)
        }
      }
      .background(Palette.sheet.ignoresSafeArea())
      .toolbar(.hidden, for: .navigationBar)
      .chatDestinations()
      .navigationDestination(isPresented: tourShows(.memory)) { MemoryView() }
      .navigationDestination(isPresented: tourShows(.marketplace)) { MarketplaceView() }
      .navigationDestination(isPresented: tourShows(.mods)) { FeaturesView() }
    }
    .onChange(of: TourRun.shared.nav, initial: true) {
      guard TourRun.shared.active, let place = TourRun.shared.place, place.tab == .more else { return }
      tourPage = place == .more ? nil : place
    }
  }

  private func tourShows(_ page: Tour.Place) -> Binding<Bool> {
    Binding(get: { tourPage == page }, set: { if !$0 && tourPage == page { tourPage = nil } })
  }
}
