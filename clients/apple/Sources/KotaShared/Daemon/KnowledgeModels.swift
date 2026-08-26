import Foundation

func renderKnowledgeSearchPlain(_ entries: [KnowledgeEntry]) -> String {
    let idWidth = max(entries.map { $0.id.count }.max() ?? 0, 2)
    let typeWidth = max(entries.map { $0.type.count }.max() ?? 0, 4)
    let statusWidth = max(entries.map { $0.status.count }.max() ?? 0, 6)
    return entries.map { entry in
        let id = entry.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        let type = entry.type.padding(toLength: typeWidth, withPad: " ", startingAt: 0)
        let status = entry.status.padding(toLength: statusWidth, withPad: " ", startingAt: 0)
        return "\(id)  \(type)  \(status)  \(entry.title)"
    }.joined(separator: "\n")
}
