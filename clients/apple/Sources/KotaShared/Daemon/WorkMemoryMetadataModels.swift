import Foundation

func appendWorkMemoryMetadata(
    _ label: String,
    provenance: WorkMemoryProvenance?,
    freshness: WorkMemoryFreshness?
) -> String {
    var parts: [String] = []
    if let provenance {
        parts.append("\(formatProvenanceLocator(provenance)) observed \(String(provenance.observedAt.prefix(10)))")
    }
    if let freshness {
        let replacement = freshness.replacementId.map { " -> \($0)" } ?? ""
        let changed = freshness.changedAt.map { " \(String($0.prefix(10)))" } ?? ""
        parts.append("\(freshness.status.rawValue)\(replacement)\(changed)")
    }
    return parts.isEmpty ? label : "\(label) | \(parts.joined(separator: "; "))"
}

private func formatProvenanceLocator(_ provenance: WorkMemoryProvenance) -> String {
    switch provenance.sourceKind {
    case .run, .session:
        return "\(provenance.sourceKind.rawValue):\(provenance.sourceId ?? "unknown")"
    case .file:
        return "file:\(provenance.sourcePath ?? "unknown")"
    case .url:
        return "url:\(provenance.sourceUrl ?? "unknown")"
    case .tool:
        return "tool:\(provenance.sourceTool ?? provenance.sourceId ?? "unknown")"
    case .manual:
        return "manual"
    }
}
