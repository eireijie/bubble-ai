import PhotosUI
import SwiftUI

/**
 * An agent's chat background, the profile's Background tab (web BackgroundTab, board ProfileSide):
 * None, Photo or Colour as three big circles, the current one ringed. Photo picks a photo, then the
 * preview; Colour opens the preview. Nothing is saved until Set.
 */
struct AgentBackgroundTab: View {
  @Environment(Store.self) private var store
  @Environment(\.colorScheme) private var scheme
  var agent: Agent
  @State private var draft: BackgroundDraft?
  @State private var photoItem: PhotosPickerItem?
  @State private var picking = false
  @State private var busy = false
  @State private var error: String?

  /** its own background; nil while it follows the person's default */
  private var own: ChatBackground? { (store.agent(agent.id) ?? agent).settings?.background?.value }

  var body: some View {
    VStack(spacing: 12) {
      HStack(spacing: 14) {
        option("none", "None") { save(.none) } face: { Circle().fill(Palette.field) }
        option("photo", "Photo") { picking = true } face: { photoFace }
        option("color", "Colour") { openColour() } face: { colourFace }
      }
      .frame(maxWidth: .infinity)
      .accessibilityElement(children: .contain)
      .accessibilityLabel("\(agent.name)'s chat background")
      Text("You see it before it's set.").font(.system(size: 13)).foregroundStyle(Palette.muted)
      if own != nil {
        HStack(spacing: 4) {
          Text("\(agent.name)'s chat only ·").foregroundStyle(Palette.faint)
          Button("Use the default") { save(nil) }.buttonStyle(.plain).foregroundStyle(Palette.muted).underline()
        }
        .font(.system(size: 13))
      }
      if let error { Text(error).font(.system(size: 13)).foregroundStyle(Palette.red) }
    }
    .padding(.top, 6)
    .photosPicker(isPresented: $picking, selection: $photoItem, matching: .images)
    .onChange(of: photoItem) { _, item in if let item { upload(item) } }
    .sheet(item: $draft) { d in
      BackgroundPreviewSheet(agent: store.agent(agent.id) ?? agent, draft: d, anotherPhoto: { draft = nil; picking = true }) { bg in
        try await setBackground(bg)
      }
    }
  }

  private func option<Face: View>(_ kind: String, _ name: String, pick: @escaping () -> Void, @ViewBuilder face: () -> Face) -> some View {
    let on = own?.kind == kind
    return Button(action: pick) {
      VStack(spacing: 7) {
        face()
          .frame(width: 84, height: 84)
          .clipShape(Circle())
          .overlay(Circle().strokeBorder(on ? Palette.text : Palette.hairline, lineWidth: on ? 3 : 1))
          .overlay { if kind == "photo" && busy { ProgressView() } }
        Text(name).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.text)
      }
    }
    .buttonStyle(.press)
    .disabled(busy)
    .accessibilityLabel(name)
    .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
    .accessibilityIdentifier("background-\(kind)")
  }

  @ViewBuilder private var photoFace: some View {
    if case .photo(let url) = own, let img = WallPhotos.shared.image(url, store: store) {
      Image(uiImage: img).resizable().scaledToFill()
    } else {
      ZStack { Palette.card; Image(systemName: "plus").font(.system(size: 22, weight: .regular)).foregroundStyle(Palette.muted) }
    }
  }

  @ViewBuilder private var colourFace: some View {
    if case .color(let hex) = own {
      ChatWallView(background: .color(hex))
    } else {
      AngularGradient(colors: ["#74d0f7", "#a98bf5", "#de7699", "#f4a582", "#f8d97a", "#bfe09a", "#74d0f7"].map(ChatWall.color), center: .center)
    }
  }

  private func openColour() {
    error = nil
    let was: String? = { if case .color(let h) = own { return h.lowercased() } else { return nil } }()
    let pick = was.flatMap { w in BackgroundDraft.swatches.first { $0 == w } } ?? BackgroundDraft.swatches[2]
    draft = BackgroundDraft(kind: .color(pick: pick, shade: was != nil && pick == was ? 50 : BackgroundDraft.shadeStart(dark: scheme == .dark)))
  }

  private func upload(_ item: PhotosPickerItem) {
    error = nil
    busy = true
    Task {
      defer { busy = false; photoItem = nil }
      do {
        guard let data = try await item.loadTransferable(type: Data.self) else { throw BackgroundDraft.Failure.unreadable }
        let up = try await store.uploadFile(data, name: "background.jpg", mime: "image/jpeg")
        draft = BackgroundDraft(kind: .photo(url: "/api/files/\(up.id)"))
      } catch {
        self.error = (error as? BackgroundDraft.Failure)?.text ?? "That photo didn't upload."
      }
    }
  }

  private func save(_ bg: ChatBackground?) {
    error = nil
    Task {
      do { try await setBackground(bg) } catch { self.error = error.localizedDescription }
    }
  }

  private func setBackground(_ bg: ChatBackground?) async throws {
    try await store.updateAgent(agent.id, ["settings": AnyEncodable(["background": OptionalBackground(bg)])])
  }
}

/** What the preview sheet is showing: a swatch moved lighter or deeper, or an uploaded photo. */
struct BackgroundDraft: Identifiable {
  enum Kind { case color(pick: String, shade: Double), photo(url: String) }
  var id = UUID()
  var kind: Kind

  enum Failure: Error {
    case unreadable
    var text: String { "Pick a photo (PNG, JPEG, GIF, WebP)." }
  }

  /** the 18 colours the sheet offers, two rows of nine (web SHEET_SWATCHES) */
  static let swatches = ["#74d0f7", "#7aa0f8", "#a98bf5", "#bf5af2", "#de7699", "#ef8e80", "#f4a582", "#f5c27e", "#f8d97a", "#fff59a", "#eef09a", "#bfe09a", "#b5c4b1", "#a3b8bf", "#b3a7b9", "#bcb5ad", "#ffffff", "#1c1c1c"]
  static let names = ["Sky", "Cornflower", "Lavender", "Violet", "Rose", "Coral", "Apricot", "Honey", "Butter", "Lemon", "Lime", "Sage", "Moss", "Steel", "Heather", "Stone", "White", "Black"]
  /** where the lighter/deeper slider starts: the middle in light mode, toward deep in dark mode */
  static func shadeStart(dark: Bool) -> Double { dark ? 80 : 50 }

  /** a swatch moved lighter or deeper (web shadeColor): 0 toward white, 50 itself, 100 toward black, never all the way */
  static func shade(_ hex: String, _ shade: Double) -> String {
    guard let c = ChatWall.rgb(hex) else { return hex }
    let t = (min(100, max(0, shade)) - 50) / 50
    let to: Double = t < 0 ? 255 : 0
    let k = abs(t) * 0.85
    return ChatWall.hex((c.0 + (to - c.0) * k, c.1 + (to - c.1) * k, c.2 + (to - c.2) * k))
  }

  var background: ChatBackground {
    switch kind {
    case .color(let pick, let shade): .color(Self.shade(pick, shade))
    case .photo(let url): .photo(url)
    }
  }
}

/**
 * Picking a chat background the way a phone does (web PreviewSheet): a chat over the draft, which
 * changes as you pick. Colour: 18 swatches and a lighter/deeper slider. Photo: the photo, and
 * Choose another photo… Nothing is saved until Set.
 */
struct BackgroundPreviewSheet: View {
  @Environment(\.dismiss) private var dismiss
  var agent: Agent
  @State var draft: BackgroundDraft
  var anotherPhoto: () -> Void
  var set: (ChatBackground) async throws -> Void
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    ZStack {
      ChatWallView(background: draft.background)
      VStack(spacing: 0) {
        VStack(spacing: 4) {
          AgentAvatar(agent: agent, size: 46, showStatus: false)
          Text(agent.name).font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.text)
            .padding(.horizontal, 12).padding(.vertical, 3).glassCapsule()
        }
        .padding(.top, 18)
        VStack(spacing: 10) {
          bubble("Can you move my dentist appointment?", me: true)
          bubble("Sure. Tuesday 3pm or Thursday 10am?", me: false)
          bubble("Thursday", me: true)
        }
        .padding(.horizontal, 18)
        .frame(maxHeight: .infinity)
        .accessibilityHidden(true)
        controls
          .padding(12)
          .glass(18)
          .padding(.horizontal, 12).padding(.bottom, 12)
      }
    }
    .presentationDetents([.large])
    .presentationCornerRadius(Corner.sheet)
    .accessibilityLabel("Preview \(agent.name)'s background")
  }

  private func bubble(_ text: String, me: Bool) -> some View {
    Text(text).font(.system(size: 15)).foregroundStyle(me ? Palette.mineInk : Palette.text)
      .padding(.horizontal, 14).padding(.vertical, 8)
      .background(RoundedRectangle(cornerRadius: 19, style: .continuous).fill(me ? Palette.mine : Color(light: 0xFFFFFF, lightAlpha: 0.82, dark: 0xFFFFFF, darkAlpha: 0.13)))
      .frame(maxWidth: 280, alignment: me ? .trailing : .leading)
      .frame(maxWidth: .infinity, alignment: me ? .trailing : .leading)
  }

  @ViewBuilder private var controls: some View {
    VStack(spacing: 12) {
      if case .color(let pick, let shade) = draft.kind {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 9), spacing: 8) {
          ForEach(Array(BackgroundDraft.swatches.enumerated()), id: \.offset) { i, hex in
            let on = hex == pick
            Button {
              draft.kind = .color(pick: hex, shade: BackgroundDraft.shadeStart(dark: false))
            } label: {
              ChatWallView(background: .color(hex))
                .frame(width: 30, height: 30).clipShape(Circle())
                .overlay(Circle().strokeBorder(on ? Palette.text : Palette.hairline, lineWidth: 2))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(BackgroundDraft.names[i])
            .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
          }
        }
        Slider(value: Binding(get: { shade }, set: { draft.kind = .color(pick: pick, shade: $0) }), in: 0...100)
          .tint(ChatWall.color(BackgroundDraft.shade(pick, shade)))
          .accessibilityLabel("Lighter or deeper")
      } else {
        Button { dismiss(); anotherPhoto() } label: {
          Text("Choose another photo…").font(.system(size: 14)).foregroundStyle(Palette.text)
            .frame(maxWidth: .infinity).frame(height: 38)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Palette.control.opacity(0.85)))
        }.buttonStyle(.plain)
      }
      if let error { Text(error).font(.system(size: 13)).foregroundStyle(Palette.red).frame(maxWidth: .infinity, alignment: .leading) }
      HStack(spacing: 8) {
        Spacer()
        Button { dismiss() } label: {
          Text("Cancel").font(.system(size: 14)).foregroundStyle(Palette.text)
            .padding(.horizontal, 18).frame(height: 36).background(Capsule().fill(Palette.text.opacity(0.1)))
        }.buttonStyle(.plain).accessibilityIdentifier("background-cancel")
        Button {
          busy = true; error = nil
          Task {
            do { try await set(draft.background); dismiss() } catch { self.error = "That didn't save." }
            busy = false
          }
        } label: {
          HStack(spacing: 6) {
            if busy { ProgressView().controlSize(.small).tint(Palette.sheet) }
            Text("Set").font(.system(size: 14, weight: .semibold))
          }
          .foregroundStyle(Palette.sheet)
          .padding(.horizontal, 22).frame(height: 36).background(Capsule().fill(Palette.text))
        }.buttonStyle(.plain).disabled(busy).accessibilityIdentifier("background-set")
      }
    }
  }
}
