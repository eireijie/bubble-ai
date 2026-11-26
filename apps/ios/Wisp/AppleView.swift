import CoreLocation
import MapKit
import SwiftUI

/**
 * More → Apple (PhoneApple.dc.html): where Location comes from and what this iPhone allows, the
 * places it watches, the Mac that answers for Messages, what agents may do in each app, and
 * which agents. Owners change it; members can look (and still allow location on their phone).
 */
struct AppleView: View {
  @Environment(Store.self) private var store
  @Environment(\.openURL) private var openURL
  @ReduceMotion private var reduceMotion
  private var location = AppleLocation.shared
  @State private var error: String?
  @State private var loaded = false
  @State private var retried = 0
  @State private var editing: ApplePlace?
  @State private var adding = false

  private var info: AppleInfo? { store.apple }
  private var owner: Bool { store.isOwner }
  private var animation: Animation { Motion.pick(Motion.settle, reduceMotion) }

  var body: some View {
    MarketScreen(title: "Apple", screenId: "apple") {
      if !owner { MarketNote(text: "Only owners can change these. You can see how they're set.") }
      if let info {
        locationSection(info)
        if info.settings.levels.location == 2 {
          placesSection(info).transition(.opacity)
        }
        messagesSection(info)
        appsSection(info)
        agentsSection(info)
      } else if !loaded {
        ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
      }
      if let error { Text(error).font(.footnote).foregroundStyle(Palette.red).padding(.horizontal, 4) }
    }
    .animation(animation, value: info)
    .animation(animation, value: location.authorization)
    .sheet(isPresented: $adding) { PlaceSheet(place: nil) { save(places: (info?.settings.places ?? []) + [$0]) } }
    .sheet(item: $editing) { p in
      PlaceSheet(place: p, onRemove: { remove(p) }) { changed in
        save(places: (info?.settings.places ?? []).map { $0.id == changed.id ? changed : $0 })
      }
    }
    .task { await load() }
    .bubbleRefresh { await load() }
  }

  // MARK: Location

  @ViewBuilder private func locationSection(_ info: AppleInfo) -> some View {
    let level = info.settings.levels.location
    VStack(alignment: .leading, spacing: 6) {
      MarketLabel("Location")
      CardGroup {
        levelMenu(.location, level: level) {
          AppleRowFace(title: "Share with agents", value: AppleApp.location.level(level), menu: owner) { AppleIcon(app: .location) }
        }
        .accessibilityIdentifier("apple-location-level")
        permissionRow
      }
      if level >= 1 && location.authorization == .notDetermined {
        caption("Agents can only ask once you allow location on this iPhone.")
      }
    }
  }

  @ViewBuilder private var permissionRow: some View {
    HStack(spacing: 12) {
      Text("iPhone permission").font(.system(size: 15)).foregroundStyle(Palette.text)
      Spacer(minLength: 8)
      switch location.authorization {
      case .authorizedAlways:
        Label { Text("Always") } icon: { Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold)) }
          .font(.system(size: 15)).foregroundStyle(Palette.statusOnlineText)
      case .authorizedWhenInUse:
        Text("While using").font(.system(size: 15)).foregroundStyle(Palette.faint)
      case .notDetermined:
        Button("Allow") { location.askWhenInUse() }
          .font(.system(size: 15, weight: .medium)).foregroundStyle(MarketColor.blueText).buttonStyle(.plain)
          .accessibilityIdentifier("apple-allow-location")
      default:
        Button { openSettings() } label: {
          HStack(spacing: 4) { Text("Off"); Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .semibold)) }
        }
        .font(.system(size: 15)).foregroundStyle(MarketColor.warn).buttonStyle(.plain)
        .accessibilityLabel("Off. Open Settings")
      }
    }
    .padding(.horizontal, 14).frame(minHeight: 50)
    .accessibilityElement(children: .combine)
  }

  // MARK: Places

  @ViewBuilder private func placesSection(_ info: AppleInfo) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      MarketLabel("Places")
      CardGroup {
        ForEach(info.settings.places) { p in
          SwipeToDelete(enabled: owner, label: "Remove \(p.name)", onTap: owner ? { editing = p } : nil, onDelete: { remove(p) }) {
            HStack(spacing: 12) {
              Image(systemName: p.symbol).font(.system(size: 17)).foregroundStyle(Palette.text).frame(width: 29)
              VStack(alignment: .leading, spacing: 2) {
                Text(p.name).font(.system(size: 15)).foregroundStyle(Palette.text).lineLimit(1)
                Text(p.watching).font(.system(size: 13)).foregroundStyle(Palette.faint)
              }
              Spacer(minLength: 8)
              if owner { Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.faint) }
            }
            .padding(.horizontal, 14).padding(.vertical, 9).frame(minHeight: 56)
          }
          .transition(.opacity)
        }
        if owner && info.settings.places.count < 20 {
          Button { adding = true } label: {
            Label { Text("Add place") } icon: { Image(systemName: "plus").font(.system(size: 16, weight: .medium)).frame(width: 29) }
              .font(.system(size: 15)).foregroundStyle(MarketColor.blueText)
              .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading).padding(.horizontal, 14)
              .contentShape(Rectangle())
          }
          .buttonStyle(.pressRow)
          .accessibilityIdentifier("apple-add-place")
        } else if info.settings.places.isEmpty {
          AppleRowFace(title: "No places yet") { EmptyView() }
        }
      }
      if location.authorization != .authorizedAlways && location.authorization != .notDetermined {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Text("To notice when you arrive or leave, Bubble AI needs Location set to Always.").font(.system(size: 13)).foregroundStyle(MarketColor.warn)
          Spacer(minLength: 4)
          Button(canAskAlways ? "Allow" : "Settings") { canAskAlways ? askAlways() : openSettings() }
            .font(.system(size: 13, weight: .semibold)).foregroundStyle(MarketColor.blueText).buttonStyle(.plain)
            .accessibilityIdentifier("apple-allow-always")
        }
        .padding(.horizontal, 4)
      }
      caption("Agents hear when you arrive or leave, never where you are in between.")
    }
  }

  /** iOS shows the Always prompt only once; after that it's in Settings */
  private var canAskAlways: Bool {
    location.authorization == .notDetermined || (location.authorization == .authorizedWhenInUse && !WispPreferences.standard.bool(forKey: "wisp.apple.askedAlways"))
  }

  private func askAlways() {
    WispPreferences.standard.set(true, forKey: "wisp.apple.askedAlways")
    location.askAlways()
  }

  // MARK: Messages

  @ViewBuilder private func messagesSection(_ info: AppleInfo) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      MarketLabel("Messages")
      CardGroup {
        if info.macs.count > 1 && owner {
          Menu {
            Picker("Mac", selection: Binding(get: { info.mac?.nodeId ?? "" }, set: { save(AppleSettingsPatch(macNodeId: $0)) })) {
              ForEach(info.macs) { m in Text(m.name).tag(m.nodeId) }
            }
          } label: { macRow(info) }
          .accessibilityIdentifier("apple-mac")
        } else {
          macRow(info)
        }
      }
      if let problem = messagesProblem(info) {
        Text(problem).font(.system(size: 13)).foregroundStyle(MarketColor.warn).padding(.horizontal, 4).fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("apple-messages-problem")
      }
      caption("Apple only lets a Mac read and send Messages.")
    }
  }

  /** what Messages still needs on the Mac, once the Mac is online and Messages is on */
  private func messagesProblem(_ info: AppleInfo) -> String? {
    guard let mac = info.mac, mac.online, info.settings.levels[.messages] > 0 else { return nil }
    return mac.status?.problem(for: .messages, mac: mac.name)
  }

  private func macRow(_ info: AppleInfo) -> some View {
    HStack(spacing: 12) {
      AppleIcon(app: .messages)
      if let mac = info.mac {
        Text("Through \(mac.name)").font(.system(size: 15)).foregroundStyle(Palette.text).lineLimit(1)
        Spacer(minLength: 8)
        HStack(spacing: 6) {
          Circle().fill(mac.online ? Palette.statusOnline : Palette.statusOffline).frame(width: 7, height: 7)
          Text(!mac.online ? "Offline" : messagesProblem(info) != nil ? "Needs permission" : "Connected")
        }
        .font(.system(size: 15)).foregroundStyle(!mac.online ? Palette.statusOfflineText : messagesProblem(info) != nil ? MarketColor.warn : Palette.statusOnlineText)
      } else {
        VStack(alignment: .leading, spacing: 2) {
          Text(info.macs.isEmpty ? "No Mac yet" : "Pick a Mac").font(.system(size: 15)).foregroundStyle(Palette.text)
          Text(info.macs.isEmpty ? "Run Bubble AI on a Mac that joined this hub" : "\(info.macs.count) Macs joined this hub").font(.system(size: 13)).foregroundStyle(Palette.faint)
        }
        Spacer(minLength: 8)
      }
      if info.macs.count > 1 && owner { Image(systemName: "chevron.up.chevron.down").font(.system(size: 12)).foregroundStyle(Palette.faint) }
    }
    .padding(.horizontal, 14).frame(minHeight: 50)
    .contentShape(Rectangle())
  }

  // MARK: What agents can do

  @ViewBuilder private func appsSection(_ info: AppleInfo) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      MarketLabel("What agents can do")
      CardGroup {
        ForEach(AppleApp.mac) { app in
          let level = info.settings.levels[app]
          let problem = level > 0 ? info.mac?.status?.problem(for: app, mac: info.mac?.name) : nil
          levelMenu(app, level: level) {
            AppleRowFace(title: app.name, subtitle: problem, warn: problem != nil, value: app.level(level), menu: owner) { AppleIcon(app: app) }
          }
          .accessibilityIdentifier("apple-level-\(app.rawValue)")
        }
      }
      caption("Sending a text, or adding or changing an event or reminder, always asks you first.")
    }
  }

  private func levelMenu<Face: View>(_ app: AppleApp, level: Int, @ViewBuilder face: () -> Face) -> some View {
    Menu {
      Picker(app.name, selection: Binding(get: { level }, set: { setLevel(app, $0) })) {
        ForEach(0..<3, id: \.self) { n in Text(app.level(n)).tag(n) }
      }
    } label: { face() }
    .disabled(!owner)
    .accessibilityLabel("\(app.name): \(app.level(level))")
  }

  // MARK: Agents

  @ViewBuilder private func agentsSection(_ info: AppleInfo) -> some View {
    let s = info.settings
    VStack(alignment: .leading, spacing: 6) {
      MarketLabel("Agents")
      AgentAccessPicker(
        allAgents: Binding(get: { s.allAgents }, set: { save(AppleSettingsPatch(allAgents: $0)) }),
        isOn: { agent in Binding(get: { s.agentIds.contains(agent.id) }, set: { on in
          save(AppleSettingsPatch(agentIds: on ? s.agentIds + [agent.id] : s.agentIds.filter { $0 != agent.id }))
        }) },
        subtitle: { agent in info.agents.first { $0.id == agent.id }?.role ?? "@\(agent.handle)" },
        disabled: !owner
      )
    }
  }

  // MARK: saving

  private func caption(_ text: String) -> some View {
    Text(text).font(.system(size: 13)).foregroundStyle(Palette.faint).padding(.horizontal, 4).fixedSize(horizontal: false, vertical: true)
  }

  private func load() async {
    do {
      let next: AppleInfo = try await store.fetch { try await $0.get("/api/apple") }
      store.apple = next
      AppleLocation.shared.sync(next)
      error = nil
    } catch is Store.Stale {
    } catch {
      self.error = error.localizedDescription
    }
    loaded = true
  }

  private func setLevel(_ app: AppleApp, _ n: Int) {
    save(AppleSettingsPatch(levels: [app.rawValue: n]))
    guard app == .location else { return }
    // While Using first; Always only once places are on
    if n >= 1 && location.authorization == .notDetermined { location.askWhenInUse() }
    else if n == 2 && location.authorization == .authorizedWhenInUse && canAskAlways { askAlways() }
  }

  private func remove(_ p: ApplePlace) {
    save(places: (info?.settings.places ?? []).filter { $0.id != p.id })
  }

  private func save(places: [ApplePlace]) {
    save(AppleSettingsPatch(places: places))
    if !places.isEmpty && location.authorization == .authorizedWhenInUse && canAskAlways { askAlways() }
  }

  /** Shows the change at once, then keeps what the hub says (or puts it back if saving failed). */
  private func save(_ patch: AppleSettingsPatch) {
    guard owner, var next = store.apple else { return }
    if let id = patch.macNodeId { next.settings.macNodeId = id }
    for (key, n) in patch.levels ?? [:] { if let app = AppleApp(rawValue: key) { next.settings.levels[app] = n } }
    if let all = patch.allAgents { next.settings.allAgents = all }
    if let ids = patch.agentIds { next.settings.agentIds = ids }
    if let places = patch.places { next.settings.places = places }
    let before = store.apple
    withAnimation(animation) { store.apple = next }
    Task {
      do { try await store.saveApple(patch); error = nil }
      catch is Store.Stale {}
      catch {
        withAnimation(animation) { store.apple = before }
        self.error = error.localizedDescription
      }
    }
  }

  private func openSettings() {
    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
  }
}

/** A compact settings row: icon, title (and a line under it), a value, and a menu or push hint. */
private struct AppleRowFace<Leading: View>: View {
  var title: String
  var subtitle: String? = nil
  var warn = false
  var value: String? = nil
  /** opens a menu of choices */
  var menu = false
  @ViewBuilder var leading: Leading

  var body: some View {
    HStack(spacing: 12) {
      leading
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.system(size: 15)).foregroundStyle(Palette.text).lineLimit(1).fixedSize()
        if let subtitle { Text(subtitle).font(.system(size: 13)).foregroundStyle(warn ? MarketColor.warn : Palette.faint).multilineTextAlignment(.leading).lineLimit(2).fixedSize(horizontal: false, vertical: true) }
      }
      Spacer(minLength: 8)
      if let value { Text(value).font(.system(size: 15)).foregroundStyle(Palette.faint).lineLimit(1).fixedSize().contentTransition(.opacity) }
      if menu { Image(systemName: "chevron.up.chevron.down").font(.system(size: 12)).foregroundStyle(Palette.faint) }
    }
    .padding(.horizontal, 14).padding(.vertical, subtitle == nil ? 0 : 8)
    .frame(minHeight: 50)
    .contentShape(Rectangle())
  }
}

/** A card row that slides left to show Delete, like a list row (also in its menu and for VoiceOver). */
struct SwipeToDelete<Content: View>: View {
  var enabled: Bool
  var label = "Delete"
  /** a tap on the row (a tap, not a Button: a Button would also fire at the end of a swipe) */
  var onTap: (() -> Void)?
  var onDelete: () -> Void
  @ViewBuilder var content: Content
  @ReduceMotion private var reduceMotion
  @State private var offset: CGFloat = 0
  @State private var open = false
  /** a sideways drag is under way: the row underneath mustn't take it as a tap */
  @State private var swiping = false
  private let reveal: CGFloat = 88

  var body: some View {
    ZStack(alignment: .trailing) {
      if offset < 0 {
        Button(role: .destructive) { close(); onDelete() } label: {
          Text("Delete").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
            .frame(width: max(-offset, 0)).frame(maxHeight: .infinity).lineLimit(1).fixedSize(horizontal: true, vertical: false)
            .frame(width: max(-offset, 0))
            .background(Palette.red)
        }
        .buttonStyle(.plain)
      }
      content
        .background(Palette.card)
        .contentShape(Rectangle())
        .onTapGesture { if open { close() } else if !swiping { onTap?() } }
        .accessibilityAddTraits(onTap == nil ? [] : .isButton)
        .accessibilityAction { onTap?() }
        .offset(x: offset)
        .simultaneousGesture(enabled ? drag : nil)
    }
    .clipped()
    .contextMenu { if enabled { Button(label, systemImage: "trash", role: .destructive, action: onDelete) } }
    .accessibilityAction(named: label) { if enabled { onDelete() } }
  }

  private var drag: some Gesture {
    DragGesture(minimumDistance: 18)
      .onChanged { v in
        guard abs(v.translation.width) > abs(v.translation.height) else { return }
        swiping = true
        offset = min(0, v.translation.width + (open ? -reveal : 0))
      }
      .onEnded { v in
        // let the lifted finger's tap pass first, so it isn't read as opening the row
        if swiping { DispatchQueue.main.async { swiping = false } }
        let past = offset < -reveal * 2.4 || v.predictedEndTranslation.width < -320
        if past { close(); onDelete(); return }
        withAnimation(Motion.pick(Motion.settle, reduceMotion)) {
          open = offset < -reveal / 2
          offset = open ? -reveal : 0
        }
      }
  }

  private func close() {
    withAnimation(Motion.pick(Motion.settle, reduceMotion)) { open = false; offset = 0 }
  }
}

// MARK: adding or changing a place

/** Add place (or change one): a name, where it is (here, or a search), how big, and which crossings to tell agents about. */
private struct PlaceSheet: View {
  @Environment(\.dismiss) private var dismiss
  var place: ApplePlace?
  var onRemove: (() -> Void)? = nil
  var onSave: (ApplePlace) -> Void

  @State private var name = ""
  @State private var center: CLLocationCoordinate2D?
  @State private var whereText: String?
  @State private var radius: Double = 250
  @State private var arrive = true
  @State private var leave = true
  @State private var query = ""
  @State private var results: [Found] = []
  @State private var searching = false
  @State private var locating = false
  @State private var note: String?
  @State private var camera: MapCameraPosition = .automatic
  @FocusState private var typing: Bool

  struct Found: Identifiable, Hashable {
    var id: String { "\(title)|\(latitude)|\(longitude)" }
    var title: String
    var subtitle: String
    var latitude: Double
    var longitude: Double
  }

  private var ready: Bool { !name.trimmed.isEmpty && center != nil && (arrive || leave) }

  var body: some View {
    MarketSheet(title: place == nil ? "Add place" : place!.name) {
      MarketField(label: "Name", placeholder: "Home", text: $name)

      MarketLabel("Where")
      CardGroup {
        Button { useHere() } label: {
          HStack(spacing: 12) {
            Image(systemName: "location.fill").font(.system(size: 15)).foregroundStyle(MarketColor.blueText).frame(width: 24)
            Text("Use where I am now").font(.system(size: 15)).foregroundStyle(MarketColor.blueText)
            Spacer(minLength: 8)
            if locating { ProgressView() }
          }
          .padding(.horizontal, 14).frame(minHeight: 48).contentShape(Rectangle())
        }
        .buttonStyle(.pressRow)
        .disabled(locating)
        .accessibilityIdentifier("place-here")
        HStack(spacing: 12) {
          Image(systemName: "magnifyingglass").font(.system(size: 15)).foregroundStyle(Palette.faint).frame(width: 24)
          TextField("Search for an address or place", text: $query).font(.system(size: 15)).autocorrectionDisabled().submitLabel(.search).focused($typing)
          if searching { ProgressView() }
        }
        .padding(.horizontal, 14).frame(minHeight: 48)
        ForEach(results) { r in
          Button { pick(r) } label: {
            VStack(alignment: .leading, spacing: 2) {
              Text(r.title).font(.system(size: 15)).foregroundStyle(Palette.text).lineLimit(1)
              if !r.subtitle.isEmpty { Text(r.subtitle).font(.system(size: 13)).foregroundStyle(Palette.faint).lineLimit(1) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 50).padding(.trailing, 14).padding(.vertical, 8).contentShape(Rectangle())
          }
          .buttonStyle(.pressRow)
        }
      }
      if let note { Text(note).font(.system(size: 13)).foregroundStyle(MarketColor.warn).padding(.horizontal, 4) }

      if let center {
        VStack(alignment: .leading, spacing: 6) {
          Map(position: $camera, interactionModes: []) {
            MapCircle(center: center, radius: radius).foregroundStyle(Palette.blue.opacity(0.18)).stroke(Palette.blue, lineWidth: 1.5)
          }
          .frame(height: 150)
          .clipShape(RoundedRectangle(cornerRadius: Corner.card, style: .continuous))
          .overlay(RoundedRectangle(cornerRadius: Corner.card, style: .continuous).strokeBorder(Palette.cardBorder))
          .accessibilityHidden(true)
          if let whereText { Text(whereText).font(.system(size: 13)).foregroundStyle(Palette.faint).padding(.horizontal, 4).lineLimit(2) }
        }
        .transition(.opacity)
      }

      MarketLabel("Size")
      SegPicker(options: [(100.0, "100 m"), (250.0, "250 m"), (500.0, "500 m")], selection: $radius)

      MarketLabel("Tell agents when you")
      CardGroup {
        ToggleRow(title: "Arrive", isOn: $arrive, id: "place-arrive")
        ToggleRow(title: "Leave", isOn: $leave, id: "place-leave")
      }

      MarketPrimaryButton(title: place == nil ? "Add place" : "Save", disabled: !ready) { save() }
        .accessibilityIdentifier("place-save")
        .padding(.top, 4)
      if let onRemove {
        CardGroup {
          Button(role: .destructive) { dismiss(); onRemove() } label: {
            Text("Remove place").font(.system(size: 15)).foregroundStyle(Palette.red).frame(maxWidth: .infinity, minHeight: 48)
          }
          .buttonStyle(.plain)
        }
      }
    }
    .animation(.easeOut(duration: 0.16), value: center?.latitude)
    .onAppear {
      guard let place else { return }
      name = place.name; radius = [100.0, 250, 500].min { abs($0 - place.radius) < abs($1 - place.radius) } ?? 250
      arrive = place.arrive; leave = place.leave
      setCenter(CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude), label: nil)
    }
    .onChange(of: radius) { if let center { setCenter(center, label: whereText) } }
    .task(id: query) { await search() }
  }

  private func setCenter(_ c: CLLocationCoordinate2D, label: String?) {
    center = c
    whereText = label
    camera = .region(MKCoordinateRegion(center: c, latitudinalMeters: radius * 3.2, longitudinalMeters: radius * 3.2))
  }

  private func useHere() {
    locating = true; note = nil; typing = false
    Task {
      defer { locating = false }
      guard let fix = await AppleLocation.shared.currentFix() else {
        note = AppleLocation.shared.allowed ? "Couldn't find where you are. Try again, or search." : "Allow location for Bubble AI in Settings, or search instead."
        return
      }
      setCenter(fix.coordinate, label: "Where you are now")
      if name.trimmed.isEmpty { name = "Home" }
    }
  }

  private func pick(_ r: Found) {
    setCenter(CLLocationCoordinate2D(latitude: r.latitude, longitude: r.longitude), label: [r.title, r.subtitle].filter { !$0.isEmpty }.joined(separator: ", "))
    if name.trimmed.isEmpty { name = r.title }
    query = ""
    results = []
    typing = false
  }

  private func search() async {
    let q = query.trimmed
    guard q.count >= 3 else { results = []; return }
    try? await Task.sleep(for: .milliseconds(350))
    guard !Task.isCancelled else { return }
    searching = true
    defer { searching = false }
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = q
    if let here = AppleLocation.shared.lastKnown { request.region = MKCoordinateRegion(center: here, latitudinalMeters: 50_000, longitudinalMeters: 50_000) }
    guard let response = try? await MKLocalSearch(request: request).start(), !Task.isCancelled else { return }
    results = response.mapItems.prefix(5).map { item in
      let c: CLLocationCoordinate2D
      let line: String
      if #available(iOS 26, *) {
        c = item.location.coordinate
        line = item.address?.shortAddress ?? ""
      } else {
        c = item.placemark.coordinate
        line = item.placemark.title ?? ""
      }
      return Found(title: item.name ?? line, subtitle: line == item.name ? "" : line, latitude: c.latitude, longitude: c.longitude)
    }
  }

  private func save() {
    guard let center else { return }
    let p = ApplePlace(id: place?.id ?? ApplePlace.newId(), name: String(name.trimmed.prefix(60)), latitude: center.latitude, longitude: center.longitude, radius: radius, arrive: arrive, leave: leave)
    dismiss()
    onSave(p)
  }
}
