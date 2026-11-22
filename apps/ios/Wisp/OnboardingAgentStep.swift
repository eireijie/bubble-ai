import SwiftUI

/**
 * First-run page 2: make the agent theirs. Everything starts filled in from the kind picked on
 * page 1. Continue only saves a draft; the next page creates the agent once its AI is chosen.
 */
struct OnboardingAgentStep: View {
  @Environment(Store.self) private var store
  @Environment(HostStage.self) private var stage
  var workspaceId: String
  var onContinue: () -> Void
  var onBack: () -> Void
  @State private var name = "Juno"
  @State private var role = ""
  @State private var suggestedRole = OnboardingText.noGoalRole
  @State private var color = OnboardingText.colors[0]
  @State private var shape = "classic"
  /** the white host puts on the agent's colour a beat after the page opens (already dressed when coming back) */
  @State private var dressed = false
  @State private var smile = false
  @State private var smileTask: Task<Void, Never>?
  /** bumps when the shape changes, so the new one morphs in instead of cutting */
  @State private var morph = 0
  @State private var loaded = false
  @ReduceMotion private var reduceMotion

  private var person: String { store.me?.preferredName ?? store.me?.name ?? "" }
  private var agent: String { name.trimmed.isEmpty ? "your agent" : name.trimmed }
  private var look: GhostLook { dressed ? OnboardingLook.agent(color: color, shape: shape) : { var l = OnboardingLook.host; l.shape = shape; return l }() }

  var body: some View {
    OnboardingPage(step: 2, onBack: onBack) {
      VStack(alignment: .leading, spacing: 22) {
        card
        preview
        OnboardingHead(title: "Make me yours.", sub: "I picked these from what you told me. Change anything.")
        field("Name") {
          ObField(placeholder: "Name", text: $name, id: "ob-agent-name", limit: 40).autocorrectionDisabled()
          HStack(spacing: 6) {
            ForEach(OnboardingText.names(for: person), id: \.self) { n in
              Button(n) { pickName(n) }.buttonStyle(Chip(on: name.trimmed == n)).accessibilityAddTraits(name.trimmed == n ? .isSelected : [])
            }
          }
        }
        field("What I do") { ObField(placeholder: suggestedRole, text: $role, id: "ob-agent-role") }
        field("Colour") {
          HStack(spacing: 10) {
            ForEach(Array(OnboardingText.colors.enumerated()), id: \.element) { i, c in
              Button { pickColor(c) } label: {
                Circle().fill(Color(hex: c)).padding(3)
                  .overlay(Circle().strokeBorder(color == c ? Color(hex: c) : .clear, lineWidth: 2))
                  .frame(width: 36, height: 36).contentShape(Circle())
              }
              .buttonStyle(.press)
              .accessibilityLabel(OnboardingText.colorNames[i]).accessibilityAddTraits(color == c ? .isSelected : [])
              .accessibilityIdentifier("ob-color-\(i)")
            }
          }
          .animation(Motion.pick(Motion.pop, reduceMotion), value: color)
        }
        field("Shape") {
          HStack(spacing: 8) {
            ForEach(OnboardingText.shapes, id: \.self) { s in
              Button { pickShape(s) } label: {
                GhostView(look: OnboardingLook.agent(color: color, shape: s), seed: "host", size: 38, animate: false)
                  .frame(width: 56, height: 56)
                  .background(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).fill(shape == s ? Color(hex: color).opacity(0.12) : Palette.card))
                  .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(shape == s ? Color(hex: color) : Palette.cardBorder, lineWidth: shape == s ? 2 : 1))
                  .contentShape(RoundedRectangle(cornerRadius: Corner.card, style: .continuous))
              }
              .buttonStyle(.press)
              .accessibilityLabel(OnboardingText.shapeLabels[s] ?? s).accessibilityAddTraits(shape == s ? .isSelected : [])
              .accessibilityIdentifier("ob-shape-\(s)")
            }
          }
          .animation(Motion.pick(Motion.pop, reduceMotion), value: shape)
        }
      }
    } bottom: {
      Button("Continue", action: save).buttonStyle(ObPrimary()).disabled(name.trimmed.isEmpty).accessibilityIdentifier("ob-agent-next")
      Button("Surprise me", action: surprise).buttonStyle(ObOutline()).padding(.leading, 4).accessibilityIdentifier("ob-agent-surprise")
    }
    .task {
      guard !loaded else { return }
      loaded = true
      let answers = OnboardingAnswers.load(workspaceId)
      suggestedRole = OnboardingText.role(for: answers)
      if let draft = answers.agentDraft {
        name = draft.name; role = draft.role; color = OnboardingText.colors.contains(draft.color) ? draft.color : color
        shape = OnboardingText.shapes.contains(draft.shape) ? draft.shape : shape
        dressed = true
        return
      }
      role = suggestedRole
      if !reduceMotion { try? await Task.sleep(for: .milliseconds(650)) }
      guard !dressed else { return }
      withAnimation(Motion.pick(Motion.soft, reduceMotion)) { dressed = true }
      stage.react(.hop)
    }
    .onDisappear { smileTask?.cancel() }
  }

  // MARK: the parts

  /** The agent as it will look: its ghost, name and what it does, edged in its colour. */
  private var card: some View {
    VStack(spacing: 10) {
      HostGhost(look: look, size: 120, happy: smile)
        .scaleEffect(morphing ? 0.86 : 1).rotationEffect(.degrees(morphing ? -6 : 0)).opacity(morphing ? 0.55 : 1)
      VStack(spacing: 2) {
        Text(agent).font(.system(size: 15, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
        Text(role.trimmed.isEmpty ? suggestedRole : role.trimmed).font(.system(size: 13)).foregroundStyle(Palette.muted).multilineTextAlignment(.center).lineLimit(2)
      }
      .padding(.horizontal, 24)
    }
    .frame(maxWidth: .infinity).frame(height: 216)
    .background(RoundedRectangle(cornerRadius: Corner.sheet, style: .continuous).fill(Palette.card))
    .overlay(RoundedRectangle(cornerRadius: Corner.sheet, style: .continuous).strokeBorder(dressed ? Color(hex: color) : Palette.cardBorder, lineWidth: 1.5))
    .animation(Motion.pick(.easeOut(duration: 0.3), reduceMotion), value: color)
  }

  @State private var morphing = false

  /** Its first line, as it would say it in a chat. */
  private var preview: some View {
    let line = OnboardingText.preview(person: person, agent: agent)
    return HStack(alignment: .top, spacing: 10) {
      GhostView(look: OnboardingLook.agent(color: color, shape: shape), seed: "host", size: 28)
      VStack(alignment: .leading, spacing: 4) {
        Text(agent).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
        Text(line).font(.system(size: 15)).foregroundStyle(Palette.text).fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 14).padding(.vertical, 9)
          .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Palette.bubble))
          .id(line).obPop()
      }
      Spacer(minLength: 0)
    }
    .animation(Motion.pick(Motion.soft, reduceMotion), value: line)
    .accessibilityElement(children: .combine)
  }

  private func field<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(label).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted)
      content()
    }
  }

  // MARK: picks

  private func bump(_ kind: HostReaction = .hop) {
    dressed = true
    stage.answer(kind, reduceMotion: reduceMotion)
    guard !reduceMotion else { return }
    smile = true
    smileTask?.cancel()
    smileTask = Task { try? await Task.sleep(for: .milliseconds(1100)); if !Task.isCancelled { smile = false } }
  }

  private func pickName(_ n: String) { name = n; bump(.nod) }
  private func pickColor(_ c: String) { color = c; bump() }

  private func pickShape(_ s: String) {
    guard s != shape else { return bump() }
    shape = s
    bump()
    guard !reduceMotion else { return }
    // a new shape morphs in (a quick shrink and twist back to rest), never a cut
    var instant = Transaction(animation: nil)
    instant.disablesAnimations = true
    withTransaction(instant) { morphing = true }
    DispatchQueue.main.async { withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) { morphing = false } }
  }

  private func surprise() {
    func any<T: Equatable>(_ list: [T], not: T) -> T { list.filter { $0 != not }.randomElement() ?? not }
    name = any(OnboardingText.namePool, not: name)
    color = any(OnboardingText.colors, not: color)
    let next = any(OnboardingText.shapes, not: shape)
    pickShape(next)
  }

  private func save() {
    let n = name.trimmed
    guard !n.isEmpty else { return }
    let r = role.trimmed.isEmpty ? suggestedRole : role.trimmed
    let handle = OnboardingText.handle(n)
    OnboardingAnswers.save(workspaceId) {
      $0.agentDraft = FirstAgentDraft(name: n, handle: handle.isEmpty ? nil : handle, role: r, color: color, shape: shape, instructions: OnboardingText.instructions(agent: n, person: person, role: r))
    }
    onContinue()
  }
}

/** A small pill to tap: a suggested name. */
private struct Chip: ButtonStyle {
  var on: Bool

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 13)).foregroundStyle(Palette.text)
      .padding(.horizontal, 12).frame(height: 30)
      .background(Capsule().fill(Palette.card))
      .overlay(Capsule().strokeBorder(on ? Palette.text : Palette.hairline))
      .contentShape(Capsule())
      .pressFeedback(configuration.isPressed, scale: 0.96)
  }
}
