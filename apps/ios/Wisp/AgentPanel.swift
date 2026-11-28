import SwiftUI

/**
 * Swipe left in a chat with one agent (round 11, board 10): the chat slides aside and the agent's
 * panel comes in from the right, the same short list as its profile. Tap the chat (or drag it back)
 * to close; while it's open a swipe right closes it. Otherwise a swipe right is the system's Back.
 */
struct AgentPanelHost<Panel: View>: ViewModifier {
  var agent: Agent?
  @Binding var drag: CGFloat
  @Binding var open: Bool
  @ViewBuilder var panel: Panel
  @State private var width: CGFloat = 390

  private var panelWidth: CGFloat { min(340, width * 0.84) }
  private var reveal: CGFloat { min(panelWidth, max(0, (open ? panelWidth : 0) - drag)) }

  func body(content: Content) -> some View {
    if agent == nil {
      content
    } else {
      content
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .overlay {
          if reveal > 0 {
            Color.black.opacity(0.22 * reveal / panelWidth).ignoresSafeArea()
              .contentShape(Rectangle())
              .onTapGesture { settle(open: false) }
              .accessibilityLabel("Close the panel")
              .accessibilityAddTraits(.isButton)
          }
        }
        .overlay(alignment: .topTrailing) {
          if reveal > 0 {
            panel
              .frame(width: panelWidth)
              .frame(maxHeight: .infinity, alignment: .top)
              .background(Palette.sheet.ignoresSafeArea())
              .offset(x: panelWidth)
              .accessibilityAddTraits(.isModal)
          }
        }
        .offset(x: -reveal)
        .gesture(PanelPan(open: open, changed: { dx in
          drag = open ? max(0, dx) : min(0, dx)
        }, ended: { flung in
          settle(open: open ? flung < panelWidth * 0.35 : -flung > panelWidth * 0.35)
        }))
        .accessibilityAction(named: "Open \(agent?.name ?? "the agent")'s panel") { settle(open: true) }
        .onChange(of: open, initial: true) { _, now in BackSwipe.paused = now }
        .onDisappear { BackSwipe.paused = false }
    }
  }

  private func settle(open next: Bool) {
    withAnimation(.snappy(duration: 0.25)) {
      open = next
      drag = 0
    }
  }
}

/** The panel itself: the agent's face, name and what it's doing, its short list, and Full profile. */
struct AgentPanel: View {
  @Environment(Store.self) private var store
  var agent: Agent
  var channelId: String
  /** how full this conversation is (0…1), when known */
  var context: Double?
  var close: () -> Void
  var search: () -> Void
  var access: () -> Void
  var contextTool: () -> Void
  var profile: () -> Void

  private var current: Agent { store.agent(agent.id) ?? agent }
  private var status: String {
    if current.status == .busy { return "Working" }
    if current.needsSignIn { return "Needs sign-in" }
    return "Idle"
  }

  var body: some View {
    ScrollView {
      VStack(spacing: 14) {
        VStack(spacing: 6) {
          AgentAvatar(agent: current, size: 64, showStatus: false)
          Text(current.name).font(.system(size: 20, weight: .bold)).foregroundStyle(Palette.text)
          Text([AgentShortList.does(current), status].compactMap { $0 }.joined(separator: " · "))
            .font(.system(size: 14)).foregroundStyle(Palette.muted).multilineTextAlignment(.center).lineLimit(2)
        }
        .padding(.top, 18)
        AgentShortList(agent: current, compact: true)
        CardGroup {
          Button(action: search) { RowLabel(title: "Search in chat", leading: { rowIcon("magnifyingglass") }) }
            .buttonStyle(.plain).accessibilityIdentifier("panel-search")
          Button(action: access) { RowLabel(title: "What it can do", leading: { rowIcon("shield") }) }
            .buttonStyle(.plain).accessibilityIdentifier("panel-access")
          if let context {
            Button(action: contextTool) { RowLabel(title: "How full this chat is", value: "\(Int((context * 100).rounded()))%", leading: { rowIcon("circle.dashed") }) }
              .buttonStyle(.plain).accessibilityIdentifier("panel-context")
          }
        }
        Button(action: profile) {
          HStack(spacing: 4) {
            Text("Full profile").font(.system(size: 15, weight: .semibold))
            Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold))
          }
          .foregroundStyle(Palette.text).padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("panel-profile")
      }
      .padding(.horizontal, 14).padding(.bottom, 30)
    }
    .scrollIndicators(.hidden)
    .task { await AgentShortList.reload(store, current) }
  }
}

/**
 * The panel's pan, in UIKit so it can decline at its start: it only begins on a sideways pull to the
 * left (or either way while the panel is open), so a pull to the right is left to the system's Back,
 * and up-and-down is left to the scroll view.
 */
struct PanelPan: UIGestureRecognizerRepresentable {
  var open: Bool
  var changed: (CGFloat) -> Void
  /** where the pull would have ended, counting its speed */
  var ended: (CGFloat) -> Void

  final class Coordinator: NSObject, UIGestureRecognizerDelegate {
    var open = false
    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
      guard let pan = g as? UIPanGestureRecognizer else { return false }
      let v = pan.velocity(in: pan.view)
      guard abs(v.x) > abs(v.y) * 1.4 else { return false }
      return open || v.x < 0
    }
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
  }

  func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

  func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
    let pan = UIPanGestureRecognizer()
    pan.delegate = context.coordinator
    context.coordinator.open = open
    return pan
  }

  func updateUIGestureRecognizer(_ pan: UIPanGestureRecognizer, context: Context) {
    context.coordinator.open = open
  }

  func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
    let dx = pan.translation(in: pan.view).x
    switch pan.state {
    case .changed: changed(dx)
    case .ended: ended(dx + pan.velocity(in: pan.view).x * 0.2)
    case .cancelled, .failed: ended(0)
    default: break
    }
  }
}
