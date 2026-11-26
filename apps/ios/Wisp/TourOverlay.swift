import SwiftUI

/**
 * Show me around, running on the phone (board 11). The person's agent leaves its chat as a bubble
 * and flies on a curve to each stop, trailing small bubbles. When the stop is on another screen,
 * the screen changes under it mid-flight. Where it lands, the real control is cut out of a dimmed
 * screen and a card docked at the bottom (or the top, when the control is low) says what it is:
 * Back, Next, Skip tour, "6 of 25". No card while it flies. Reduce Motion: it fades between stops.
 */
struct TourOverlay: View {
  @Environment(Store.self) private var store
  var window: TourWindow
  private var tour: TourRun { TourRun.shared }

  var body: some View {
    if let run = tour.run {
      Running(run: run, window: window)
    }
  }
}

private let size: CGFloat = 46
private let pad: CGFloat = 6

private struct Flight: Equatable {
  var from: CGPoint
  var control: CGPoint
  var to: CGPoint
  var start: Date
  var seconds: Double
}

private struct Puff: Identifiable {
  let id = UUID()
  var at: CGPoint
  var born: Date
  var drift: CGSize
  var d: CGFloat
}

private struct Running: View {
  @Environment(Store.self) private var store
  @Environment(\.colorScheme) private var scheme
  @ReduceMotion private var reduceMotion
  var run: TourRun.Run
  var window: TourWindow
  private var tour: TourRun { TourRun.shared }

  @State private var spot: CGPoint?
  @State private var flight: Flight?
  @State private var puffs: [Puff] = []
  @State private var bubbleOpacity = 1.0
  @State private var landed = false
  @State private var hole: CGRect?
  @State private var fallback = false
  @State private var dock = Tour.Dock.bottom
  @State private var cardFrame: CGRect = .zero
  @State private var modBusy = false
  @State private var modError: String?
  /** Your turn was already picked before Try it, so it stays picked after */
  @State private var filterBefore: String?
  /** how many messages you had sent in the chat when the Say hi stop landed */
  @State private var sentBefore: Int?
  /** the tap count when the Make another stop landed */
  @State private var tapsBefore = 0
  @AppStorage("wisp.chats.filter", store: WispPreferences.standard) private var chatsFilter = "all"

  private var stops: [Tour.Stop] { run.stops }
  private var stop: Tour.Stop? { run.stop }
  private var agent: Agent? { run.agentId.flatMap { store.agent($0) } ?? store.agents.first }
  private var screen: CGRect { window.bounds }

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .topLeading) {
        dim
        trail
        bubble
        if landed { card(geo) }
      }
      .frame(width: geo.size.width, height: geo.size.height)
    }
    .ignoresSafeArea()
    .task(id: StepKey(i: run.i, end: run.end)) { await arrive() }
    .onChange(of: tour.framesVersion) { follow() }
    .onChange(of: landed) { updatePassThrough() }
    .onChange(of: hole) { updatePassThrough() }
    .onChange(of: cardFrame) { updatePassThrough() }
    // doing the thing finishes the stop: a beat to see the check, then on to the next
    .task(id: DoneKey(i: run.i, done: landed && tried)) {
      guard landed, tried, let stop, !run.end else { return }
      tour.markSeen(stop.id)
      UIAccessibility.post(notification: .announcement, argument: "Done")
      try? await Task.sleep(for: .milliseconds(stop.doIt == .tap ? 450 : 1000))
      if !Task.isCancelled, tour.run?.i == run.i { tour.next() }
    }
    .onAppear { startAtHome() }
    .onDisappear { leaveTryIt(); window.passThrough = nil }
  }

  private struct StepKey: Equatable { var i: Int; var end: Bool }
  private struct DoneKey: Equatable { var i: Int; var done: Bool }

  private func mine(_ channelId: String?) -> Int {
    guard let channelId else { return 0 }
    return (store.messages[channelId] ?? []).filter { $0.author.kind == .user }.count
  }

  // MARK: drawing

  /** The screen dims around the cut-out once the bubble lands; a ring marks the control. */
  @ViewBuilder private var dim: some View {
    let full = CGRect(origin: .zero, size: screen.size)
    let cut = landed && !run.end ? hole : nil
    HoleShape(full: full, hole: cut ?? CGRect(x: spot?.x ?? full.midX, y: spot?.y ?? full.midY, width: 0, height: 0))
      // nothing to point at: the page stays as it is, with the card over it
      .fill(Color.black.opacity(landed && (cut != nil || run.end) ? 0.45 : 0), style: FillStyle(eoFill: true))
      .animation(reduceMotion ? .easeOut(duration: 0.2) : .spring(response: 0.42, dampingFraction: 0.86), value: cut)
      .animation(.easeOut(duration: 0.25), value: landed)
      .allowsHitTesting(false)
    if let cut {
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .strokeBorder(Palette.mine, lineWidth: 3)
        .frame(width: cut.width + 6, height: cut.height + 6)
        .position(x: cut.midX, y: cut.midY)
        .transition(.opacity)
        .allowsHitTesting(false)
    }
  }

  /** Small bubbles left behind on a flight: each drifts up and fades, then is gone. */
  private var trail: some View {
    TimelineView(.animation(paused: puffs.isEmpty || reduceMotion)) { ctx in
      Canvas { g, _ in
        let now = ctx.date
        for p in puffs {
          let age = now.timeIntervalSince(p.born) / 1.4
          guard age >= 0, age < 1 else { continue }
          let o = age < 0.1 ? age / 0.1 * 0.85 : 0.85 * (1 - (age - 0.1) / 0.9)
          let s = 1 + 0.4 * age
          let c = CGPoint(x: p.at.x + p.drift.width * age, y: p.at.y + p.drift.height * age)
          let r = CGRect(x: c.x - p.d * s / 2, y: c.y - p.d * s / 2, width: p.d * s, height: p.d * s)
          g.opacity = o
          g.fill(Circle().path(in: r), with: .color(scheme == .dark ? .white.opacity(0.18) : .white.opacity(0.9)))
          g.stroke(Circle().path(in: r), with: .color(scheme == .dark ? .white.opacity(0.7) : Color(white: 0.11).opacity(0.25)), lineWidth: 1)
        }
      }
    }
    .allowsHitTesting(false)
  }

  private var bubble: some View {
    TimelineView(.animation(paused: flight == nil)) { ctx in
      let p = position(at: ctx.date)
      ZStack {
        Circle().fill(RadialGradient(colors: [Palette.card.opacity(0.85), Palette.card.opacity(0)], center: .center, startRadius: size * 0.3, endRadius: size * 0.62))
          .frame(width: size * 1.2, height: size * 1.2)
        AgentAvatar(agent: agent, size: size, showStatus: false)
      }
      .position(p)
      .opacity(bubbleOpacity)
    }
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }

  private func position(at date: Date) -> CGPoint {
    guard let f = flight else { return spot ?? CGPoint(x: screen.midX, y: screen.height * 0.4) }
    let k = min(1, max(0, date.timeIntervalSince(f.start) / f.seconds))
    return Tour.curvePoint(f.from, f.control, f.to, Tour.easeInOut(CGFloat(k)))
  }

  // MARK: the card

  private func card(_ geo: GeometryProxy) -> some View {
    let top = dock == .top
    let modOff = stop?.mod.map { !store.features[$0] } ?? false
    return VStack(alignment: .leading, spacing: 5) {
      // one dot per stop: done ones full, this one half until it's done
      HStack(spacing: 3) {
        ForEach(stops.indices, id: \.self) { n in
          Capsule().fill(run.end || n < run.i || (n == run.i && tried) ? Palette.mine : n == run.i ? Palette.mine.opacity(0.45) : Palette.hairline)
            .frame(height: 3)
        }
      }
      .animation(.easeOut(duration: 0.3), value: tried)
      .accessibilityHidden(true)
      HStack(spacing: 6) {
        Text(run.end ? "That's it" : stop.map { Tour.title($0, agent: agent?.name) } ?? "").font(.system(size: 17, weight: .bold)).foregroundStyle(Palette.text)
          .accessibilityAddTraits(.isHeader)
        if tried { DrawnCheck(size: 17, color: ok).accessibilityLabel("Done") }
      }
      .padding(.top, 6)
      Text(run.end ? "Show me around stays in Help." : stop.map { Tour.body($0, fallback: fallback) } ?? "")
        .font(.system(size: 15)).lineSpacing(3).foregroundStyle(Palette.muted)
        .fixedSize(horizontal: false, vertical: true)
      if let k = stop?.mod, modOff || store.features[k] { modSwitch(k) }
      HStack(spacing: 6) {
        Text(run.end ? "" : Tour.counter(run.i, stops))
          .font(.system(size: 12)).foregroundStyle(Palette.muted).frame(maxWidth: .infinity, alignment: .leading)
        if !run.end {
          Button("Skip tour") { tour.stop() }
            .font(.system(size: 14)).foregroundStyle(Palette.muted).padding(.horizontal, 8).frame(height: 34)
            .buttonStyle(.press).accessibilityIdentifier("tour-skip")
        }
        Button(run.end ? "Done" : "Next") { tour.next() }
          .font(.system(size: 14, weight: run.end ? .semibold : .medium)).foregroundStyle(run.end ? Palette.ground : Palette.text)
          .padding(.horizontal, 16).frame(height: 34)
          .background(Capsule().fill(run.end ? Palette.text : Palette.sheet).overlay(Capsule().strokeBorder(run.end ? .clear : Palette.hairline)))
          .buttonStyle(.press).accessibilityIdentifier("tour-next")
      }
      .padding(.top, 6)
    }
    .padding(.horizontal, 16).padding(.top, 14).padding(.bottom, 12)
    .frame(maxWidth: 520, alignment: .leading)
    .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(cardFill))
    .shadow(color: .black.opacity(scheme == .dark ? 0.6 : 0.2), radius: 20, y: 12)
    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { cardFrame = $0 }
    .padding(.horizontal, 12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: top ? .top : .bottom)
    .padding(.top, window.safeAreaInsets.top + 6)
    .padding(.bottom, max(window.safeAreaInsets.bottom, 12) + 6)
    .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.96, anchor: top ? .top : .bottom)))
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("tour-card")
  }

  private var cardFill: Color { scheme == .dark ? Color(hex: 0x1F1F1F) : .white }
  private var ok: Color { Color(light: 0x1A7F37, dark: 0x30D158) }

  /** Has the stop's thing been done, for real? */
  private var tried: Bool {
    guard let stop, !run.end else { return false }
    switch stop.doIt {
    case .send: return sentBefore.map { mine(run.homeChannel) > $0 } ?? false
    case .slash: return tour.composerText.hasPrefix("/") || tour.composerText.contains(" /")
    case .yourturn: return chatsFilter == "turn" && filterBefore != "turn"
    case .tap: return tour.holeTaps > tapsBefore
    }
  }

  /** A mod that starts off: the card offers it, and only the owner turns it on. */
  private func modSwitch(_ k: FeatureKey) -> some View {
    let on = store.features[k]
    let owner = store.isOwner
    let name = Self.modName(k)
    return HStack(spacing: 10) {
      VStack(alignment: .leading, spacing: 1) {
        Text("\(name) mod").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.text)
        Text(modError ?? (on ? "On" : owner ? "Off. Turn it on to use it." : "Off. Only the owner can turn it on."))
          .font(.system(size: 12)).foregroundStyle(Palette.muted)
      }
      Spacer(minLength: 8)
      Toggle(isOn: Binding(get: { on }, set: { v in
        var next = store.features
        next[k] = v
        modBusy = true; modError = nil
        Task {
          do { try await store.setFeatures(next) } catch { modError = error.localizedDescription }
          modBusy = false
        }
      })) { Text("\(name) mod") }
        .labelsHidden()
        .tint(Palette.accent)
        .disabled(!owner || modBusy)
    }
    .padding(.horizontal, 12).padding(.vertical, 8)
    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.sheet))
    .padding(.top, 4)
  }

  static func modName(_ k: FeatureKey) -> String {
    switch k {
    case .background: "Background checks"
    case .routines: "Routines"
    case .tasks: "Tasks board"
    default: k.rawValue.capitalized
    }
  }

  // MARK: moving

  private func startAtHome() {
    // it leaves from the chat's bubble, near the top of the screen
    spot = CGPoint(x: screen.midX, y: screen.minY + 110)
  }

  private func updatePassThrough() {
    window.passThrough = landed && !run.end ? hole : nil
    window.card = landed ? cardFrame : .zero
  }

  /** The control moved (scrolled, the keyboard came up): the cut-out and the bubble follow. */
  private func follow() {
    guard landed, let stop, flight == nil, let hit = tour.target(for: stop, screen: screen) else { return }
    let r = cutOut(hit.rect)
    guard r != hole else { return }
    hole = r
    let d = Tour.dock(target: hit.rect, height: screen.height)
    if d != dock { withAnimation(.easeOut(duration: 0.2)) { dock = d } }
    let to = Tour.bubbleSpot(target: hit.rect, dock: d, size: size, screen: screen.size)
    withAnimation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85)) { spot = to }
  }

  /** Each stop: fly to its screen (it changes under the bubble), find the control, fly to it, land. */
  private func arrive() async {
    leaveTryIt()
    withAnimation(.easeOut(duration: 0.15)) { landed = false }
    modError = nil
    guard let stop else {
      // the end: back to the chat, the bubble in the middle
      await fly(to: CGPoint(x: screen.midX, y: screen.height * 0.36)) { tour.show(.chat) }
      guard !Task.isCancelled else { return }
      dock = .bottom
      withAnimation(.easeOut(duration: 0.25)) { landed = true }
      UIAccessibility.post(notification: .screenChanged, argument: "That's Bubble AI")
      return
    }
    let place = placeFor(stop)
    if tour.place != place {
      await fly(to: CGPoint(x: screen.width * 0.55, y: screen.height * 0.42)) { tour.show(place) }
      guard !Task.isCancelled else { return }
    }
    // wait for the control to be on screen (a page sliding in, a list loading)
    var hit = tour.target(for: stop, screen: screen)
    let t0 = Date()
    while (hit == nil || Date().timeIntervalSince(t0) < 0.35) && Date().timeIntervalSince(t0) < 2 {
      try? await Task.sleep(for: .milliseconds(60))
      guard !Task.isCancelled else { return }
      hit = tour.target(for: stop, screen: screen)
    }
    // nothing nearer on screen: no cut-out; the bubble waits mid-screen over the page itself
    fallback = hit == nil || hit!.fallback
    if let rect = hit?.rect {
      let d = Tour.dock(target: rect, height: screen.height)
      dock = d
      hole = cutOut(rect)
      await fly(to: Tour.bubbleSpot(target: rect, dock: d, size: size, screen: screen.size))
    } else {
      dock = .bottom
      hole = nil
      await fly(to: CGPoint(x: screen.midX, y: screen.height * 0.45))
    }
    guard !Task.isCancelled else { return }
    // what's there now, so only what you do from here finishes the stop
    switch stop.doIt {
    case .yourturn:
      filterBefore = chatsFilter
      if chatsFilter == "turn" { chatsFilter = "all"; filterBefore = "all" }
    case .send:
      sentBefore = mine(run.homeChannel)
      // the box is ready to type in
      if let ch = run.homeChannel { tour.type(tour.composerText, in: ch, focus: true) }
    case .slash: break
    case .tap: tapsBefore = tour.holeTaps
    }
    withAnimation(.easeOut(duration: 0.25)) { landed = true }
    tour.markSeen(stop.id)
    UIAccessibility.post(notification: .screenChanged, argument: "\(Tour.title(stop, agent: agent?.name)). \(Tour.body(stop, fallback: fallback))")
  }

  /** The control with a little room around it, kept inside the screen so its ring shows whole. */
  private func cutOut(_ r: CGRect) -> CGRect {
    let inner = screen.insetBy(dx: 5, dy: 5)
    let c = r.insetBy(dx: -pad, dy: -pad).intersection(inner)
    return c.isNull ? r : c
  }

  private func placeFor(_ stop: Tour.Stop) -> Tour.Place {
    switch stop.place {
    case .chat: run.homeChannel == nil ? .chats : .chat
    case .team: tour.teamChannel == nil ? .chats : .team
    default: stop.place
    }
  }

  /** Fly from where the bubble is to `to` on a curve; `mid` runs 42% of the way. */
  private func fly(to: CGPoint, mid: (() -> Void)? = nil) async {
    let from = spot ?? to
    if reduceMotion {
      withAnimation(.easeOut(duration: 0.16)) { bubbleOpacity = 0 }
      try? await Task.sleep(for: .milliseconds(170))
      mid?()
      spot = to
      withAnimation(.easeIn(duration: 0.2)) { bubbleOpacity = 1 }
      try? await Task.sleep(for: .milliseconds(200))
      return
    }
    let seconds = hypot(to.x - from.x, to.y - from.y) < 4 ? 0.2 : Tour.flightSeconds(from, to)
    let f = Flight(from: from, control: Tour.curveControl(from, to), to: to, start: .now, seconds: seconds)
    flight = f
    puff(around: from, spread: size / 2, count: 4)
    var midDone = mid == nil
    let steps = Int(seconds / 0.04)
    for n in 1...max(1, steps) {
      try? await Task.sleep(for: .milliseconds(40))
      if Task.isCancelled { flight = nil; spot = position(at: .now); return }
      let k = Double(n) / Double(steps)
      if !midDone && k > 0.42 { midDone = true; mid?() }
      if k < 0.95 { puff(around: position(at: .now), spread: size * 0.25, count: 1) }
    }
    if !midDone { mid?() }
    flight = nil
    spot = to
    puff(around: to, spread: size / 2, count: 3)
  }

  private func puff(around p: CGPoint, spread: CGFloat, count: Int) {
    guard !reduceMotion else { return }
    let now = Date()
    puffs.removeAll { now.timeIntervalSince($0.born) > 1.4 }
    for _ in 0..<count where puffs.count < 40 {
      let a = Double.random(in: 0..<(2 * .pi))
      puffs.append(Puff(at: CGPoint(x: p.x + cos(a) * spread, y: p.y + sin(a) * spread), born: now,
                        drift: CGSize(width: cos(a) * 14, height: -14 - Double.random(in: 0..<20)), d: CGFloat.random(in: 3...9)))
    }
  }

  /** Leaving a Try it stop puts things back: an untouched "/" or "@" is cleared, Your turn goes back to All. */
  private func leaveTryIt() {
    if let before = filterBefore {
      if before != "turn" && chatsFilter == "turn" { chatsFilter = before }
      filterBefore = nil
    }
    let text = tour.composerText
    if let ch = run.homeChannel, text == "/" || text == "@" { tour.type("", in: ch, focus: false) }
  }
}

/** The whole screen with a rounded hole in it; the hole moves smoothly from one control to the next. */
private struct HoleShape: Shape {
  var full: CGRect
  var hole: CGRect

  var animatableData: AnimatablePair<AnimatablePair<CGFloat, CGFloat>, AnimatablePair<CGFloat, CGFloat>> {
    get { AnimatablePair(AnimatablePair(hole.origin.x, hole.origin.y), AnimatablePair(hole.width, hole.height)) }
    set { hole = CGRect(x: newValue.first.first, y: newValue.first.second, width: newValue.second.first, height: newValue.second.second) }
  }

  func path(in rect: CGRect) -> Path {
    var p = Path(full.isEmpty ? rect : full)
    p.addRoundedRect(in: hole, cornerSize: CGSize(width: 16, height: 16), style: .continuous)
    return p
  }
}
