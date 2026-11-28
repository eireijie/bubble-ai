import SwiftUI
import UIKit

/**
 * Press and hold a chat (round 11, board 11): everything else blurs, the chat lifts as a small card
 * (its name and what was said last), and one short menu sits under it. "Move to" and "More" open
 * right inside the menu, no second popup. It opens and closes instantly: working UI doesn't move.
 */
struct LiftItem: Identifiable {
  var id: String { title }
  var title: String
  var symbol: String
  var destructive = false
  /** a folder it's already in */
  var checked = false
  /** "Move to" and "More": opened in place */
  var children: [LiftItem] = []
  var action: (() -> Void)? = nil
}

/** A chat held on Chats: which, and where it was on screen. */
struct LiftedChat: Equatable {
  var entry: ChatEntry
  var frame: CGRect
}

struct ChatLift: View {
  var lifted: LiftedChat
  var line: String
  var items: [LiftItem]
  var close: () -> Void
  @State private var open: String?
  /** the lifted card's own height (its last message takes one or two lines) */
  @State private var cardHeight: CGFloat = 128

  private static let menuWidth: CGFloat = 264
  private static let rowHeight: CGFloat = 44
  private static let gap: CGFloat = 10
  private static let cardWidth: CGFloat = 340

  private var menuHeight: CGFloat {
    let rows = items.count + (items.first { $0.title == open }?.children.count ?? 0)
    return CGFloat(rows) * Self.rowHeight + 12
  }

  var body: some View {
    GeometryReader { geo in
      let origin = geo.frame(in: .global).origin
      let insets = Self.windowInsets
      let size = geo.size
      let f = lifted.frame.offsetBy(dx: -origin.x, dy: -origin.y)
      let top = insets.top + 8
      let bottom = size.height - insets.bottom - 8
      let width = min(Self.cardWidth, size.width - 32)
      let x = min(max(f.midX - width / 2, 16), size.width - 16 - width)
      // the card where the chat was, moved up just enough for the menu to fit under it
      let y = min(max(f.minY - 20, top), max(bottom - menuHeight - Self.gap - cardHeight, top))

      ZStack(alignment: .topLeading) {
        Button(action: close) {
          ZStack {
            Rectangle().fill(.ultraThinMaterial)
            Color.black.opacity(0.28)
          }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Close")
        .accessibilityIdentifier("chat-lift-close")

        ChatPeek(entry: lifted.entry, line: line, width: width, lines: 2)
          .fixedSize(horizontal: false, vertical: true)
          .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { cardHeight = $0 }
          .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
          .shadow(color: .black.opacity(0.35), radius: 22, y: 12)
          .offset(x: x, y: y)
          .allowsHitTesting(false)
          .accessibilityHidden(true)

        menu
          .offset(x: x, y: y + cardHeight + Self.gap)
      }
      .frame(width: size.width, height: size.height, alignment: .topLeading)
    }
    .ignoresSafeArea()
    .transaction { $0.animation = nil }
    .accessibilityAddTraits(.isModal)
    .accessibilityAction(.escape, close)
    .onAppear { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
  }

  private var menu: some View {
    VStack(spacing: 0) {
      ForEach(items) { item in
        row(item, indent: false)
        if open == item.title {
          ForEach(item.children) { child in row(child, indent: true) }
        }
      }
    }
    .padding(6)
    .frame(width: Self.menuWidth)
    .popGlass(radius: 18)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Chat actions")
  }

  private func row(_ item: LiftItem, indent: Bool) -> some View {
    let opens = !item.children.isEmpty
    let isOpen = open == item.title
    return Button {
      if opens { open = isOpen ? nil : item.title } else { item.action?() }
    } label: {
      HStack(spacing: 10) {
        if indent {
          Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold)).frame(width: 18)
            .opacity(item.checked ? 1 : 0)
            .foregroundStyle(Palette.text)
          if item.symbol == "plus" {
            Image(systemName: "plus").font(.system(size: 13)).foregroundStyle(Palette.muted)
          }
        } else {
          Image(systemName: item.symbol).font(.system(size: 15)).frame(width: 20)
            .foregroundStyle(item.destructive ? Palette.red : Palette.muted)
        }
        Text(item.title).font(.system(size: 15))
          .foregroundStyle(item.destructive ? Palette.red : indent && item.symbol == "plus" ? Palette.muted : Palette.text)
        Spacer(minLength: 0)
        if opens {
          Image(systemName: isOpen ? "chevron.down" : "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.muted)
        }
      }
      .padding(.leading, indent ? 18 : 10).padding(.trailing, 12)
      .frame(height: Self.rowHeight)
      .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(isOpen ? Palette.text.opacity(0.07) : .clear))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityAddTraits(item.checked ? .isSelected : [])
    .accessibilityHint(opens ? (isOpen ? "Closes the list" : "Opens the list") : "")
    .accessibilityIdentifier("lift-\(item.title.lowercased().replacingOccurrences(of: " ", with: "-"))")
  }

  private static var windowInsets: UIEdgeInsets {
    let window = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow }
    return window?.safeAreaInsets ?? UIEdgeInsets(top: 59, left: 0, bottom: 34, right: 0)
  }
}

extension View {
  /**
   * Press and hold lifts this chat (ChatLift): reports where it is on screen. VoiceOver gets the same
   * as an "Options" action.
   */
  func liftOnHold(_ hold: @escaping (CGRect) -> Void) -> some View {
    modifier(LiftOnHold(hold: hold))
  }
}

private struct LiftOnHold: ViewModifier {
  var hold: (CGRect) -> Void
  @State private var frame: CGRect = .zero

  func body(content: Content) -> some View {
    content
      .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame = $0 }
      .simultaneousGesture(LongPressGesture(minimumDuration: 0.4).onEnded { _ in hold(frame) })
      .accessibilityAction(named: "Options") { hold(frame) }
  }
}
