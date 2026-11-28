import SwiftUI

@main
struct WispApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @AppStorage(ThemeSettings.modeKey, store: WispPreferences.standard) private var mode = ThemeSettings.defaultMode
  private var store: Store { delegate.store }
  @Environment(\.scenePhase) private var scenePhase

  init() { BubbleRefresh.hideSystemSpinner() }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(store)
        .preferredColorScheme(mode == "dark" ? .dark : mode == "light" ? .light : nil)
        .appearance()
        .onAppear { BubbleTouch.install() }
        .onOpenURL { url in
          if let link = PairLink(url.absoluteString) { store.pendingPair = link }
        }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { store.resume(); AppleLocation.shared.appBecameActive(); BubbleTouch.install() }
      if phase == .background { store.updateBadge() }
    }
  }
}

struct RootView: View {
  @Environment(Store.self) private var store
  /** the launch bubble stays over the app until it has hopped and stopped */
  @State private var splash = false
  @ReduceMotion private var reduceMotion

  var body: some View {
    ZStack {
      // the app is built once the bubble has stopped, so building it can't make the whoosh stutter
      if splash { Palette.ground.ignoresSafeArea() } else { phaseView }
      if splash {
        LaunchSplash(loading: store.phase == .loading) {
          withAnimation(Motion.pick(.easeOut(duration: 0.22), reduceMotion)) { splash = false }
        }
        .transition(.opacity)
        .zIndex(1)
      }
    }
    .onChange(of: store.phase, initial: true) { _, phase in
      if phase == .loading { splash = true }
    }
  }

  @ViewBuilder private var phaseView: some View {
    switch store.phase {
    case .signedOut:
      PairView()
    case .loading:
      Palette.ground.ignoresSafeArea()
    case .failed(let msg):
      ContentUnavailableView {
        Label("Can't reach Bubble AI", systemImage: "wifi.exclamationmark")
      } description: {
        Text(msg)
      } actions: {
        Button("Try again") { Task { await store.load() } }.primaryButton()
        Button("Sign out", role: .destructive) { store.signOut() }
      }
    case .ready:
      MainTabs()
        .joinApproval()
        // after the first message: say what notifications are for before the system asks
        .alert("Get a note when an agent finishes or needs you", isPresented: Binding(get: { store.showNotificationPrimer }, set: { store.showNotificationPrimer = $0 })) {
          Button("Turn on") { Task { await store.enableNotifications() } }
          Button("Not now", role: .cancel) {}
        } message: {
          Text("Bubble AI only sends a note when an agent replies, finishes or needs your OK. You can change this in Settings.")
        }
        // a pairing code scanned while signed in: offer to switch to that Bubble AI
        .alert("Pair with another Bubble AI?", isPresented: Binding(get: { store.pendingPair != nil }, set: { if !$0 { store.pendingPair = nil } })) {
          Button("Sign out and pair", role: .destructive) {
            let link = store.pendingPair
            store.signOut()
            store.pendingPair = link
          }
          Button("Cancel", role: .cancel) { store.pendingPair = nil }
        } message: {
          Text("You're signed in to \(store.workspace?.name ?? "a Bubble AI"). Pairing signs you out of it first.")
        }
    }
  }
}

/**
 * Launch and loading: the bubble whooshes in, then works (drifts, bobs, spins) until loading ends. Then it
 * finishes its turn, hops once and stops, and the splash fades to the app. With reduced motion it fades in,
 * stays still and the splash fades out as soon as loading ends.
 */
struct LaunchSplash: View {
  var loading: Bool
  var finished: () -> Void
  @State private var mark = MarkMotion(size: 72)
  @State private var ending = false
  @ReduceMotion private var reduceMotion

  var body: some View {
    MarkView(motion: mark)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Palette.ground.ignoresSafeArea())
      .accessibilityElement()
      .accessibilityLabel("Loading")
      .onAppear {
        mark.launch(reduced: reduceMotion)
        if !loading { end() }
      }
      .task {
        // after the landing and its first blink, it works until loading ends
        try? await Task.sleep(for: .seconds(1.7))
        if loading && !ending { mark.work(reduced: reduceMotion) }
      }
      .onChange(of: loading) { _, now in if !now { end() } }
  }

  private func end() {
    guard !ending else { return }
    ending = true
    mark.finish(reduced: reduceMotion) { finished() }
  }
}

/** The four places on the bottom bar (MainBar.swift): Chats, Computers (hidden for guests), More and Profile. */
enum MainTab: Int, CaseIterable { case chats, computers, more, profile }

struct MainTabs: View {
  @Environment(Store.self) private var store
  @State private var bar = MainBarModel()
  @State private var orgs = false
  /** the first run, over everything, when nobody has made an agent on this Bubble AI yet */
  @State private var onboarding: String?
  /** tabs opened so far: each is built on its first visit and then kept, so it stays where you left it */
  @State private var visited: Set<MainTab> = [.chats]

  var body: some View {
    ZStack {
      ForEach(MainTab.allCases, id: \.self) { t in
        if visited.contains(t) {
          pane(t)
            .tint(Palette.text)
            .opacity(bar.tab == t ? 1 : 0)
            .allowsHitTesting(bar.tab == t)
            .accessibilityHidden(bar.tab != t)
        }
      }
    }
    .environment(bar)
    .tint(Palette.accent)
    .onChange(of: bar.tab, initial: true) { _, t in visited.insert(t) }
    .environment(\.openSettings, SheetOpener(open: { bar.tab = .profile }))
    .environment(\.openOrganizations, SheetOpener(open: { orgs = true }))
    .overlay(alignment: .top) { AppBanners() }
    .sheet(isPresented: $orgs) { OrgSwitcherSheet().environment(store) }
    .fullScreenCover(item: Binding(get: { onboarding.map(OnboardingRun.init) }, set: { onboarding = $0?.id })) { run in
      OnboardingFlow(workspaceId: run.id) { channelId in
        onboarding = nil
        // its hello is waiting in its chat; in Advanced, Show me around follows (SetupTourChat)
        if let channelId {
          SetupTour.begin(channelId: channelId)
          store.route = .chat(channelId: channelId, threadId: nil)
        }
      }
      .environment(store)
    }
    .task(id: store.workspace?.id) { onboarding = store.wantsOnboarding() ? store.workspace?.id : nil }
    // Show me around: the tab its stop is on
    .onChange(of: TourRun.shared.nav) {
      guard TourRun.shared.active, let place = TourRun.shared.place else { return }
      if place.tab != .computers || store.canViewComputers { bar.tab = place.tab }
      orgs = false
    }
    .onChange(of: store.canViewComputers) { _, allowed in
      if !allowed && bar.tab == .computers { bar.tab = .chats }
    }
    .onChange(of: store.unreadTotal, initial: true) { store.updateBadge() }
    // a tapped notification: go to its tab; the tab's own screen opens the chat, computer or approval
    .onChange(of: store.route, initial: true) { _, route in
      if route != nil { orgs = false }
      guard let route else { return }
      if route.tab == .computers && !store.canViewComputers { store.route = nil; return }
      bar.tab = route.tab
    }
  }

  @ViewBuilder private func pane(_ t: MainTab) -> some View {
    switch t {
    case .chats: ChatsView()
    case .computers: if store.canViewComputers { ComputersView() }
    case .more: MoreTab()
    case .profile: SettingsSheet(inTab: true)
    }
  }
}

/** The workspace a first run is for. */
private struct OnboardingRun: Identifiable { var id: String }

extension Route {
  /** the tab that shows this route's screen */
  var tab: MainTab {
    switch self {
    case .chat: .chats
    case .approval, .inbox: .more
    case .computer, .device: .computers
    }
  }
}

/** The tab bar's agent icon: the ghost outline, drawn like the design's line icons. */
enum TabIcons {
  static let ghost: UIImage = {
    let side: CGFloat = 25
    let k = side / 24
    let image = UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { _ in
      let p = UIBezierPath()
      p.move(to: CGPoint(x: 12 * k, y: 2.5 * k))
      p.addArc(withCenter: CGPoint(x: 12 * k, y: 10 * k), radius: 7.5 * k, startAngle: -.pi / 2, endAngle: .pi, clockwise: false)
      p.addLine(to: CGPoint(x: 4.5 * k, y: 21 * k))
      for (x, y) in [(7.0, 19.3), (9.5, 21.0), (12.0, 19.3), (14.5, 21.0), (17.0, 19.3), (19.5, 21.0)] {
        p.addLine(to: CGPoint(x: x * k, y: y * k))
      }
      p.addLine(to: CGPoint(x: 19.5 * k, y: 10 * k))
      p.addArc(withCenter: CGPoint(x: 12 * k, y: 10 * k), radius: 7.5 * k, startAngle: 0, endAngle: -.pi / 2, clockwise: false)
      p.close()
      p.lineWidth = 1.8
      p.lineJoinStyle = .round
      UIColor.black.setStroke()
      p.stroke()
      UIColor.black.setFill()
      UIBezierPath(arcCenter: CGPoint(x: 9.5 * k, y: 10.5 * k), radius: 1.1 * k, startAngle: 0, endAngle: .pi * 2, clockwise: true).fill()
      UIBezierPath(arcCenter: CGPoint(x: 14.5 * k, y: 10.5 * k), radius: 1.1 * k, startAngle: 0, endAngle: .pi * 2, clockwise: true).fill()
    }
    return image.withRenderingMode(.alwaysTemplate)
  }()
}
