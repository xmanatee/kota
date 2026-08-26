import Foundation

func renderMemorySearchPlain(_ entries: [MemoryEntry]) -> String {
    let idWidth = max(entries.map { $0.id.count }.max() ?? 0, 2)
    return entries.map { entry in
        let id = entry.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        let rawDate = String(entry.created.prefix(16)).replacingOccurrences(of: "T", with: " ")
        let date = rawDate.padding(toLength: 16, withPad: " ", startingAt: 0)
        let snippet = String(entry.content.replacingOccurrences(of: "\n", with: " ").prefix(60))
        return "\(id)  \(date)  \(snippet)"
    }.joined(separator: "\n")
}
