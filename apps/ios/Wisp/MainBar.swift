import SwiftUI

/**
 * The bottom of the phone (round 10, after 0.1.6): two floating glass pills. The first holds the
 * four places (Chats, Computers, More, Profile); the second is a round + for a new chat, agent or
 * team. Everything advanced (Agents, Inbox, Memory, Tasks, Connect apps, Mods…) is in More.
 *
 * The bar sits on each tab's first screen only (`.mainBar()`), so a chat or any page opened from a
 * tab has the whole screen.
 */
@MainActor
@Observable
final class MainBarModel {
  var tab: MainTab = .chats
  /** the + button's pick ("chat", "agent", "team", "browse"); Chats opens it, then clears it */
  var newRequest: String?
}

struct MainBar: View {
  @Environment(Store.self) private var store
  @Environment(MainBarModel.self) private var bar

  private var tabs: [MainTab] { MainTab.allCases.filter { $0 != .computers || store.canViewComputers } }

  var body: some View {
    HStack(spacing: 10) {
      HStack(spacing: 0) {
        ForEach(tabs, id: \.self) { t in item(t) }
      }
      .padding(4)
      .frame(height: 62)
      .glassPill(interactive: false)
      newButton
    }
    .padding(.horizontal, 16)
    .padding(.bottom, 2)
  }

  private func item(_ t: MainTab) -> some View {
    let on = bar.tab == t
    return Button {
      bar.tab = t
    } label: {
      VStack(spacing: 2) {
        icon(t)
          .frame(height: 26)
          .overlay(alignment: .topTrailing) { badge(t).offset(x: 10, y: -3) }
        Text(t.title).font(.system(size: 10.5, weight: on ? .semibold : .medium)).lineLimit(1)
      }
      .foregroundStyle(on ? Palette.text : Palette.muted)
      .frame(maxWidth: .infinity).frame(height: 54)
      .background { if on { Capsule().fill(Palette.text.opacity(0.08)) } }
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(t.title)
    .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
    .accessibilityIdentifier("tab-\(t.id)")
    .tourTarget("tab-\(t.id)")
  }

  @ViewBuilder private func icon(_ t: MainTab) -> some View {
    switch t {
    case .profile: ProfileCircle(size: 26)
    default: Image(systemName: t.symbol).font(.system(size: 19, weight: .regular))
    }
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

  private var newButton: some View {
    Menu {
      Button("New chat", systemImage: "square.and.pencil") { ask("chat") }
      if store.canManage {
        Button("New agent", systemImage: "person.crop.circle.badge.plus") { ask("agent") }
        Button("New team", systemImage: "person.2") { ask("team") }
      } else {
        Button("Browse teams", systemImage: "magnifyingglass") { ask("browse") }
      }
    } label: {
      Image(systemName: "plus").font(.system(size: 22, weight: .regular)).foregroundStyle(Palette.text)
        .frame(width: 62, height: 62)
        .glassCircle()
        .contentShape(Circle())
    }
    .accessibilityLabel("New chat, agent or team")
    .accessibilityIdentifier("new-menu")
    .tourTarget("new")
  }

  private func ask(_ kind: String) {
    bar.tab = .chats
    bar.newRequest = kind
  }
}

extension MainTab {
  var id: String {
    switch self {
    case .chats: "chats"
    case .computers: "computers"
    case .more: "more"
    case .profile: "profile"
    }
  }
  var title: String {
    switch self {
    case .chats: "Chats"
    case .computers: "Computers"
    case .more: "More"
    case .profile: "Profile"
    }
  }
  var symbol: String {
    switch self {
    case .chats: "bubble.left"
    case .computers: "desktopcomputer"
    case .more: "square.grid.2x2"
    case .profile: "person.crop.circle"
    }
  }
}

extension View {
  /** a tab's first screen: the two pills float at the bottom, and the page scrolls clear of them */
  func mainBar() -> some View {
    safeAreaInset(edge: .bottom, spacing: 0) { MainBar() }
  }
}
