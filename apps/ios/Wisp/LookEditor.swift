import SwiftUI

/**
 * Look (2026-11-25 "Bubble AI, bubbles", board "Bubble shapes"): the agent's bubble, big, with small
 * bubbles drifting up behind it and a mood to preview it in; then its shape (eight) and colour
 * (six, or your own). Every shape keeps the clear body, rainbow rim and face. Back to its
 * original look and Save sit at the bottom.
 */
struct LookEditor: View {
  @Environment(Store.self) private var store
  @Environment(\.dismiss) private var dismiss
  private var agent: Agent?
  private var draft: Binding<GhostLook>?
  private var name: String
  private var seed: String
  @State private var look: GhostLook
  @State private var mood: GhostMood = .awake
  @State private var saving = false
  @State private var error: String?

  /** Edits an agent's look and saves it to the hub. */
  init(agent: Agent) {
    self.agent = agent
    name = agent.name
    seed = agent.handle
    _look = State(initialValue: (agent.settings?.appearance ?? GhostLook.defaultAppearance(agent.handle)).resolved)
  }

  /** Edits the look of an agent that doesn't exist yet (New agent); Done hands it back. */
  init(look: Binding<GhostLook>, name: String, seed: String) {
    draft = look
    self.name = name.isEmpty ? "New agent" : name
    self.seed = seed
    _look = State(initialValue: look.wrappedValue.resolved)
  }

  static let previewMoods: [(GhostMood, String)] = [(.awake, "Idle"), (.working, "Working"), (.waiting, "Needs you"), (.asleep, "Offline")]

  private var shape: BubbleForm { BubbleForm(look) }
  private var color: String { BubbleColors.color(look, seed: seed) }

  var body: some View {
    NavigationStack {
      AgentFrame(title: "Look", subtitle: name, close: true) {
        ZStack {
          BubbleField().clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
          GhostView(look: look, seed: seed, size: 132, mood: mood, interactive: true)
            .frame(width: 132, height: 132).accessibilityLabel("\(name)'s bubble")
        }
        .frame(maxWidth: .infinity).frame(height: 200)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.card))
        Segments(options: Self.previewMoods.map { ($0.0, $0.1) }, selection: $mood)
        CardCaption("Shape")
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
          ForEach(BubbleForm.allCases) { s in
            let on = s == shape
            Button { look.bubble = s.rawValue } label: {
              VStack(spacing: 6) {
                GhostView(look: preview(s), seed: seed, size: 40, animate: false).frame(width: 40, height: 40)
                Text(s.name).font(.system(size: 12, weight: on ? .semibold : .regular)).foregroundStyle(on ? Palette.text : Palette.muted)
              }
              .frame(maxWidth: .infinity).frame(height: 84)
              .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(on ? Palette.hairline : .clear))
              .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(on ? Palette.mine : .clear, lineWidth: 2))
              .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Shape: \(s.name)")
            .accessibilityAddTraits(on ? .isSelected : [])
            .accessibilityIdentifier("look-shape-\(s.rawValue)")
          }
        }
        CardCaption("Colour")
        HStack(spacing: 8) {
          ForEach(BubbleColors.all, id: \.hex) { c in
            let on = c.hex == color.lowercased()
            Button { setColor(c.hex) } label: {
              Circle().fill(Color(hex: c.hex)).frame(width: 30, height: 30)
                .overlay { if on { Circle().stroke(Palette.text, lineWidth: 2).padding(-4) } }
                .frame(width: 40, height: 40).contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(c.name)
            .accessibilityAddTraits(on ? .isSelected : [])
          }
          ColorPicker("Your own colour", selection: Binding(get: { Color(hex: color) }, set: { setColor($0.hexString) }), supportsOpacity: false)
            .labelsHidden()
            .frame(width: 40, height: 40)
          Spacer(minLength: 0)
        }
        CardGroup {
          Button { look = GhostLook.defaultAppearance(seed).resolved } label: {
            RowLabel(title: "Back to its original look", chevron: false, leading: { rowIcon("arrow.counterclockwise") })
          }.buttonStyle(.plain).accessibilityIdentifier("look-reset")
        }
        AgentError(text: error)
        PillButton(title: draft == nil ? "Save" : "Done", busy: saving, id: "look-save") { save() }.disabled(saving)
      }
    }
    .agentSheet()
    .interactiveDismissDisabled(saving)
  }

  private func preview(_ s: BubbleForm) -> GhostLook {
    var result = look
    result.bubble = s.rawValue
    return result
  }

  private func setColor(_ hex: String) {
    look.color = hex
    look.color2 = nil
  }

  private func save() {
    if let draft {
      draft.wrappedValue = look.resolved
      dismiss()
      return
    }
    guard let agent else { return }
    Task {
      saving = true
      error = nil
      do { try await store.saveLook(look, for: agent); dismiss() }
      catch { self.error = error.localizedDescription }
      saving = false
    }
  }

}

enum GhostLabels {
  /** A look option in words: "tophat" is Top hat, "bowtie" is Bow tie, "none" is None. */
  static func label(_ value: String) -> String {
    ["sheet": "Bedsheet", "tophat": "Top hat", "bowtie": "Bow tie", "sunglasses": "Shades"][value] ?? value.capitalized
  }
}

extension GhostLook {
  /** A random look from every option, like Shuffle on the web. */
  static func shuffled(keeping motion: String? = nil) -> GhostLook {
    let palette = palettes.randomElement()!
    return GhostLook(color: palette.top, color2: palette.bottom, eyes: eyeStyles.randomElement(), mouth: mouths.dropLast().randomElement(),
      cheeks: Double.random(in: 0..<1) < 0.6, shape: shapes.randomElement(), glow: false,
      hat: Double.random(in: 0..<1) < 0.4 ? hats.dropFirst().randomElement() : "none",
      accessory: Double.random(in: 0..<1) < 0.35 ? accessories.dropFirst().randomElement() : "none", motion: motion ?? "float")
  }

  /** A new agent's look: plain white, with a random face and outfit. */
  static func newAgent() -> GhostLook {
    var look = shuffled()
    look.color = GhostColors.white
    look.color2 = GhostColors.white
    return look
  }
}
