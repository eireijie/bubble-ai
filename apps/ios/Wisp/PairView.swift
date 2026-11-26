import SwiftUI
import AVFoundation
import VisionKit

/**
 * Signed out: the welcome screen, then connect to Bubble AI on your computer by scanning the QR code in
 * Settings → Computers → Phone (or typing its link). A code scanned with the Camera app skips the welcome.
 */
struct PairView: View {
  @Environment(Store.self) private var store
  @State private var step: Step = .start
  @State private var scanning = false
  @State private var pasting = false
  /** "Type a link" on the scanner: open the sheet once the scanner has gone */
  @State private var typeAfterScan = false
  @State private var last: PairLink?
  @State private var work: Task<Void, Never>?

  enum Step: Equatable {
    case start
    case connecting
    case code(String, workspace: String?)
    /** the computer said no, or the code ran out */
    case denied(String)
    /** couldn't reach the computer, or the code wasn't a Bubble AI one */
    case failed(String, unreachable: Bool)
  }

  var body: some View {
    Group {
      switch step {
      case .start: start
      case .connecting: connecting
      case .code(let code, let workspace): check(code, workspace: workspace)
      case .denied(let message): denied(message)
      case .failed(let message, let unreachable): failed(message, unreachable: unreachable)
      }
    }
    .fullScreenCover(isPresented: $scanning, onDismiss: {
      if typeAfterScan { typeAfterScan = false; pasting = true }
    }) {
      ScannerScreen(found: { text in
        scanning = false
        use(text)
      }, failed: { message in
        scanning = false
        step = .failed(message, unreachable: false)
      }, typeLink: {
        typeAfterScan = true
        scanning = false
      }, close: { scanning = false })
    }
    .sheet(isPresented: $pasting) {
      TypeLinkSheet(connect: { link in
        pasting = false
        pair(link)
      }, close: { pasting = false })
    }
    // a code scanned with the Camera app opens Bubble AI with the link
    .onChange(of: store.pendingPair, initial: true) { _, link in
      guard let link else { return }
      store.pendingPair = nil
      pair(link)
    }
    .onDisappear { work?.cancel() }
  }

  // MARK: the screens

  private var start: some View {
    WelcomeView(hasCamera: QRScanner.available, message: store.sessionMessage, running: !scanning,
                scan: { scanning = true }, typeLink: { pasting = true })
      .ignoresSafeArea(.keyboard)
  }

  private var connecting: some View {
    AuthPage(back: ("xmark", "Cancel", cancel)) {
      VStack(spacing: 22) {
        AuthHero(title: "Finding your computer", subtitle: "Looking on this Wi-Fi. Bubble AI needs to be running on it.")
        ProgressView().controlSize(.large)
      }
      .padding(.top, 44)
    } bottom: {
      AuthButton(title: "Cancel", primary: false, action: cancel)
    }
  }

  private func check(_ code: String, workspace: String?) -> some View {
    AuthPage(back: ("xmark", "Cancel", cancel)) {
      VStack(spacing: 18) {
        AuthHero(title: "Check the code", subtitle: "Your computer should show this same code. If it does, click Yes, pair it there.")
        CodeCard(code: code).padding(.top, 6)
        WaitingLine(text: "Waiting for you to confirm in \(workspace ?? "Bubble AI") on your computer…")
      }
      .padding(.top, 44)
    } bottom: {
      AuthButton(title: "That isn't the code", primary: false, id: "pair-wrong-code", action: cancel)
    }
  }

  private func denied(_ message: String) -> some View {
    AuthPage {
      AuthHero(title: "Not approved", subtitle: message)
        .padding(.top, 70)
    } bottom: {
      // a code the computer turned down is used up: ask for a new one
      AuthButton(title: "Try again", id: "pair-retry", action: cancel)
      AuthLinkButton(title: "Use a different link") {
        cancel()
        pasting = true
      }
    }
  }

  private func failed(_ message: String, unreachable: Bool) -> some View {
    AuthPage {
      AuthHero(title: unreachable ? "Can't reach your Bubble AI" : "That didn't work", subtitle: message)
        .padding(.top, 70)
    } bottom: {
      AuthButton(title: "Try again", id: "pair-retry", action: retry)
      AuthLinkButton(title: "Scan a different code", action: cancel)
    }
  }

  // MARK: pairing

  private func use(_ text: String) {
    guard let link = PairLink(text) else {
      step = .failed("That isn't a Bubble AI pairing code. Scan the code in Bubble AI → Settings → Computers → Phone.", unreachable: false)
      return
    }
    pair(link)
  }

  private func pair(_ link: PairLink) {
    work?.cancel()
    last = link
    step = .connecting
    work = Task {
      do {
        guard let hub = await Pairing.reachable(link.addresses) else {
          throw Pairing.Failure(message: "Check that your computer is on and Bubble AI is running, and that this phone is on the same Wi-Fi. If you're away from home, Away from home needs to be on.", unreachable: true)
        }
        let claimed = try await Pairing.claim(link, at: hub)
        step = .code(claimed.code, workspace: claimed.workspaceName)
        let token = try await Pairing.waitForConfirm(link, at: hub)
        try await store.adopt(hub: hub, token: token)
      } catch is CancellationError {
      } catch let failure as Pairing.Failure {
        step = failure.denied ? .denied(failure.message) : .failed(failure.message, unreachable: failure.unreachable)
      } catch {
        step = .failed(error.localizedDescription, unreachable: false)
      }
    }
  }

  /** Ask again with the same code; one that has run out needs a new one from the computer. */
  private func retry() {
    if let last { pair(last) } else { step = .start }
  }

  private func cancel() {
    work?.cancel()
    step = .start
  }
}

/** One corner of the viewfinder. */
private struct ScannerCorner: Shape {
  var radius: CGFloat = 22
  func path(in rect: CGRect) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: rect.minX, y: rect.maxY))
    p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
    p.addQuadCurve(to: CGPoint(x: rect.minX + radius, y: rect.minY), control: CGPoint(x: rect.minX, y: rect.minY))
    p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
    return p
  }
}

/**
 * The scanner, full screen: the camera with our own controls over it (canvas "Phone welcome"). When it
 * finds a pairing code the corners close in and turn violet, then pairing starts.
 */
private struct ScannerScreen: View {
  var found: (String) -> Void
  var failed: (String) -> Void
  var typeLink: () -> Void
  var close: () -> Void
  @State private var locked = false
  @State private var torch = false
  @ReduceMotion private var reduceMotion

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()
      QRScanner(found: { text in
        guard !locked else { return }
        withAnimation(Motion.pick(.spring(response: 0.32, dampingFraction: 0.75), reduceMotion)) { locked = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { found(text) }
      }, failed: failed)
      .ignoresSafeArea()
      VStack(spacing: 0) {
        HStack {
          CircleButton(symbol: "xmark", label: "Close", tint: .white, action: close)
          Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        Spacer(minLength: 24)
        Text("Scan the code")
          .font(.system(size: 22, weight: .semibold))
          .tracking(-0.2)
          .foregroundStyle(.white)
          .accessibilityAddTraits(.isHeader)
        viewfinder.padding(.top, 56)
        Text("On your computer: Bubble AI → Settings → Computers → Phone")
          .font(.system(size: 15))
          .foregroundStyle(.white.opacity(0.78))
          .multilineTextAlignment(.center)
          .lineSpacing(3)
          .padding(.horizontal, 40)
          .padding(.top, 28)
        Spacer(minLength: 24)
        HStack {
          if QRScanner.hasTorch {
            CircleButton(symbol: torch ? "flashlight.on.fill" : "flashlight.off.fill", label: torch ? "Turn the light off" : "Turn the light on", size: 48, tint: .white) {
              torch.toggle()
              QRScanner.torch(torch)
            }
          } else {
            Color.clear.frame(width: 48, height: 48)
          }
          Spacer()
          Button(action: typeLink) {
            HStack(spacing: 8) {
              Image(systemName: "link").font(.system(size: 15, weight: .medium))
              Text("Type a link").font(.system(size: 16, weight: .medium))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 20)
            .frame(height: 48)
            .glassCapsule()
          }
          .buttonStyle(.press)
          .accessibilityIdentifier("scan-type-link")
          Spacer()
          Color.clear.frame(width: 48, height: 48)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 12)
      }
    }
    .environment(\.colorScheme, .dark)
    .onDisappear { if torch { QRScanner.torch(false) } }
  }

  /** Four corners around where the code goes; they close in and turn violet on a code. */
  private var viewfinder: some View {
    ZStack {
      ForEach(0..<4, id: \.self) { i in
        ScannerCorner()
          .stroke(locked ? Color(hex: "#a98bf5") : .white, style: StrokeStyle(lineWidth: 4, lineCap: .round))
          .frame(width: 46, height: 46)
          .rotationEffect(.degrees(Double(i) * 90))
          .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: [.topLeading, .topTrailing, .bottomTrailing, .bottomLeading][i])
      }
    }
    .frame(width: 244, height: 244)
    .scaleEffect(locked && !reduceMotion ? 0.78 : 1)
    .accessibilityHidden(true)
  }
}

/**
 * "Type a link": one field, the system Paste button (no "allow paste" question) and Connect. The field
 * is checked as it's typed: a pairing link says where it will try first, anything else says why not
 * under the field, and Connect waits for a link that works.
 */
private struct TypeLinkSheet: View {
  var connect: (PairLink) -> Void
  var close: () -> Void
  @State private var text = ""
  @State private var height: CGFloat = 320
  @FocusState private var focused: Bool

  private static let sheet = Color(light: 0xFFFFFF, dark: 0x1C1C1E)
  private static let field = Color(light: 0xF2F2F4, dark: 0x2A2A2D)
  private static let fieldLine = Color(light: 0xE2E1E6, dark: 0x38383C)
  private static let muted = Color(light: 0x6B6A70, dark: 0x9A99A0)
  private static let green = Color(hex: "#2fb37a")

  private var check: PairLink.Check { PairLink.check(text) }
  private var link: PairLink? { if case .ok(let link) = check { link } else { nil } }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .center) {
        Text("Type a link")
          .font(.system(size: 24, weight: .semibold))
          .tracking(-0.5)
          .foregroundStyle(Palette.text)
          .accessibilityAddTraits(.isHeader)
        Spacer()
        CircleButton(symbol: "xmark", label: "Close", size: 34, tint: Self.muted, action: close)
      }
      Text("On your computer: Settings → Computers → Phone → Copy pairing link.")
        .font(.system(size: 15))
        .foregroundStyle(Self.muted)
        .lineSpacing(3)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 6)
      HStack(spacing: 10) {
        TextField(text: $text, prompt: Text(verbatim: "wisp://pair?…")) { Text("Pairing link") }
          .font(.system(size: 15, design: .monospaced))
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .keyboardType(.URL)
          .submitLabel(.go)
          .focused($focused)
          .onSubmit { if let link { connect(link) } }
          .accessibilityIdentifier("pair-link-field")
        PasteButton(payloadType: String.self) { strings in
          // a link inside a pasted message: keep just the link
          let pasted = strings.first ?? ""
          let clean = PairLink.find(in: pasted) ?? pasted.trimmingCharacters(in: .whitespacesAndNewlines)
          DispatchQueue.main.async { text = clean }
        }
        .labelStyle(.titleAndIcon)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .tint(Palette.text)
      }
      .padding(.leading, 16)
      .padding(.trailing, 8)
      .frame(height: 56)
      .background(Self.field, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(link != nil ? Palette.accent : Self.fieldLine, lineWidth: 1.5))
      .padding(.top, 18)
      status
        .padding(.top, 10)
        .frame(minHeight: 20, alignment: .topLeading)
      Button {
        if let link { connect(link) }
      } label: {
        Text("Connect")
          .font(.system(size: 17, weight: .semibold))
          .foregroundStyle(WelcomeInk.buttonText)
          .frame(maxWidth: .infinity, minHeight: 54)
          .background(Capsule().fill(WelcomeInk.button))
          .contentShape(Capsule())
      }
      .buttonStyle(.press)
      .disabled(link == nil)
      .opacity(link == nil ? 0.38 : 1)
      .accessibilityIdentifier("pair-connect")
      .padding(.top, 18)
    }
    .padding(.horizontal, 22)
    .padding(.top, 22)
    .padding(.bottom, 16)
    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
    .frame(maxHeight: .infinity, alignment: .top)
    .background(Self.sheet.ignoresSafeArea())
    .presentationDetents([.height(height)])
    .presentationDragIndicator(.visible)
    .presentationCornerRadius(30)
    .onAppear { focused = true }
  }

  /** Under the field: where it will try, or why it can't use what's there. */
  @ViewBuilder private var status: some View {
    switch check {
    case .ok(let link):
      HStack(spacing: 8) {
        Image(systemName: "checkmark")
          .font(.system(size: 10, weight: .bold))
          .foregroundStyle(.white)
          .frame(width: 18, height: 18)
          .background(Circle().fill(Self.green))
        let more = link.addresses.count - 1
        Group {
          if more > 0 {
            Text("Will try \(Text(verbatim: link.firstPlace).fontWeight(.semibold).foregroundStyle(Palette.text)) and \(more) more")
          } else {
            Text("Will try \(Text(verbatim: link.firstPlace).fontWeight(.semibold).foregroundStyle(Palette.text))")
          }
        }
        .lineLimit(1)
        .truncationMode(.middle)
      }
      .font(.system(size: 14))
      .foregroundStyle(Self.muted)
      .accessibilityIdentifier("pair-link-ok")
    case .incomplete:
      line("Part of the link is missing. Copy it again from Settings → Computers → Phone.", color: Self.muted)
    case .address:
      line("That's your computer's address. Pairing needs the whole link, which has a one-time code in it.", color: Palette.red)
    case .wrong:
      line("That isn't a pairing link. Copy it again from Settings → Computers → Phone.", color: Palette.red)
    case .empty, .typing:
      EmptyView()
    }
  }

  private func line(_ text: String, color: Color) -> some View {
    Text(text)
      .font(.system(size: 14))
      .foregroundStyle(color)
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityIdentifier("pair-link-error")
  }
}

/** The camera, reading QR codes (VisionKit's live scanner). */
struct QRScanner: UIViewControllerRepresentable {
  var found: (String) -> Void
  var failed: (String) -> Void

  @MainActor static var available: Bool { DataScannerViewController.isSupported && DataScannerViewController.isAvailable }

  @MainActor static var hasTorch: Bool { AVCaptureDevice.default(for: .video)?.hasTorch == true }

  /** Turns the camera's light on or off while scanning. */
  @MainActor static func torch(_ on: Bool) {
    guard let device = AVCaptureDevice.default(for: .video), device.hasTorch, (try? device.lockForConfiguration()) != nil else { return }
    device.torchMode = on ? .on : .off
    device.unlockForConfiguration()
  }

  func makeUIViewController(context: Context) -> DataScannerViewController {
    let vc = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, isHighlightingEnabled: false)
    vc.delegate = context.coordinator
    do { try vc.startScanning() }
    catch {
      // Report after presentation so the pairing screen can dismiss the scanner and show the error.
      Task { @MainActor in failed("Couldn't start the camera. Check camera access in Settings, or type a link.") }
    }
    return vc
  }

  func updateUIViewController(_ vc: DataScannerViewController, context: Context) {}

  func makeCoordinator() -> Coordinator { Coordinator(found: found, failed: failed) }

  final class Coordinator: NSObject, DataScannerViewControllerDelegate {
    let found: (String) -> Void
    let failed: (String) -> Void
    private var done = false
    init(found: @escaping (String) -> Void, failed: @escaping (String) -> Void) { self.found = found; self.failed = failed }

    func dataScanner(_ scanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
      guard !done else { return }
      done = true
      scanner.stopScanning()
      failed("Couldn't use the camera. Check camera access in Settings, or type a link.")
    }

    func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
      guard !done else { return }
      for case .barcode(let code) in items {
        guard let text = code.payloadStringValue, PairLink(text) != nil else { continue }
        done = true
        scanner.stopScanning()
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        found(text)
        return
      }
    }
  }
}
