import SwiftUI

/** Screens a tab's stack can open besides chats, threads and agents. */
enum ChatsScreen: Hashable { case inbox, approval(id: String), note(path: String) }

extension View {
  func chatsScreens() -> some View {
    navigationDestination(for: ChatsScreen.self) { screen in
      switch screen {
      case .inbox: InboxView()
      case .approval(let id): ApprovalDetail(approvalId: id)
      case .note(let path): NoteView(path: path)
      }
    }
  }

  /** The chat, thread and agent pages every tab's stack can reach. */
  func chatDestinations() -> some View {
    navigationDestination(for: Channel.self) { ChannelView(channel: $0) }
      .navigationDestination(for: ThreadRef.self) { ThreadView(ref: $0) }
      .navigationDestination(for: Agent.self) { AgentPage(agent: $0) }
      .chatsScreens()
  }
}
