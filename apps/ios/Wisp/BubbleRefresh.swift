import SwiftUI
import UIKit

/*
 * Pull to refresh with the Bubble AI mark (canvas "Bubble AI mark motion", Pull to refresh): the bubble grows
 * and turns as you pull, spins while it refreshes, then pops away. Use `.bubbleRefresh { … }` wherever a screen
 * would use `.refreshable`. It is `.refreshable` underneath, so pulling, the threshold and the held gap are the
 * system's; only the spinner is the bubble. The system spinner is made clear once at launch
 * (`BubbleRefresh.hideSystemSpinner`), since SwiftUI gives no way to replace it.
 *
 * The bubble sits at the top of the scroll view that refreshes. Shared screen frames (AgentFrame, SettingsPage,
 * MarketScreen, MemoryScreen) mark their scroll view with `.bubbleRefreshSlot()`; anywhere else the bubble
 * goes on the view `.bubbleRefresh` is on, which is then the List or ScrollView itself.
 */

/** The state one refreshing screen shares with its scroll view. */
@MainActor @Observable
final class BubbleRefreshState {
  let mark = MarkMotion(size: 28)
  /** how far the list is pulled past its top, in points */
  var pull: CGFloat = 0
  /** a finger is on the list */
  var dragging = false
  /** how many scroll views inside show the bubble (`.bubbleRefreshSlot()`); the outer view shows it when none do */
  var slots = 0
}

private struct BubbleRefreshKey: EnvironmentKey {
  static let defaultValue: BubbleRefreshState? = nil
}

extension EnvironmentValues {
  fileprivate var bubbleRefresh: BubbleRefreshState? {
    get { self[BubbleRefreshKey.self] }
    set { self[BubbleRefreshKey.self] = newValue }
  }
}

enum BubbleRefresh {
  /** Clears UIKit's refresh spinner everywhere; the bubble takes its place. Call once at launch. */
  @MainActor static func hideSystemSpinner() {
    UIRefreshControl.appearance().tintColor = .clear
  }
}

extension View {
  /** `.refreshable`, with the bubble as the spinner. */
  func bubbleRefresh(_ action: @escaping @MainActor @Sendable () async -> Void) -> some View {
    modifier(BubbleRefreshModifier(action: action))
  }

  /** On a shared frame's ScrollView: the bubble for a `.bubbleRefresh` around the frame shows here. */
  func bubbleRefreshSlot() -> some View { modifier(BubbleRefreshSlot()) }
}

private struct BubbleRefreshModifier: ViewModifier {
  var action: @MainActor @Sendable () async -> Void
  @State private var state = BubbleRefreshState()
  @ReduceMotion private var reduceMotion

  func body(content: Content) -> some View {
    let state = state, reduced = reduceMotion, action = action
    content
      .environment(\.bubbleRefresh, state)
      .overlay(alignment: .top) { if state.slots == 0 { BubblePuller(state: state) } }
      .refreshable {
        await state.mark.startRefresh(reduced: reduced)
        await action()
        await state.mark.endRefresh(reduced: reduced)
      }
      // reaches the scroll view inside, wherever it is
      .onScrollGeometryChange(for: CGFloat.self) { g in
        max(0, -(g.contentOffset.y + g.contentInsets.top)).rounded()
      } action: { _, v in
        state.pull = v
        state.mark.setPull(v, dragging: state.dragging, reduced: reduced)
      }
      .onScrollPhaseChange { old, phase in
        state.dragging = phase == .interacting
        if phase == .interacting && old != .interacting { state.mark.dragStarted(pull: state.pull) }
        if !state.dragging { state.mark.setPull(state.pull, dragging: false, reduced: reduced) }
      }
  }
}

private struct BubbleRefreshSlot: ViewModifier {
  @Environment(\.bubbleRefresh) private var state

  func body(content: Content) -> some View {
    if let state {
      content
        .overlay(alignment: .top) { BubblePuller(state: state) }
        .onAppear { state.slots += 1 }
        .onDisappear { state.slots -= 1 }
    } else {
      content
    }
  }
}

/** The bubble in the gap a pull opens, centred in it. */
private struct BubblePuller: View {
  var state: BubbleRefreshState

  var body: some View {
    let mark = state.mark
    if state.pull > 0 || mark.running || mark.refreshing {
      MarkView(motion: mark)
        .offset(y: max(6, state.pull / 2 - mark.size / 2))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
  }
}
