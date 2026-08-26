import Foundation

func renderRepoTaskSearchPlain(_ hits: [RepoTaskSearchHit]) -> String {
    guard !hits.isEmpty else { return "" }
    let idWidth = max(hits.map { $0.id.count }.max() ?? 0, 2)
    let stateWidth = max(hits.map { $0.state.rawValue.count }.max() ?? 0, 5)
    let priorityWidth = max(hits.map { $0.priority.count }.max() ?? 0, 4)
    return hits.map { hit in
        let id = hit.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        let state = hit.state.rawValue.padding(toLength: stateWidth, withPad: " ", startingAt: 0)
        let priority = hit.priority.padding(toLength: priorityWidth, withPad: " ", startingAt: 0)
        return "\(id)  \(state)  \(priority)  \(hit.title)"
    }.joined(separator: "\n")
}
