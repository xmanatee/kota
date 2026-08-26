import Foundation

func renderHistorySearchPlain(_ conversations: [ConversationRecord]) -> String {
    let idWidth = max(conversations.map { $0.id.count }.max() ?? 0, 2)
    return conversations.map { conversation in
        let id = conversation.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        let rawDate = String(conversation.updatedAt.prefix(16)).replacingOccurrences(of: "T", with: " ")
        let date = rawDate.padding(toLength: 16, withPad: " ", startingAt: 0)
        let count = String(Int(conversation.messageCount))
        let paddedCount = String(repeating: " ", count: max(0, 4 - count.count)) + count
        return "\(id)  \(date)  \(paddedCount) msgs  \(conversation.title)"
    }.joined(separator: "\n")
}
