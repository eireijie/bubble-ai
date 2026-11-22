import SwiftUI

/**
 * The first run on the phone, right after pairing with a Wisp nobody has made an agent on yet:
 * pick your agent (and set up its apps), make it yours, choose what it thinks with, then its chat.
 * One host ghost carries through every page. It can be closed for later; the Inbox still offers
 * to make an agent.
 */
struct OnboardingFlow: View {
  @Environment(Store.self) private var store
  var workspaceId: String
  /** the flow is over: open this chat (nil: there's no agent yet) */
  var onFinish: (_ channelId: String?) -> Void
  enum Step: Int { case type, agent, ai }
  @State private var step = Step.type
  @State private var forward = true
  @State private var stage = HostStage()
  @State private var loaded = false
  @Namespace private var host
  @ReduceMotion private var reduceMotion

  var body: some View {
    ZStack {
      if loaded {
        switch step {
        case .type:
          OnboardingTypeStep(workspaceId: workspaceId, onContinue: { go(.agent) }, onClose: { finish(nil) }).transition(page)
        case .agent:
          OnboardingAgentStep(workspaceId: workspaceId, onContinue: { go(.ai) }, onBack: { go(.type) }).transition(page)
        case .ai:
          OnboardingAIStep(workspaceId: workspaceId, onDone: { _, channelId in finish(channelId) }, onBack: { go(.agent) }).transition(page)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Palette.ground.ignoresSafeArea())
    .environment(stage)
    .environment(\.hostNamespace, host)
    .tint(Palette.text)
    .onAppear {
      guard !loaded else { return }
      // after leaving mid-way, pick up at the first page not done yet
      let saved = OnboardingAnswers.load(workspaceId)
      step = !saved.typeDone ? .type : saved.agentDraft == nil ? .agent : .ai
      loaded = true
    }
    .accessibilityIdentifier("onboarding")
  }

  /** A page slides in from the side it's headed (40pt, with a fade); the one before only fades. */
  private var page: AnyTransition {
    reduceMotion ? .opacity : .asymmetric(insertion: .offset(x: forward ? 40 : -40).combined(with: .opacity), removal: .opacity)
  }

  private func go(_ next: Step) {
    forward = next.rawValue > step.rawValue
    withAnimation(Motion.pick(.spring(response: 0.45, dampingFraction: 0.9), reduceMotion)) { step = next }
  }

  private func finish(_ channelId: String?) {
    OnboardingAnswers.save(workspaceId) { $0.closed = true }
    onFinish(channelId)
  }
}
