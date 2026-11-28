import Foundation

/** The names and explanations used by Bubble AI's web app. */
struct HarnessChoice: Identifiable {
  var id: String
  var label: String
  var blurb: String
  var account: String
  var protocolName: String

  static let all: [HarnessChoice] = [
    HarnessChoice(id: "claude-code", label: "Claude Code", blurb: "Made by Anthropic, the company behind Claude.", account: "Needs a Claude subscription (Pro or Max) or an Anthropic API key, signed in on the device.", protocolName: "native"),
    HarnessChoice(id: "codex", label: "Codex", blurb: "Made by OpenAI, the company behind ChatGPT.", account: "Needs a ChatGPT account (Plus or higher) or an OpenAI API key, signed in on the device.", protocolName: "native"),
    HarnessChoice(id: "hermes", label: "Hermes", blurb: "Made by Nous Research. An open-source agent with its own skills.", account: "Use an account from an AI provider you choose. Bubble AI connects it for you.", protocolName: "acp"),
    HarnessChoice(id: "gemini", label: "Gemini CLI", blurb: "Made by Google. Works with Gemini models.", account: "Sign in with a Google account. There is a free tier.", protocolName: "acp"),
    HarnessChoice(id: "opencode", label: "OpenCode", blurb: "An open-source agent that works with many AI models.", account: "Use an account from an AI provider you choose.", protocolName: "acp"),
    HarnessChoice(id: "goose", label: "Goose", blurb: "Made by Block. An open-source agent that works with many AI models.", account: "Use an account from an AI provider you choose.", protocolName: "acp"),
    HarnessChoice(id: "kimi", label: "Kimi CLI", blurb: "Made by Moonshot AI. Works with Kimi models.", account: "Needs a Moonshot (Kimi) account, signed in on the device.", protocolName: "acp"),
    HarnessChoice(id: "qwen", label: "Qwen Code", blurb: "Made by Alibaba. Works with Qwen models.", account: "Sign in with the account Qwen Code asks for on the device.", protocolName: "acp"),
    HarnessChoice(id: "cursor", label: "Cursor", blurb: "Made by Cursor, the code editor company.", account: "Needs a Cursor account, signed in on the device.", protocolName: "acp"),
    HarnessChoice(id: "openclaw", label: "OpenClaw", blurb: "An open-source assistant that runs through its own gateway.", account: "Set up and sign in inside OpenClaw first; its gateway must be running.", protocolName: "acp"),
    HarnessChoice(id: "grok", label: "Grok", blurb: "Made by xAI. Works with Grok models.", account: "Set up where it already runs. It connects to Bubble AI through wisp-mcp.", protocolName: "mcp"),
    HarnessChoice(id: "custom", label: "Custom", blurb: "Your own agent, or one Bubble AI doesn't list.", account: "Set up where it already runs. It connects to Bubble AI through the API or wisp-mcp.", protocolName: "mcp")
  ]

  /// Harnesses Bubble AI installs on a person's own device with one tap: npm packages, and Hermes
  /// with its official installer pinned to a release in the device's code (HARNESSES[].install).
  static let oneTapInstall = ["claude-code", "codex", "hermes", "gemini", "opencode", "kimi", "qwen", "openclaw"]
  /// Harnesses with their own installer, which takes longer (Python and its packages) than npm.
  static func usesInstaller(_ id: String) -> Bool { id == "hermes" }

  static func label(_ id: String) -> String {
    all.first { $0.id == id }?.label ?? id.replacingOccurrences(of: "acp:", with: "")
  }
}
