import SwiftUI
import UIKit

/**
 * Connect apps → This iPhone (round 11, board 14): the phone features agents can use, each with its
 * own Allow. They're the Apple mod's apps (Calendar, Reminders, Contacts, Location); the full Apple
 * page (places, Messages, which agents) is one row below. Nothing is shared until you tap Allow.
 */
struct ThisIPhoneList: View {
  @Environment(Store.self) private var store
  @State private var asking: AppleApp?
  @State private var action = FormAction()

  static let apps: [(AppleApp, String, String)] = [
    (.calendar, "calendar", "See and add events"),
    (.reminders, "list.bullet", "Add and check reminders"),
    (.contacts, "person", "Look up people you know"),
    (.location, "mappin.and.ellipse", "Find places near you"),
  ]

  private func level(_ app: AppleApp) -> Int { store.features.apple ? (store.apple?.settings.levels[app] ?? 0) : 0 }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Let your agents use these. Nothing is shared until you tap Allow.")
        .font(.system(size: 14)).foregroundStyle(Palette.muted).padding(.horizontal, 4)
      VStack(spacing: 6) {
        ForEach(Self.apps, id: \.0) { app, symbol, line in row(app, symbol, line) }
      }
      if !store.isOwner { MarketNote(text: "Only owners can allow these.") }
      InlineError(error: action.error)
      if store.features.apple {
        CardGroup {
          NavigationLink { AppleView() } label: { RowLabel(title: "Places, Messages and which agents", leading: { rowIcon("apple.logo") }) }
            .buttonStyle(.plain).accessibilityIdentifier("iphone-apple-more")
        }
      }
    }
    .task { await store.refreshApple() }
    // an alert, not a confirmation dialog: the Marketplace around this list already has one, and only one shows
    .alert("Turn on Apple?", isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }), presenting: asking) { app in
      Button("Cancel", role: .cancel) {}
      Button("Turn on and allow \(app.name)") { allow(app) }
    } message: { _ in Text(FeatureKey.apple.detail) }
  }

  private func row(_ app: AppleApp, _ symbol: String, _ line: String) -> some View {
    let on = level(app) > 0
    return HStack(spacing: 12) {
      Image(systemName: symbol).font(.system(size: 17)).foregroundStyle(Palette.text)
        .frame(width: 42, height: 42)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.card))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.cardBorder))
      VStack(alignment: .leading, spacing: 1) {
        Text(app.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.text)
        Text(line).font(.system(size: 13)).foregroundStyle(Palette.muted)
      }
      Spacer(minLength: 8)
      if on {
        Text("Allowed").font(.system(size: 14)).foregroundStyle(Palette.muted)
      } else if store.isOwner {
        Button { store.features.apple ? allow(app) : (asking = app) } label: {
          Text("Allow").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
            .padding(.horizontal, 14).frame(height: 30).background(Capsule().fill(ChatDot.blue))
        }
        .buttonStyle(.press).disabled(action.busy)
        .accessibilityLabel("Allow \(app.name)")
        .accessibilityIdentifier("iphone-allow-\(app.rawValue)")
      } else {
        Text("Off").font(.system(size: 14)).foregroundStyle(Palette.faint)
      }
    }
    .padding(.vertical, 6).padding(.horizontal, 2)
    .accessibilityElement(children: .combine)
  }

  /** Turns the Apple mod on first if it's off (you tapped Allow and said yes), then lets agents use the app. */
  private func allow(_ app: AppleApp) {
    action.run {
      if !store.features.apple {
        var next = store.features
        next.apple = true
        try await store.setFeatures(next)
        await store.refreshApple()
      }
      try await store.saveApple(AppleSettingsPatch(levels: [app.rawValue: 1]))
      if app == .location, AppleLocation.shared.authorization == .notDetermined { AppleLocation.shared.askWhenInUse() }
    }
  }
}

/**
 * Import memory (round 11, board 14): copy one prompt into another AI, paste its answer back, and
 * each line becomes something your agents know about you (Memory › About you, where each can be seen
 * and deleted).
 */
struct ImportMemoryView: View {
  @Environment(Store.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var answer = ""
  @State private var copied = false
  @State private var action = FormAction()
  @State private var added: Int?
  @FocusState private var focused: Bool

  static let prompt = "Tell me everything you've learned about me from our chats: my work, people I mention, preferences, routines, and any rules I've asked you to follow. Use my own words where you can. Write one fact per line, with no headings."

  var body: some View {
    MemoryScreen(title: "Import memory", id: "import-memory") {
      step("1 · Copy this into ChatGPT, Gemini or Claude")
      Text(Self.prompt)
        .font(.system(size: 15)).foregroundStyle(Palette.muted)
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.card))
        .textSelection(.enabled)
      Button {
        UIPasteboard.general.string = Self.prompt
        copied = true
      } label: {
        Text(copied ? "Copied" : "Copy prompt").font(.system(size: 15, weight: .semibold)).foregroundStyle(ChatDot.blue)
      }
      .buttonStyle(.plain).padding(.horizontal, 4).accessibilityIdentifier("import-copy")
      step("2 · Paste its answer here").padding(.top, 6)
      TextEditor(text: $answer)
        .focused($focused)
        .font(.system(size: 15)).foregroundStyle(Palette.text)
        .scrollContentBackground(.hidden)
        .padding(10).frame(minHeight: 170)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.card))
        .overlay(alignment: .topLeading) {
          if answer.isEmpty { Text("Paste the answer…").font(.system(size: 15)).foregroundStyle(Palette.faint).padding(.horizontal, 15).padding(.vertical, 18).allowsHitTesting(false) }
        }
        .accessibilityLabel("The answer").accessibilityIdentifier("import-answer")
      if let added {
        Text(added == 0 ? "Nothing new: your agents already knew all of that." : "Added \(added) \(added == 1 ? "note" : "notes"). Every agent can use them.")
          .font(.system(size: 14)).foregroundStyle(Palette.statusOnlineText).padding(.horizontal, 4)
      }
      InlineError(error: action.error)
      PillButton(title: action.busy ? "Adding…" : "Add to memory", busy: action.busy, id: "import-add") { add() }
        .disabled(ImportMemory.facts(answer).isEmpty || action.busy)
        .opacity(ImportMemory.facts(answer).isEmpty ? 0.45 : 1)
        .padding(.top, 4)
      Text("Every agent can use it. You can see and delete each note in Memory › About you.")
        .font(.system(size: 13)).foregroundStyle(Palette.faint).padding(.horizontal, 4)
    }
  }

  private func step(_ text: String) -> some View {
    Text(text).font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.text).padding(.horizontal, 2)
  }

  private func add() {
    let facts = ImportMemory.facts(answer)
    focused = false
    action.run {
      var saved = 0
      for fact in facts {
        do {
          try await store.remember(["kind": AnyEncodable(ImportMemory.kind(fact)), "text": AnyEncodable(fact)])
          saved += 1
        } catch let e as API.Failure where e.status == 409 {
          // already known: skip it
        }
      }
      added = saved
      answer = ""
    }
  }
}

/** Turning another AI's answer into memories. Pure, so it can be tested. */
enum ImportMemory {
  /** One fact per line: bullets, numbers and headings stripped, blank and very short lines dropped, at most 200. */
  static func facts(_ text: String) -> [String] {
    var out: [String] = []
    for raw in text.components(separatedBy: .newlines) {
      var line = raw.trimmingCharacters(in: .whitespaces)
      if line.hasPrefix("#") { continue }
      while let first = line.first, "-*•·".contains(first) { line = String(line.dropFirst()).trimmingCharacters(in: .whitespaces) }
      if let r = line.range(of: #"^\d{1,3}[.)]\s+"#, options: .regularExpression) { line.removeSubrange(r) }
      line = line.replacingOccurrences(of: "**", with: "")
      // "Work:" alone is a heading, not a fact
      if line.hasSuffix(":") && !line.contains(" ") { continue }
      guard line.count >= 4 else { continue }
      let fact = String(line.prefix(4000))
      if !out.contains(fact) { out.append(fact) }
      if out.count == 200 { break }
    }
    return out
  }

  /** "I prefer…", "always…", "never…" are preferences; everything else is a detail. */
  static func kind(_ fact: String) -> String {
    let l = fact.lowercased()
    return ["prefer", "like ", "likes ", "love", "hate", "always", "never", "don't want", "rather"].contains { l.contains($0) } ? "preference" : "detail"
  }
}
