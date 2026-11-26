import SwiftUI

// The pieces of a conversation that look like Messages: your blue bubbles on the right, everyone else's
// grey on the left, a quote above a reply, time labels between, and the grey bubble with three pulsing
// dots while an agent works.

/** The message a composer is replying to: who said it and a few of their words. */
struct ReplyTarget: Hashable {
  var id: String
  var name: String
  var snippet: String
  /** "Yesterday 9:52 AM" when it's from an earlier chat than the latest one */
  var when: String? = nil
}

extension Store {
  /** Reply to a message: the composer of its conversation shows "Replying to …" and takes focus. */
  func startReply(_ m: Message, thread: String?) {
    let latest = messages[m.channelId]?.last { $0.author.id != "system" }?.conversationId
    let earlier = thread == nil && m.conversationId != nil && latest != nil && latest != m.conversationId
    replying[ComposerDrafts.key(channel: m.channelId, thread: thread)] = ReplyTarget(id: m.id, name: name(of: m.author), snippet: ChatFormat.snippet(m), when: earlier ? ChatFormat.stamp(m.date) : nil)
  }

  func replyTarget(channel: String, thread: String?) -> ReplyTarget? {
    replying[ComposerDrafts.key(channel: channel, thread: thread)]
  }

  func cancelReply(channel: String, thread: String?) {
    replying[ComposerDrafts.key(channel: channel, thread: thread)] = nil
  }
}

enum BubbleSide { case mine, theirs }

/**
 * A message bubble: 18pt corners, and on the last bubble of a group a small curled tail at the
 * bottom corner, like Messages (bottom right when it is yours, bottom left otherwise).
 */
struct BubbleShape: Shape {
  var mine: Bool
  var tail = false
  func path(in rect: CGRect) -> Path {
    var p = RoundedRectangle(cornerRadius: min(18, rect.height / 2), style: .continuous).path(in: rect)
    guard tail else { return p }
    var t = Path()
    let x = rect.maxX, y = rect.maxY
    t.move(to: CGPoint(x: x - 14, y: y - 18))
    t.addLine(to: CGPoint(x: x - 2, y: y - 18))
    t.addQuadCurve(to: CGPoint(x: x + 6, y: y), control: CGPoint(x: x - 1, y: y - 4))
    t.addQuadCurve(to: CGPoint(x: x - 16, y: y - 3), control: CGPoint(x: x - 5, y: y + 1))
    t.closeSubpath()
    if !mine { t = t.applying(CGAffineTransform(translationX: rect.minX + rect.maxX, y: 0).scaledBy(x: -1, y: 1)) }
    p.addPath(t)
    return p
  }
}

/** A message's rounded bubble: Bubble AI violet with dark words when it's yours, grey otherwise. */
struct Bubble<Content: View>: View {
  var side: BubbleSide
  /** the last bubble of its group: it gets a tail */
  var tail = false
  @ViewBuilder var content: Content

  var body: some View {
    content
      .padding(.horizontal, 13)
      .padding(.vertical, 8)
      .foregroundStyle(side == .mine ? Palette.mineInk : Palette.text)
      .tint(side == .mine ? Palette.mineInk : Palette.accent)
      .background(BubbleShape(mine: side == .mine, tail: tail).fill(side == .mine ? Palette.mine : Palette.bubble))
  }
}

/** The message a reply answers, above the reply's words inside its bubble; a tap goes to it. */
struct QuoteBlock: View {
  @Environment(Store.self) private var store
  @Environment(\.scrollToMessage) private var scrollTo
  var quote: ReplyQuote
  var side: BubbleSide
  /** the chat the reply itself is in: a quote from another chat shows when it was written */
  var chat: String? = nil

  private var author: String { quote.author == Actor(kind: .user, id: store.me?.id ?? "") ? "You" : store.name(of: quote.author) }

  /** " · Yesterday 9:52 AM" for a quote from an earlier chat */
  private var when: String? {
    guard let from = quote.conversationId, from != chat, let at = quote.createdAt.flatMap(Wire.date) else { return nil }
    return ChatFormat.stamp(at)
  }

  var body: some View {
    Button { scrollTo?(quote.id) } label: {
      HStack(spacing: 8) {
        Rectangle().fill(side == .mine ? Palette.mineInk.opacity(0.45) : Palette.faint).frame(width: 2)
        VStack(alignment: .leading, spacing: 1) {
          (Text(author).font(.system(size: 13, weight: .semibold)) + Text(when.map { " · \($0)" } ?? "").font(.system(size: 13)).foregroundStyle(.secondary))
            .lineLimit(1)
          Text(quote.deleted == true ? "This message was deleted." : quote.snippet).font(.system(size: 13)).lineLimit(2).multilineTextAlignment(.leading)
        }
        .opacity(0.85)
      }
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Reply to \(author)\(when.map { ", \($0)" } ?? ""): \(quote.snippet)")
    .accessibilityHint("Goes to that message")
  }
}

/** "Today 9:30 PM" between messages that are far apart. */
struct TimeDivider: View {
  var date: Date
  var body: some View {
    Text(ChatFormat.stamp(date))
      .font(.system(size: 13))
      .foregroundStyle(Palette.faint)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 12)
  }
}

/**
 * Where a new chat starts (after a quiet break): a hairline, "Today 5:28 PM", a hairline. A tap
 * offers "Continue this chat", which replies to the chat's last message.
 */
struct ChatDivider: View {
  var date: Date
  /** nil when there's nothing to continue (an archived team, no message to reply to) */
  var onContinue: (() -> Void)?
  @State private var open = false
  @ReduceMotion private var reduceMotion

  var body: some View {
    let label = ChatFormat.stamp(date)
    VStack(spacing: 0) {
      Button {
        withAnimation(Motion.pick(Motion.pop, reduceMotion)) { open.toggle() }
      } label: {
        HStack(spacing: 10) {
          Rectangle().fill(Palette.hairline).frame(height: 1)
          Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(open ? Palette.text : Palette.muted).fixedSize()
          Rectangle().fill(Palette.hairline).frame(height: 1)
        }
        .padding(.horizontal, 20)
        .padding(.top, 14).padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .disabled(onContinue == nil)
      .accessibilityLabel("Chat from \(label)")
      .accessibilityHint(onContinue == nil ? "" : "Shows Continue this chat")
      .accessibilityAddTraits(.isHeader)
      .accessibilityIdentifier("chat-divider")
      if open, let onContinue {
        Button {
          withAnimation(Motion.pick(Motion.soft, reduceMotion)) { open = false }
          onContinue()
        } label: {
          Label("Continue this chat", systemImage: "arrowshape.turn.up.left")
            .font(.system(size: 15))
            .foregroundStyle(Palette.text)
            .padding(.horizontal, 14)
            .frame(height: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.press)
        .padding(4)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: Corner.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(Palette.hairline))
        .shadow(color: .black.opacity(0.3), radius: 16, y: 8)
        .padding(.bottom, 6)
        .accessibilityIdentifier("continue-chat")
        .transition(reduceMotion ? .opacity : .scale(scale: 0.85, anchor: .top).combined(with: .opacity))
      }
    }
  }
}

/** Three dots that pulse while something works. */
struct PulseDots: View {
  @State private var on = false
  @ReduceMotion private var reduceMotion

  var body: some View {
    HStack(spacing: 4) {
      ForEach(0..<3, id: \.self) { i in
        Circle().fill(Palette.muted).frame(width: 7, height: 7)
          .opacity(reduceMotion ? 0.7 : on ? 1 : 0.3)
          .animation(reduceMotion ? nil : .easeInOut(duration: 0.6).repeatForever(autoreverses: true).delay(Double(i) * 0.2), value: on)
      }
    }
    .onAppear { on = true }
    .accessibilityHidden(true)
  }
}

/**
 * An agent's reply as it's being written: its words so far. What it's doing shows once, in the
 * activity pill above the message bar (with Stop), not again here.
 */
struct StreamingRow: View {
  @Environment(Store.self) private var store
  var run: LiveRun

  private var home: Bool {
    store.channels.first { $0.id == run.channelId }.flatMap { store.dmAgent($0) }?.id == run.agentId
  }

  var body: some View {
    if !run.text.isEmpty {
      HStack(alignment: .bottom, spacing: 8) {
        if !home { AgentAvatar(agent: store.agent(run.agentId), size: 24, showStatus: false).frame(width: 24) }
        VStack(alignment: .leading, spacing: 3) {
          if !home { Text(store.agent(run.agentId)?.name ?? "Agent").font(.system(size: 12)).foregroundStyle(Palette.faint).padding(.leading, 14) }
          Bubble(side: .theirs, tail: true) { MarkdownText(run.text) }
        }
        Spacer(minLength: 40)
      }
      .padding(.horizontal, 16)
      .padding(.top, 8)
      .padding(.bottom, 4)
    }
  }
}

/** "› Handed to Pappy · 4 replies · Working": a step Bubble AI handed out, which opens its own thread. */
struct HandoffRow: View {
  @Environment(Store.self) private var store
  var message: Message
  var taskId: String
  var replies: Int
  var thread: ThreadRef
  var working: [Agent]

  var body: some View {
    let task = store.tasks.first { $0.id == taskId }
    let agent = task.flatMap { store.agent($0.toAgentId ?? "") }
    let state = working.isEmpty ? task.map { store.taskState($0) } : "Working"
    NavigationLink(value: thread) {
      HStack(spacing: 6) {
        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.muted)
        (Text("Handed to ") + Text(agent?.name ?? Self.handle(message.body) ?? "an agent").fontWeight(.semibold))
        if replies > 0 { Text("· \(replies == 1 ? "1 reply" : "\(replies) replies")").foregroundStyle(Palette.muted) }
        if let state { Text("· \(state)").foregroundStyle(working.isEmpty ? Palette.muted : Palette.statusWorkingText) }
      }
      .font(.system(size: 13))
      .foregroundStyle(Palette.text)
      .lineLimit(1)
      .padding(.horizontal, 14)
      .frame(height: 38)
      .glassPill()
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .padding(.horizontal, 16)
    .padding(.leading, 38)
    .padding(.vertical, 4)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityLabel("Handed to \(agent?.name ?? "an agent")\(replies > 0 ? ", \(replies) replies" : "")\(state.map { ", \($0)" } ?? ""). Opens its thread")
    .accessibilityIdentifier("handoff-row")
  }

  static func handle(_ body: String) -> String? {
    body.range(of: "^@[\\w-]+", options: .regularExpression).map { String(body[$0].dropFirst()) }
  }
}

/** A way for a quote to ask the list it's in to scroll to a message. */
private struct ScrollToMessageKey: EnvironmentKey { nonisolated(unsafe) static let defaultValue: ((String) -> Void)? = nil }
extension EnvironmentValues {
  var scrollToMessage: ((String) -> Void)? {
    get { self[ScrollToMessageKey.self] }
    set { self[ScrollToMessageKey.self] = newValue }
  }
}

/** The message the list just scrolled to, so its row can flash. */
private struct FlashedMessageKey: EnvironmentKey { static let defaultValue: String? = nil }
extension EnvironmentValues {
  var flashedMessage: String? {
    get { self[FlashedMessageKey.self] }
    set { self[FlashedMessageKey.self] = newValue }
  }
}

/** A card an agent posts in the chat: a small label with a line icon, then what the card says. */
struct ChatCardShell<Content: View>: View {
  var symbol: String
  var label: String
  var warn = false
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label { Text(label).font(.system(size: 13, weight: .medium)) } icon: { Image(systemName: symbol).font(.system(size: 12)) }
        .foregroundStyle(warn ? Color.orange : Palette.muted)
      content
    }
    .padding(16)
    .frame(maxWidth: 340, alignment: .leading)
    .background(Palette.card, in: RoundedRectangle(cornerRadius: Corner.card, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(Palette.cardBorder))
  }
}

/** The big pill buttons on a card: the main answer filled, the other outlined. */
struct CardButtonStyle: ButtonStyle {
  var prominent = false
  /** red, for an answer that deletes something */
  var danger = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 15, weight: .semibold))
      .foregroundStyle(danger ? Color.white : prominent ? Palette.ground : Palette.text)
      .frame(maxWidth: .infinity)
      .frame(height: 44)
      .background(Capsule().fill(danger ? Palette.red : prominent ? Palette.text : Palette.control))
      .overlay(Capsule().strokeBorder(Palette.hairline, lineWidth: prominent ? 0 : 1))
      .pressFeedback(configuration.isPressed)
  }
}

/**
 * A large link card under a message (web: linkPreview.ts): the picture on top when the link is
 * one, then a title and the domain. The hub keeps no link-preview data and nothing is fetched for
 * it, so the title comes from the link's own path. GitHub pull requests and issues keep their own card.
 */
struct LinkPreview: Identifiable, Hashable {
  var url: String
  var domain: String
  var title: String
  var image: URL?
  var id: String { url }

  nonisolated(unsafe) private static let picture = /\.(png|jpe?g|gif|webp|avif)$/.ignoresCase()
  nonisolated(unsafe) private static let github = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(pull|issues)\/\d+/

  /** A readable title from the link: the last part of its path, words split out, or the site's name. */
  static func title(_ u: URL) -> String {
    let parts = u.path().split(separator: "/").map(String.init)
    var last = (parts.last?.removingPercentEncoding ?? parts.last ?? "")
    if let dot = last.range(of: #"\.[A-Za-z0-9]{2,5}$"#, options: .regularExpression) { last.removeSubrange(dot) }
    let words = last.replacingOccurrences(of: #"[-_+]+"#, with: " ", options: .regularExpression)
      .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    if words.count > 2, !words.allSatisfy(\.isNumber) { return words.prefix(1).uppercased() + words.dropFirst() }
    let host = (u.host() ?? "").replacingOccurrences(of: #"^www\."#, with: "", options: .regularExpression)
    return host.prefix(1).uppercased() + host.dropFirst()
  }

  /** The first two http(s) links in a message, as cards. */
  static func find(_ body: String) -> [LinkPreview] {
    var out: [LinkPreview] = []
    for m in body.matches(of: /https?:\/\/[^\s<>()"'`\]]+/) {
      var raw = String(m.output)
      while let c = raw.last, ".,;:!?".contains(c) { raw.removeLast() }
      if raw.wholeMatch(of: github) != nil || raw.prefixMatch(of: github) != nil || out.contains(where: { $0.url == raw }) { continue }
      guard let u = URL(string: raw), let host = u.host() else { continue }
      if host == "localhost" || host == "127.0.0.1" || (u.fragment()?.hasPrefix("/") ?? false) { continue }
      let isPicture = u.path().firstMatch(of: picture) != nil
      out.append(LinkPreview(url: raw, domain: host.replacingOccurrences(of: #"^www\."#, with: "", options: .regularExpression), title: title(u), image: isPicture ? u : nil))
      if out.count == 2 { break }
    }
    return out
  }
}

struct LinkCard: View {
  @Environment(\.openURL) private var openURL
  var link: LinkPreview

  var body: some View {
    Button { if let u = URL(string: link.url) { openURL(u) } } label: {
      VStack(alignment: .leading, spacing: 0) {
        if let image = link.image {
          AsyncImage(url: image) { phase in
            if let picture = phase.image { picture.resizable().scaledToFill() } else { Palette.hairline }
          }
          .frame(width: 260, height: 160).clipped()
        }
        VStack(alignment: .leading, spacing: 2) {
          Text(link.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(2).multilineTextAlignment(.leading)
          Text(link.domain).font(.system(size: 13)).foregroundStyle(Palette.muted).lineLimit(1)
        }
        .padding(.horizontal, 13).padding(.vertical, 10)
        .frame(width: 260, alignment: .leading)
      }
      .background(Palette.bubble)
      .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
    .buttonStyle(.press)
    .accessibilityLabel("\(link.title), \(link.domain)")
    .accessibilityHint("Opens the link")
  }
}
