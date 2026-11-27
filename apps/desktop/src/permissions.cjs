// What this computer lets Bubble AI do for agents: the macOS permissions the first run asks for
// (Screen Recording, Accessibility, Microphone, Notifications), and turning the screen on for agents
// once they're allowed. Windows and Linux need none of these; their screen just turns on.

/** @typedef {"granted" | "denied" | "not-determined" | "restricted" | "unknown"} Status */

const IDS = ["screen", "accessibility", "microphone", "notifications"];

/** System Settings › Privacy & Security, pane by pane. */
const PANE = {
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  notifications: "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=ai.bubbleai.desktop",
};

/**
 * Where each permission stands. macOS has no way to read the notifications answer, so it counts as
 * allowed once Bubble AI asked (the first notification is when macOS asks).
 * @param {{ platform: string, systemPreferences: any, notificationsAsked?: boolean }} o
 * @returns {Record<string, Status>}
 */
function permissionStatus({ platform, systemPreferences, notificationsAsked }) {
  if (platform !== "darwin") return Object.fromEntries(IDS.map((id) => [id, "granted"]));
  const media = (kind) => {
    try {
      return systemPreferences.getMediaAccessStatus(kind) || "unknown";
    } catch {
      return "unknown";
    }
  };
  return {
    screen: media("screen"),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "not-determined",
    microphone: media("microphone"),
    notifications: notificationsAsked ? "granted" : "not-determined",
  };
}

/**
 * Should this computer's screen turn on for agents now? Only when nobody chose at the device yet
 * (the tray's "Let Me Use This Screen" writes shareScreen either way), and on a Mac only once agents
 * can see it and use the mouse and keyboard.
 */
function screenShouldTurnOn({ platform, node, perms }) {
  if (node.shareScreen !== undefined || node.noScreen) return false;
  return platform !== "darwin" || (perms.screen === "granted" && perms.accessibility === "granted");
}

/**
 * The Allow button: macOS's own prompt where there is one, else the right pane of System Settings
 * (macOS asks once; after that only the switch there changes the answer).
 * @returns {Promise<"asked" | "opened">}
 */
async function requestPermission(id, { platform, systemPreferences, shell, desktopCapturer, notify, asked = new Set() }) {
  if (platform !== "darwin" || !IDS.includes(id)) return "asked";
  // a second click: macOS won't ask again, so the switch in System Settings it is
  const first = !asked.has(id);
  asked.add(id);
  if (id === "microphone") {
    if (systemPreferences.getMediaAccessStatus("microphone") === "not-determined") {
      await systemPreferences.askForMediaAccess("microphone");
      return "asked";
    }
  } else if (id === "accessibility") {
    // prompts the first time ("Bubble AI would like to control this computer") and lists the app in the pane
    if (systemPreferences.isTrustedAccessibilityClient(first)) return "asked";
    if (first) return "asked";
  } else if (id === "screen") {
    // looking at the screen once is what makes macOS ask, and puts Bubble AI in the list
    if (first && systemPreferences.getMediaAccessStatus("screen") !== "granted") {
      await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } }).catch(() => []);
      if (systemPreferences.getMediaAccessStatus("screen") !== "denied") return "asked";
    }
  } else if (id === "notifications") {
    notify("Notifications are on", "You'll hear here when an agent needs you.");
    return "asked";
  }
  await shell.openExternal(PANE[id]);
  return "opened";
}

module.exports = { IDS, PANE, permissionStatus, screenShouldTurnOn, requestPermission };
