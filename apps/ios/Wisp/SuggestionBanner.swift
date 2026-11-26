import SwiftUI

/**
 * One suggested next step across the top of a chat (web: SuggestionBanner.tsx): a short line, one
 * filled violet button that does it, and a round close. The harness sign-in and the first chat's
 * one-step asks use it.
 */
struct SuggestionBanner<Trailing: View>: View {
  var symbol: String?
  var text: String
  var detail: String?
  var action: String?
  var onAction: (() -> Void)?
  var onClose: (() -> Void)?
  var closeLabel = "Not now"
  var busy = false
  @ViewBuilder var trailing: Trailing

  static var buttonFill: Color { Color(hex: 0x7A5BDC) }

  var body: some View {
    HStack(spacing: 10) {
      if let symbol { Image(systemName: symbol).font(.system(size: 15)).foregroundStyle(Palette.muted).frame(width: 22) }
      VStack(alignment: .leading, spacing: 1) {
        Text(text).font(.system(size: 14)).foregroundStyle(Palette.text)
        if let detail { Text(detail).font(.system(size: 13)).foregroundStyle(Palette.muted) }
      }
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
      trailing
      if let action, let onAction {
        Button(action: onAction) {
          Text(action).font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
            .padding(.horizontal, 14).frame(height: 32)
            .background(Capsule().fill(Self.buttonFill))
        }
        .buttonStyle(.press).disabled(busy)
      }
      if let onClose {
        Button(action: onClose) {
          Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Palette.muted)
            .frame(width: 30, height: 30).background(Circle().fill(Palette.bubble))
        }
        .buttonStyle(.press).accessibilityLabel(closeLabel)
      }
    }
    .padding(.leading, 14).padding(.trailing, 8).padding(.vertical, 8)
    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.card.opacity(0.96)))
    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.hairline))
    .shadow(color: .black.opacity(0.12), radius: 15, y: 10)
    .padding(.horizontal, 12)
    .accessibilityElement(children: .contain)
  }
}

extension SuggestionBanner where Trailing == EmptyView {
  init(symbol: String? = nil, text: String, detail: String? = nil, action: String? = nil, onAction: (() -> Void)? = nil, onClose: (() -> Void)? = nil, closeLabel: String = "Not now", busy: Bool = false) {
    self.init(symbol: symbol, text: text, detail: detail, action: action, onAction: onAction, onClose: onClose, closeLabel: closeLabel, busy: busy) { EmptyView() }
  }
}
