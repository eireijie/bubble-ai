import SwiftUI

/** The quiet line under an agent's reply saying what it read through the Apple mod ("Read your last 5 texts with Sam"). */
struct AppleReadLine: View {
  var app: AppleApp
  var text: String

  var body: some View {
    HStack(spacing: 6) {
      AppleIcon(app: app, size: 16)
      Text(text).lineLimit(2)
    }
    .font(.system(size: 12)).foregroundStyle(Palette.faint)
    .padding(.horizontal, 4).padding(.vertical, 1)
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(app.name): \(text)")
  }
}

/**
 * An agent asking to send a text or change an event or reminder (ChatSend / ChatFirst designs):
 * the app's icon, what it wants to do and where, the fields (an old value struck through), the
 * text as a blue bubble, then yes / Edit / no. Edit (texts only) changes the words before sending.
 */
struct AppleApprovalCard: View {
  @Environment(Store.self) private var store
  @ReduceMotion private var reduceMotion
  var approval: Approval
  var request: AppleRequest
  var inList = false
  @State private var editing = false
  @State private var draft = ""
  @State private var busy = false
  @State private var error: String?
  @FocusState private var focused: Bool

  private var pending: Bool { approval.status == "pending" }
  private var animation: Animation { Motion.pick(Motion.soft, reduceMotion) }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        AppleIcon(app: request.appKind, size: 22)
        Text(request.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
        Spacer(minLength: 8)
        Text(request.aside).font(.system(size: 13)).foregroundStyle(Palette.faint).lineLimit(1)
      }
      .padding(.horizontal, 12).padding(.vertical, 10)
      Rectangle().fill(Palette.separator).frame(height: 1)

      VStack(alignment: .leading, spacing: 8) {
        if !request.fields.isEmpty { fields }
        if let bubble = request.bubble { bubbleView(bubble) }
      }
      .padding(.horizontal, 12).padding(.vertical, 10)

      footer.padding(.horizontal, 12).padding(.bottom, 12)
    }
    .frame(maxWidth: inList ? .infinity : 340, alignment: .leading)
    .background(Palette.card, in: RoundedRectangle(cornerRadius: Corner.card, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(Palette.cardBorder))
    .animation(animation, value: editing)
    .animation(animation, value: approval.status)
    .accessibilityElement(children: .contain)
  }

  private var fields: some View {
    VStack(alignment: .leading, spacing: 6) {
      ForEach(Array(request.fields.enumerated()), id: \.offset) { _, f in
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          Text(f.label).font(.system(size: 14)).foregroundStyle(Palette.faint).frame(width: labelWidth, alignment: .leading)
          Text(f.value)
            .font(.system(size: 14, weight: f.was == true ? .regular : .medium))
            .foregroundStyle(f.was == true ? Palette.faint : Palette.text)
            .strikethrough(f.was == true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(f.was == true ? "was \(f.value)" : f.value)
        }
      }
    }
  }

  /** room for the longest label, so the values line up */
  private var labelWidth: CGFloat {
    let longest = request.fields.map(\.label.count).max() ?? 0
    return CGFloat(min(max(longest, 2), 10)) * 8.5 + 4
  }

  @ViewBuilder private func bubbleView(_ text: String) -> some View {
    if editing {
      TextField("Text", text: $draft, axis: .vertical)
        .lineLimit(1...8)
        .font(.system(size: 15))
        .focused($focused)
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(Palette.control, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.accent, lineWidth: 1.5))
        .accessibilityIdentifier("apple-edit-text")
        .onAppear { focused = true }
        .transition(.opacity)
    } else {
      Text(text)
        .font(.system(size: 15))
        .foregroundStyle(.white)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Palette.accent, in: UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 16, bottomTrailingRadius: 4, topTrailingRadius: 16, style: .continuous))
        .padding(.leading, 28)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .transition(.opacity)
    }
  }

  @ViewBuilder private var footer: some View {
    if pending && store.role != "guest" {
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 8) {
          Button(request.yes) { decide(true) }
            .buttonStyle(ApplePill(prominent: true))
            .accessibilityIdentifier("approval-approve")
          if editing {
            Button("Cancel") { editing = false; focused = false }.buttonStyle(ApplePill())
          } else {
            if let bubble = request.bubble {
              Button("Edit") { draft = bubble; editing = true }.buttonStyle(ApplePill()).accessibilityIdentifier("approval-edit")
            }
            Button(request.no) { decide(false) }.buttonStyle(ApplePill()).accessibilityIdentifier("approval-deny")
          }
        }
        .disabled(busy || (editing && draft.trimmed.isEmpty))
        if let error { Text(error).font(.caption).foregroundStyle(Palette.red) }
      }
    } else if pending {
      Text("Waiting for an answer.").font(.system(size: 13)).foregroundStyle(Palette.faint)
    } else {
      let yes = approval.status == "approved"
      HStack(spacing: 6) {
        if yes { Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold)) }
        Text(decidedText(yes))
        Spacer(minLength: 8)
        if let at = approval.decidedAt.flatMap(Wire.date) { Text(at, format: .dateTime.hour().minute()).foregroundStyle(Palette.faint) }
      }
      .font(.system(size: 13))
      .foregroundStyle(yes ? Palette.statusOnlineText : Palette.faint)
      .transition(.opacity)
    }
  }

  private func decidedText(_ yes: Bool) -> String {
    switch request.appKind {
    case .messages: yes ? "Sent" : "Not sent"
    default: yes ? "Done" : "Left as it was"
    }
  }

  private func decide(_ yes: Bool) {
    busy = true; error = nil
    let edited = editing && yes && draft.trimmed != request.bubble?.trimmed ? draft.trimmed : nil
    Task {
      do {
        try await store.decideApple(approval, approve: yes, text: edited)
        editing = false; focused = false
      } catch { self.error = error.localizedDescription }
      busy = false
    }
  }
}

/** The card's buttons (36pt pills): the main answer filled and wide, the others outlined. */
private struct ApplePill: ButtonStyle {
  var prominent = false
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 14, weight: .medium))
      .foregroundStyle(prominent ? Palette.ground : Palette.text)
      .lineLimit(1)
      .padding(.horizontal, 16)
      .frame(height: 36)
      .frame(maxWidth: prominent ? .infinity : nil)
      .background(Capsule().fill(prominent ? Palette.text : Palette.control))
      .overlay(Capsule().strokeBorder(Palette.hairline, lineWidth: prominent ? 0 : 1))
      .opacity(enabled ? 1 : 0.5)
      .pressFeedback(configuration.isPressed)
  }
}

/** The same request in the Inbox: who asks, then the card, then a way to the chat. */
struct AppleNeedCard: View {
  @Environment(Store.self) private var store
  var approval: Approval
  var request: AppleRequest
  var openChat: () -> Void

  var body: some View {
    let agent = store.agent(approval.agentId)
    VStack(alignment: .leading, spacing: 12) {
      NeedHead(agent: agent, title: "\(agent?.name ?? "An agent") wants your OK", sub: [request.appKind.name, Wire.date(approval.createdAt).map { $0.formatted(.relative(presentation: .named)) }].compactMap { $0 }.joined(separator: " · "))
      AppleApprovalCard(approval: approval, request: request, inList: true)
      Button("Open chat", action: openChat).buttonStyle(CardPill(tone: .ghost)).frame(maxWidth: .infinity)
    }
    .padding(16)
    .background(Palette.card, in: RoundedRectangle(cornerRadius: Corner.card, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(Palette.cardBorder))
    .accessibilityElement(children: .contain)
  }
}
