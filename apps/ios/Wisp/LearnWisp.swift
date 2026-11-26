import SwiftUI

/**
 * Learn Bubble AI (board 11, phone 4): how much of Show me around you've seen, on a ring, with Show me
 * around / Resume / Start again and each chapter. It sits at the top of Settings; Help has a row
 * that starts the same tour. Progress is the hub's (UserPrefs.learn), so it matches the desktop.
 */
struct LearnWispCard: View {
  @Environment(Store.self) private var store

  private var stops: [Tour.Stop] { Tour.stops(guest: store.role == "guest") }
  private var learn: LearnProgress? { store.prefs?.learn }

  var body: some View {
    let seen = Tour.seenCount(learn, stops)
    // one row: the ring, where you are, and a tap carries on from there
    CardGroup {
      Button { start(seen >= stops.count ? 0 : nil) } label: {
        HStack(spacing: 12) {
          LearnRing(seen: seen, total: stops.count, size: 28)
          VStack(alignment: .leading, spacing: 1) {
            Text("Learn Bubble AI").font(.system(size: 15)).foregroundStyle(Palette.text)
            Text(Tour.summary(learn, stops)).font(.system(size: 13)).foregroundStyle(Palette.faint).lineLimit(1)
          }
          Spacer(minLength: 8)
          Text(Tour.resumeLabel(learn, stops)).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.accent)
        }
        .padding(.horizontal, 14).frame(minHeight: 56).contentShape(Rectangle())
      }
      .buttonStyle(.pressRow)
      .accessibilityIdentifier("learn-start")
      .tourTarget("learn-row")
    }
  }

  private func start(_ at: Int?) {
    TourRun.shared.start(store, at: at)
  }
}

/** The ring: a circle that fills as stops are seen. */
struct LearnRing: View {
  var seen: Int
  var total: Int
  var size: CGFloat = 24

  var body: some View {
    let k = CGFloat(seen) / CGFloat(max(1, total))
    ZStack {
      Circle().stroke(Palette.hairline, lineWidth: size / 9)
      Circle().trim(from: 0, to: k).stroke(Palette.mine, style: StrokeStyle(lineWidth: size / 9, lineCap: .round)).rotationEffect(.degrees(-90))
    }
    .padding(size / 18)
    .frame(width: size, height: size)
    .animation(.easeOut(duration: 0.5), value: k)
    .accessibilityHidden(true)
  }
}
