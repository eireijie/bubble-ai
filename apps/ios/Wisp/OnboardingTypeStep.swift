import SwiftUI

// The first run's pages after "Which AI app" and before it (2026-11-26 canvas, iPhone board), each
// on the one stage (OnboardingFlow): How it starts (Simple or Advanced, each shown as the same small
// loop as the desktop), Make it yours (what it helps with, how it talks, when it checks in, with the
// message it would send on top so each pick lands), and Connect (only apps that can connect from
// here right now, each with its own sign-in or, for an Apple app on your Mac, Allow).

// MARK: - How it starts

struct OnboardingStartStep: View {
  var name: String
  @Binding var path: SetupPath
  var onNext: () -> Void
  @ReduceMotion private var reduceMotion

  var body: some View {
    ObScreen(top: 64) {
      VStack(spacing: 14) {
        ObSlot(size: 64)
        Text("How should \(name) start?").obTitle()
        VStack(spacing: 12) {
          PathTile(on: path == .simple, title: "Simple", sub: "Chat now", id: "simple") { SimpleLoop() } action: { pick(.simple) }
          PathTile(on: path == .advanced, title: "Advanced", sub: "Goals and apps first", id: "advanced") { AdvancedLoop() } action: { pick(.advanced) }
        }
        .padding(.top, 8)
        .accessibilityElement(children: .contain).accessibilityLabel("How it starts")
      }
    } bottom: {
      Button("Continue", action: onNext).buttonStyle(ObWide()).accessibilityIdentifier("ob-start-next")
    }
  }

  private func pick(_ p: SetupPath) {
    withAnimation(Motion.pick(Motion.pop, reduceMotion)) { path = p }
  }
}

/** A start to pick: its loop on the left, its name and a few words on the right. */
private struct PathTile<Demo: View>: View {
  var on: Bool
  var title: String
  var sub: String
  var id: String
  @ViewBuilder var demo: Demo
  var action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 14) {
        demo
          .frame(width: 136, height: 118)
          .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.field.opacity(0.6)))
          .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
          .accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 2) {
          Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Palette.text)
          Text(sub).font(.system(size: 13)).foregroundStyle(Palette.muted)
        }
        Spacer(minLength: 0)
      }
      .padding(12)
      .obTile(on, radius: 20)
    }
    .buttonStyle(.pressRow)
    .accessibilityLabel("\(title). \(sub)")
    .accessibilityAddTraits(on ? .isSelected : [])
    .accessibilityIdentifier("ob-path-\(id)")
  }
}

/** Simple: a chat that just starts, messages coming in. */
private struct SimpleLoop: View {
  @ReduceMotion private var reduceMotion

  var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { ctx in
      let t = reduceMotion ? 2.5 : ctx.date.timeIntervalSinceReferenceDate
      VStack(alignment: .leading, spacing: 8) {
        msg(t, delay: 0, width: 0.62, me: false)
        msg(t, delay: 0.9, width: 0.5, me: true)
        msg(t, delay: 1.8, width: 0.42, me: false)
      }
      .padding(12)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }

  private func msg(_ t: Double, delay: Double, width: CGFloat, me: Bool) -> some View {
    let k = reduceMotion ? 1 : obEnvelope(t, delay: delay, rise: (0, 0.08), fall: (0.82, 0.92))
    return HStack {
      if me { Spacer(minLength: 0) }
      Capsule().fill(me ? Palette.text.opacity(0.85) : Palette.card)
        .overlay(Capsule().strokeBorder(me ? .clear : Palette.hairline))
        .frame(width: 112 * width, height: 22)
      if !me { Spacer(minLength: 0) }
    }
    .opacity(k).offset(y: (1 - k) * 8)
  }
}

/** Advanced: goals get picked, then the apps they need turn on. */
private struct AdvancedLoop: View {
  @ReduceMotion private var reduceMotion

  var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { ctx in
      let t = reduceMotion ? 4 : ctx.date.timeIntervalSinceReferenceDate
      ZStack(alignment: .topLeading) {
        VStack(alignment: .leading, spacing: 8) {
          pick("Research", t, delay: 0)
          pick("Code", t, delay: 1)
          pick("Email", t, delay: 2)
        }
        VStack(alignment: .trailing, spacing: 8) {
          on("Notion ✓", t, delay: 3)
          on("Linear ✓", t, delay: 3.6)
        }
        // a row down, beside the short goals: the tile is too narrow for "Research" and an app side by side
        .padding(.top, 30)
        .frame(maxWidth: .infinity, alignment: .trailing)
      }
      .padding(10)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }

  private func chip(_ text: String) -> some View {
    Text(text).font(.system(size: 11, weight: .semibold)).foregroundStyle(Palette.text).lineLimit(1)
      .padding(.horizontal, 7).frame(height: 22)
      .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Palette.card))
  }

  private func pick(_ text: String, _ t: Double, delay: Double) -> some View {
    let k = reduceMotion ? 1 : obEnvelope(t, delay: delay, rise: (0, 0.1), fall: (0.85, 0.95))
    return chip(text)
      .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(k > 0.5 ? ObTint.wisp : Palette.hairline, lineWidth: k > 0.5 ? 1.5 : 1))
      .opacity(0.35 + 0.65 * k)
  }

  private func on(_ text: String, _ t: Double, delay: Double) -> some View {
    let k = reduceMotion ? 1 : obEnvelope(t, delay: delay, rise: (0.02, 0.1), fall: (0.8, 0.9))
    return chip(text)
      .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Palette.hairline))
      .opacity(k).offset(x: (1 - k) * 8)
  }
}

// MARK: - Make it yours

struct OnboardingYoursStep: View {
  var name: String
  var person: String
  var look: GhostLook
  @Binding var goals: [String]
  @Binding var about: String
  @Binding var talk: SetupTalk
  @Binding var checkIn: SetupCheckIn
  var busy: Bool
  var onNext: () -> Void
  @FocusState private var aboutFocused: Bool
  @ReduceMotion private var reduceMotion

  private var first: String { OnboardingText.first(person) }
  private var message: String { SetupGoals.sample(goals, talk: talk, when: checkIn, about: about, person: person) }

  /**
   * Make it yours (2026-11-27, round 7, board 6): what it should help with in the person's own words,
   * anything it should know about them, how it talks and when it checks in, and the message it would
   * send them by name, changing as they pick. On Continue the picks go to the agent as their first
   * message and the agent suggests the apps to connect.
   */
  var body: some View {
    ObScreen(top: 56, focus: aboutFocused ? "about" : nil) {
      VStack(spacing: 0) {
        ObSlot(size: 56)
        Text("What should \(name) help with\(first.isEmpty ? "" : ", \(first)")?").obTitle(23)
          .padding(.top, 12)
        Text("Pick anything. You can change it later by just telling \(name).")
          .font(.system(size: 14)).foregroundStyle(Palette.muted).multilineTextAlignment(.center)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 4)

        VStack(spacing: 6) {
          ForEach(SetupGoals.all) { g in
            let on = goals.contains(g.id)
            Button { toggle(g.id) } label: {
              HStack(spacing: 10) {
                Image(systemName: g.symbol).font(.system(size: 16)).foregroundStyle(Palette.text.opacity(0.85)).frame(width: 22)
                Text(g.label).font(.system(size: 14.5, weight: .medium)).foregroundStyle(Palette.text).lineLimit(1).minimumScaleFactor(0.85)
                Spacer(minLength: 6)
                Image(systemName: "checkmark").font(.system(size: 9, weight: .heavy)).foregroundStyle(.white)
                  .frame(width: 18, height: 18).background(Circle().fill(ObTint.wisp))
                  .opacity(on ? 1 : 0)
              }
              .padding(.horizontal, 12).frame(height: 46)
              .obTile(on, radius: 12)
            }
            .buttonStyle(.pressRow)
            .accessibilityLabel(g.label).accessibilityAddTraits(on ? .isSelected : [])
            .accessibilityIdentifier("ob-goal-\(g.id)")
          }
        }
        .padding(.top, 20)
        .animation(Motion.pick(Motion.fade, reduceMotion), value: goals)

        // the example wraps instead of being cut off at phone width
        // the hint wraps instead of being cut short at phone width
        TextField("", text: $about, axis: .vertical)
          .font(.system(size: 15)).foregroundStyle(Palette.text)
          .lineLimit(1...4)
          .background(alignment: .topLeading) {
            if about.isEmpty {
              Text("Anything \(name) should know about you? (I'm a student, I work weekends, I love hiking…)")
                .font(.system(size: 15)).foregroundStyle(Palette.faint)
                .fixedSize(horizontal: false, vertical: true)
                .allowsHitTesting(false).accessibilityHidden(true)
            }
          }
          .frame(minHeight: about.isEmpty ? 40 : nil, alignment: .topLeading)
          .accessibilityLabel("Anything \(name) should know about you?")
          .focused($aboutFocused)
          .submitLabel(.done)
          .onChange(of: about) { _, v in if v.count > 300 { about = String(v.prefix(300)) } }
          .padding(.horizontal, 14).padding(.vertical, 12)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Palette.field))
          .accessibilityLabel("Anything \(name) should know about you?")
          .accessibilityIdentifier("ob-about")
          .id(OnboardingFocus.id)
          .padding(.top, 14)

        VStack(alignment: .leading, spacing: 6) {
          ObLabel(text: "\(name) talks")
          ObSegmented(label: "\(name) talks", options: SetupTalk.allCases.map { ($0, $0.label) }, selection: $talk)
          ObLabel(text: "Checks in").padding(.top, 6)
          ObSegmented(label: "Checks in", options: SetupCheckIn.allCases.map { ($0, $0.label) }, selection: $checkIn)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 14)

        // what it would actually send, changing as you pick
        HStack(alignment: .bottom, spacing: 8) {
          GhostView(look: look, seed: name, size: 30)
          Text(message).font(.system(size: 15)).foregroundStyle(Palette.text)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 4, bottomTrailingRadius: 16, topTrailingRadius: 16, style: .continuous).fill(Palette.card))
            .overlay(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 4, bottomTrailingRadius: 16, topTrailingRadius: 16, style: .continuous).strokeBorder(Palette.hairline))
            .id(message)
            .transition(reduceMotion ? .opacity : .asymmetric(insertion: .scale(scale: 0.96, anchor: .bottomLeading).combined(with: .opacity), removal: .opacity))
          Spacer(minLength: 24)
        }
        .padding(.top, 18)
        .animation(Motion.pick(Motion.soft, reduceMotion), value: message)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(name) would send: \(message)")
        .accessibilityIdentifier("ob-yours-preview")
      }
    } bottom: {
      Button {
        aboutFocused = false
        onNext()
      } label: {
        HStack(spacing: 8) {
          if busy { ProgressView().controlSize(.small).tint(Palette.ground) }
          Text("Continue")
        }
      }
      .buttonStyle(ObWide()).disabled(busy).accessibilityIdentifier("ob-yours-next")
    }
  }

  private func toggle(_ id: String) {
    if let i = goals.firstIndex(of: id) { goals.remove(at: i) } else { goals.append(id) }
  }
}
