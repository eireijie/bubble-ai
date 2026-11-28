import SwiftUI

/**
 * The bottom of the phone (round 11, board 8 option C): one floating glass bar with the five places,
 * Chats, Computers, Memory, Marketplace and More. Your initials and + sit at the top of Chats; a blue
 * count on Chats and a dot on More when something needs you.
 *
 * The bar sits on each tab's first screen only (`.mainBar()`), so a chat or any page opened from a
 * tab has the whole screen.
 */
@MainActor
@Observable
final class MainBarModel {
  var tab: MainTab = .chats
  /** a "New…" pick ("chat", "agent", "team", "browse") made somewhere other than Chats; Chats opens it, then clears it */
  var newRequest: String?
}

struct MainBar: View {
  @Environment(Store.self) private var store
  @Environment(MainBarModel.self) private var bar

  private var tabs: [MainTab] { MainTab.allCases.filter { $0 != .computers || store.canViewComputers } }

  var body: some View {
    HStack(spacing: 0) {
      ForEach(tabs, id: \.self) { t in item(t) }
    }
    .padding(4)
    .frame(height: 60)
    .glassPill(interactive: false)
    .padding(.horizontal, 14)
    .padding(.bottom, 2)
  }

  private func item(_ t: MainTab) -> some View {
    let on = bar.tab == t
    return Button {
      bar.tab = t
    } label: {
      VStack(spacing: 3) {
        Image(systemName: t.symbol).font(.system(size: 18, weight: .regular))
          .frame(height: 24)
          .overlay(alignment: .topTrailing) { badge(t).offset(x: 11, y: -4) }
        Text(t.title).font(.system(size: 10, weight: on ? .semibold : .medium)).lineLimit(1).minimumScaleFactor(0.8)
      }
      .foregroundStyle(on ? Palette.text : Palette.muted)
      .frame(maxWidth: .infinity).frame(height: 52)
      .background { if on { Capsule().fill(Palette.text.opacity(0.09)) } }
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(t.title)
    .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
    .accessibilityIdentifier("tab-\(t.id)")
    .tourTarget("tab-\(t.id)")
  }

  /** unread chats on Chats, and a dot on More while something in the Inbox needs you */
  @ViewBuilder private func badge(_ t: MainTab) -> some View {
    switch t {
    case .chats where store.unreadTotal > 0:
      Text(store.unreadTotal > 99 ? "99+" : "\(store.unreadTotal)")
        .font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
        .padding(.horizontal, 5).frame(minWidth: 18, minHeight: 18)
        .background(Capsule().fill(ChatDot.blue))
    case .more where store.needsYouCount > 0:
      Circle().fill(ChatDot.blue).frame(width: 9, height: 9)
    default:
      EmptyView()
    }
  }
}

extension MainTab {
  var id: String {
    switch self {
    case .chats: "chats"
    case .computers: "computers"
    case .memory: "memory"
    case .marketplace: "marketplace"
    case .more: "more"
    }
  }
  var title: String {
    switch self {
    case .chats: "Chats"
    case .computers: "Computers"
    case .memory: "Memory"
    case .marketplace: "Marketplace"
    case .more: "More"
    }
  }
  var symbol: String {
    switch self {
    case .chats: "bubble.left"
    case .computers: "desktopcomputer"
    case .memory: "book"
    case .marketplace: "bag"
    case .more: "ellipsis.circle"
    }
  }
}

extension View {
  /** a tab's first screen: the bar floats at the bottom, and the page scrolls clear of it */
  func mainBar() -> some View {
    safeAreaInset(edge: .bottom, spacing: 0) { MainBar() }
  }
}

/** The "New…" menu's items (the + at the top of Chats): New chat, agent, team, or Browse teams for members. */
struct NewMenuItems: View {
  @Environment(Store.self) private var store
  var pick: (String) -> Void
  var body: some View {
    if store.canManage {
      Button("New agent", systemImage: "person.crop.circle.badge.plus") { pick("agent") }
      Button("New team", systemImage: "person.2") { pick("team") }
    } else {
      Button("Browse teams", systemImage: "magnifyingglass") { pick("browse") }
    }
    Button("New chat", systemImage: "square.and.pencil") { pick("chat") }
  }
}

/** The Memory tab: Memory's front page with the bar and no Back. */
struct MemoryTab: View {
  var body: some View {
    NavigationStack {
      MemoryHome(asTab: true)
        .mainBar()
        .chatDestinations()
    }
  }
}

/** The Marketplace tab: Connect apps, skills, mods and template agents, always one tap away. */
struct MarketplaceTab: View {
  var body: some View {
    NavigationStack {
      MarketplaceView(asTab: true)
        .mainBar()
        .chatDestinations()
    }
  }
}
