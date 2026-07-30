import Foundation

// Approval queue items as exposed by `GET /approvals` and the
// approve/reject control routes.

struct ApprovalsResponse: Codable {
    let approvals: [ApprovalRequest]
}

enum ApprovalReview: Codable, Equatable {
    case available(input: [String: JSONValue], context: String? = nil, digest: String)
    case unavailable(reason: String)

    private enum CodingKeys: String, CodingKey {
        case status, input, context, digest, reason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .status) {
        case "available":
            self = .available(
                input: try container.decode([String: JSONValue].self, forKey: .input),
                context: try container.decodeIfPresent(String.self, forKey: .context),
                digest: try container.decode(String.self, forKey: .digest)
            )
        case "unavailable":
            self = .unavailable(reason: try container.decode(String.self, forKey: .reason))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .status,
                in: container,
                debugDescription: "Unknown approval review status"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .available(let input, let context, let digest):
            try container.encode("available", forKey: .status)
            try container.encode(input, forKey: .input)
            try container.encodeIfPresent(context, forKey: .context)
            try container.encode(digest, forKey: .digest)
        case .unavailable(let reason):
            try container.encode("unavailable", forKey: .status)
            try container.encode(reason, forKey: .reason)
        }
    }
}

struct ApprovalRequest: Codable, Identifiable {
    let id: String
    let tool: String
    let risk: String
    let reason: String?
    let createdAt: String
    let status: String
    let review: ApprovalReview

    private enum CodingKeys: String, CodingKey {
        case id, tool, risk, reason, createdAt, status, review
    }

    init(
        id: String,
        tool: String,
        risk: String,
        reason: String?,
        createdAt: String,
        status: String,
        review: ApprovalReview = .unavailable(reason: "input_unavailable")
    ) {
        self.id = id
        self.tool = tool
        self.risk = risk
        self.reason = reason
        self.createdAt = createdAt
        self.status = status
        self.review = review
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        tool = try container.decode(String.self, forKey: .tool)
        risk = try container.decode(String.self, forKey: .risk)
        reason = try container.decodeIfPresent(String.self, forKey: .reason)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        status = try container.decode(String.self, forKey: .status)
        review = try container.decodeIfPresent(ApprovalReview.self, forKey: .review)
            ?? .unavailable(reason: "input_unavailable")
    }

    var reviewIsAvailable: Bool {
        if case .available = review { return true }
        return false
    }

    var reviewDigest: String? {
        if case .available(_, _, let digest) = review { return digest }
        return nil
    }

    var reviewInputText: String? {
        guard case .available(let input, _, _) = review else { return nil }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard
            let data = try? encoder.encode(input),
            let text = String(data: data, encoding: .utf8)
        else { return nil }
        return text
    }

    var reviewContext: String? {
        guard case .available(_, let context, _) = review else { return nil }
        return context
    }

    var riskColor: String {
        switch risk {
        case "dangerous": return "red"
        case "elevated": return "orange"
        default: return "yellow"
        }
    }
}
