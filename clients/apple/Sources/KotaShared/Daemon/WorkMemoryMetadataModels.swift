import Foundation

struct WorkMemoryProvenance: Decodable, Equatable {
    let sourceKind: String
    let observedAt: String
    let sourceId: String?
    let sourcePath: String?
    let sourceUrl: String?
    let sourceTool: String?
    let note: String?

    private enum CodingKeys: String, CodingKey {
        case sourceKind, observedAt, sourceId, sourcePath, sourceUrl, sourceTool, note
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let sourceKind = try container.decode(String.self, forKey: .sourceKind)
        switch sourceKind {
        case "run", "session", "file", "url", "tool", "manual":
            self.sourceKind = sourceKind
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .sourceKind,
                in: container,
                debugDescription: "Unknown work-memory source kind: \(sourceKind)"
            )
        }
        self.observedAt = try container.decode(String.self, forKey: .observedAt)
        self.sourceId = try container.decodeIfPresent(String.self, forKey: .sourceId)
        self.sourcePath = try container.decodeIfPresent(String.self, forKey: .sourcePath)
        self.sourceUrl = try container.decodeIfPresent(String.self, forKey: .sourceUrl)
        self.sourceTool = try container.decodeIfPresent(String.self, forKey: .sourceTool)
        self.note = try container.decodeIfPresent(String.self, forKey: .note)
    }
}

struct WorkMemoryFreshness: Decodable, Equatable {
    let status: String
    let changedAt: String?
    let note: String?
    let replacementId: String?

    private enum CodingKeys: String, CodingKey {
        case status, changedAt, note, replacementId
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let status = try container.decode(String.self, forKey: .status)
        switch status {
        case "current", "stale", "superseded", "retracted":
            self.status = status
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .status,
                in: container,
                debugDescription: "Unknown work-memory freshness status: \(status)"
            )
        }
        self.changedAt = try container.decodeIfPresent(String.self, forKey: .changedAt)
        self.note = try container.decodeIfPresent(String.self, forKey: .note)
        self.replacementId = try container.decodeIfPresent(String.self, forKey: .replacementId)
    }
}

func appendWorkMemoryMetadata(
    _ label: String,
    provenance: WorkMemoryProvenance?,
    freshness: WorkMemoryFreshness?
) -> String {
    let metadata = formatWorkMemoryMetadata(provenance: provenance, freshness: freshness)
    return metadata.isEmpty ? label : "\(label) | \(metadata)"
}

private func formatWorkMemoryMetadata(
    provenance: WorkMemoryProvenance?,
    freshness: WorkMemoryFreshness?
) -> String {
    var parts: [String] = []
    if let provenance {
        parts.append("\(formatProvenanceLocator(provenance)) observed \(formatIsoDate(provenance.observedAt))")
    }
    if let freshness {
        let replacement = freshness.replacementId.map { " -> \($0)" } ?? ""
        let changed = freshness.changedAt.map { " \(formatIsoDate($0))" } ?? ""
        parts.append("\(freshness.status)\(replacement)\(changed)")
    }
    return parts.joined(separator: "; ")
}

private func formatProvenanceLocator(_ provenance: WorkMemoryProvenance) -> String {
    switch provenance.sourceKind {
    case "run", "session":
        return "\(provenance.sourceKind):\(provenance.sourceId ?? "unknown")"
    case "file":
        return "file:\(provenance.sourcePath ?? "unknown")"
    case "url":
        return "url:\(provenance.sourceUrl ?? "unknown")"
    case "tool":
        return "tool:\(provenance.sourceTool ?? provenance.sourceId ?? "unknown")"
    case "manual":
        return "manual"
    default:
        return provenance.sourceKind
    }
}

private func formatIsoDate(_ value: String) -> String {
    String(value.prefix(10))
}
