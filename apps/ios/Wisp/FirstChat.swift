import SwiftUI
import UserNotifications

/**
 * The extras in a new agent's first chat. One main next step: a quick reply to its hello. A quiet
 * link to "Here's your Wisp". Notifications are asked about only after its first useful answer,
 * when a ping would mean something; Turn on brings up the system's own prompt, and after
 * "Don't Allow" the card links to the exact switch.
 */
struct FirstChatExtras: View {
  @Environment(Store.self) private var store
  @Environment(\.openURL) private var openURL
  var channel: Channel
  @State private var asked = false
  @State private var busy = false
  @State private var sent = false
  @State private var justOn = false
  @State private var seen = true
  @State private var loaded = false
  @ReduceMotion private var reduceMotion

  private var agent: Agent? { store.dmAgent(channel) }
  private var messages: [Message] { store.messages[channel.id] ?? [] }
  private var workspaceId: String { store.workspace?.id ?? "" }
  /** quick replies, until you've said something yourself */
  private var quick: [String] { sent || messages.contains { $0.author.kind == .user } || store.messages[channel.id] == nil ? [] : FirstChat.quick }
  private var permission: FirstChat.Permission {
    guard store.pushAvailable else { return .unsupported }
    switch store.notificationStatus {
    case .notDetermined: return .notAsked
    case .denied: return .denied
    default: return .granted
    }
  }
  private var ping: FirstChat.Ping {
    justOn ? .on : FirstChat.ping(answered: agent.map { FirstChat.answeredOnce(messages, agentId: $0.id) } ?? false, asked: asked, busy: busy, permission: permission)
  }

  var body: some View {
    if let agent, FirstChat.isFirstChat(agent, channelId: channel.id), loaded, ping != .hidden || !seen || !quick.isEmpty {
      VStack(spacing: 8) {
        if !quick.isEmpty {
          HStack(spacing: 6) {
            Spacer(minLength: 0)
            ForEach(Array(quick.enumerated()), id: \.element) { i, q in
              Button(q) { reply(q) }.buttonStyle(QuickReply(primary: i == 0)).accessibilityIdentifier("first-chat-reply-\(i)")
            }
          }
          .accessibilityElement(children: .contain).accessibilityLabel("Quick replies")
          .transition(rise)
        }
        if ping != .hidden { pingCard.transition(rise) }
        if !seen {
          NavigationLink { HereView(agentId: agent.id, fromChat: true) } label: {
            HStack(spacing: 2) {
              Text("See what I set up")
              Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold))
            }
            .font(.system(size: 13)).foregroundStyle(Palette.muted).frame(height: 28).padding(.horizontal, 8).contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .simultaneousGesture(TapGesture().onEnded { seen = true })
          .accessibilityIdentifier("first-chat-here")
          .transition(rise)
        }
      }
      .padding(.horizontal, 14).padding(.bottom, 2)
      .animation(Motion.pick(Motion.soft, reduceMotion), value: ping)
      .animation(Motion.pick(Motion.soft, reduceMotion), value: quick)
    } else {
      // nothing to show; still read what this phone remembers before the first look
      Color.clear.frame(height: 0).task(id: agent?.id) {
        guard let agent else { return }
        asked = WispPreferences.standard.bool(forKey: FirstChat.askedKey(workspaceId))
        seen = WispPreferences.standard.bool(forKey: FirstChat.hereSeenKey(agent.id))
        withAnimation(Motion.pick(Motion.soft.delay(0.6), reduceMotion)) { loaded = true }
      }
    }
  }

  private var rise: AnyTransition { reduceMotion ? .opacity : .offset(y: 16).combined(with: .opacity) }

  private var pingCard: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: "bell").font(.system(size: 15)).foregroundStyle(Palette.muted).padding(.top, 1)
      VStack(alignment: .leading, spacing: 2) {
        Text(ping == .on ? "Pings are on." : ping == .off ? "Pings are off for Wisp." : "Want a ping when this is done?")
          .font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.text)
        Text(ping == .on ? "I'll only ping you when something's finished or I need a yes." : ping == .off ? "Only the system switch can turn them back on." : "I'll only message you when something's finished or I need a yes.")
          .font(.system(size: 13)).foregroundStyle(Palette.muted).fixedSize(horizontal: false, vertical: true)
        HStack(spacing: 8) {
          if ping == .ask || ping == .asking {
            Button("Turn on") { Task { await turnOn() } }.buttonStyle(ObPrimary(height: 32)).disabled(busy).accessibilityIdentifier("first-chat-ping-on")
            Button("Not now", action: close).buttonStyle(ObOutline(height: 32)).disabled(busy)
          }
          if ping == .off {
            Button("Open the switch") { if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) } }.buttonStyle(ObPrimary(height: 32))
          }
          if ping == .off || ping == .on {
            Button(ping == .on ? "OK" : "Not now") { justOn = false; close() }.buttonStyle(ObOutline(height: 32))
          }
        }
        .padding(.top, 8)
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 14).padding(.vertical, 12)
    .background(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).fill(Palette.card))
    .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(Palette.cardBorder))
    .accessibilityElement(children: .contain).accessibilityLabel("Notifications")
  }

  private func reply(_ text: String) {
    sent = true
    Task {
      do { try await store.send(text, in: channel.id) } catch { sent = false }
    }
  }

  private func close() {
    WispPreferences.standard.set(true, forKey: FirstChat.askedKey(workspaceId))
    asked = true
  }

  private func turnOn() async {
    busy = true
    // the system's own prompt: nothing of ours sits on top of it
    if await store.enableNotifications() {
      justOn = true
      WispPreferences.standard.set(true, forKey: FirstChat.askedKey(workspaceId))
    }
    busy = false
  }
}

/** A one-tap answer: the first is the one filled button, the other an outline. */
private struct QuickReply: ButtonStyle {
  var primary: Bool

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 13)).foregroundStyle(primary ? Palette.ground : Palette.text).lineLimit(1)
      .padding(.horizontal, 14).frame(height: 32)
      .background(Capsule().fill(primary ? Palette.text : Palette.card))
      .overlay(Capsule().strokeBorder(primary ? .clear : Palette.hairline))
      .contentShape(Capsule())
      .pressFeedback(configuration.isPressed, scale: 0.97)
  }
}

/** A message's words. A first chat's hello types in once and underlines what it read in your apps just before; every other message is plain. */
struct MessageBody: View {
  @Environment(Store.self) private var store
  var message: Message

  var body: some View {
    if message.author.kind == .agent, let agent = store.agent(message.author.id), agent.settings?.setup?.greetingId == message.id {
      FirstHelloText(message: message, agentId: agent.id)
    } else {
      MarkdownText(message.body, edited: message.editedAt != nil, selectable: false)
    }
  }
}

private struct FirstHelloText: View {
  @Environment(Store.self) private var store
  var message: Message
  var agentId: String
  /** what it read in the person's apps; only its creator gets any back */
  @State private var read: [HelloRead.App] = []
  /** how much has typed in so far (nil: all of it) */
  @State private var shown: Int?
  @State private var started = false
  @ReduceMotion private var reduceMotion

  private var marked: AttributedString { Self.mark(MarkdownText.attributed(message.body), terms: FirstHello.terms(read).map(\.term)) }

  var body: some View {
    let all = marked
    let total = all.characters.count
    Text(shown.map { n in n < total ? AttributedString(all[all.startIndex..<all.index(all.startIndex, offsetByCharacters: n)]) : all } ?? all)
      .font(.system(size: 15))
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityLabel(String(all.characters))
      .task(id: message.id) {
        guard !started else { return }
        started = true
        async let terms = store.helloRead(agentId)
        // type it in only the first time it's seen, and only while it's new
        if FirstHello.shouldType(messageId: message.id, createdAt: message.date, reduceMotion: reduceMotion) {
          WispPreferences.standard.set(true, forKey: FirstChat.typedKey(message.id))
          shown = 0
          let begin = Date()
          while (shown ?? total) < total {
            try? await Task.sleep(for: .milliseconds(16))
            if Task.isCancelled { break }
            shown = min(total, Int(Date().timeIntervalSince(begin) * 70))
          }
          shown = nil
        }
        read = await terms
      }
  }

  /** Underline the known words (text only, never inside links or code). */
  static func mark(_ text: AttributedString, terms: [String]) -> AttributedString {
    guard !terms.isEmpty else { return text }
    var out = text
    let plain = String(text.characters)
    for r in FirstHello.ranges(of: terms, in: plain) {
      let from = out.index(out.startIndex, offsetByCharacters: plain.distance(from: plain.startIndex, to: r.lowerBound))
      let to = out.index(out.startIndex, offsetByCharacters: plain.distance(from: plain.startIndex, to: r.upperBound))
      if out[from..<to].runs.contains(where: { $0.link != nil || $0.inlinePresentationIntent?.contains(.code) == true }) { continue }
      out[from..<to].underlineStyle = Text.LineStyle(pattern: .dot)
    }
    return out
  }
}
