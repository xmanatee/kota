import Foundation

// Mirror of a single search hit returned by the daemon's
// `GET /tasks/search` route (`src/modules/repo-tasks/routes.ts`).
// Decoding is restricted to the eight fields the shared
// `renderRepoTaskSearchPlain` helper consumes
// (`src/modules/repo-tasks/render.ts` and the `RepoTaskSearchHit` shape
// in `src/core/modules/provider-types.ts`).
struct RepoTaskSearchHit: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let state: String
    let priority: String
    let area: String
    let summary: String
    let updatedAt: String
    let score: Double
}

/// Renders repo-task search hits one-to-one with the shared
/// `renderRepoTaskSearchPlain` helper exported by
/// `src/modules/repo-tasks/render.ts`. An empty result returns the
/// empty string.
func renderRepoTaskSearchPlain(_ hits: [RepoTaskSearchHit]) -> String {
    if hits.isEmpty { return "" }
    let idWidth = max(hits.map { $0.id.count }.max() ?? 0, 2)
    let stateWidth = max(hits.map { $0.state.count }.max() ?? 0, 5)
    let prioWidth = max(hits.map { $0.priority.count }.max() ?? 0, 4)
    return hits.map { hit in
        let id = hit.id.padding(toLength: idWidth, withPad: " ", startingAt: 0)
        let state = hit.state.padding(toLength: stateWidth, withPad: " ", startingAt: 0)
        let priority = hit.priority.padding(toLength: prioWidth, withPad: " ", startingAt: 0)
        return "\(id)  \(state)  \(priority)  \(hit.title)"
    }.joined(separator: "\n")
}

/// Discriminated mirror of the daemon's `GET /tasks/search` response.
/// Strict decode so payload drift fails loudly instead of silently
/// degrading the rendered surface.
enum TasksSearchResponse: Decodable, Equatable {
    case success(tasks: [RepoTaskSearchHit])
    case semanticUnavailable

    private enum CodingKeys: String, CodingKey {
        case ok, tasks, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let ok = try container.decode(Bool.self, forKey: .ok)
        if ok {
            let tasks = try container.decode([RepoTaskSearchHit].self, forKey: .tasks)
            self = .success(tasks: tasks)
            return
        }
        let reason = try container.decode(String.self, forKey: .reason)
        switch reason {
        case "semantic_unavailable":
            self = .semanticUnavailable
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .reason,
                in: container,
                debugDescription: "Unknown tasks search reason: \(reason)"
            )
        }
    }
}
