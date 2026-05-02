import Foundation

// Approval queue items as exposed by `GET /approvals` and the
// approve/reject control routes.

struct ApprovalsResponse: Codable {
    let approvals: [ApprovalRequest]
}

struct ApprovalRequest: Codable, Identifiable {
    let id: String
    let tool: String
    let risk: String
    let reason: String?
    let createdAt: String
    let status: String

    // input is arbitrary JSON — skip decoding
    enum CodingKeys: String, CodingKey {
        case id, tool, risk, reason, createdAt, status
    }

    var riskColor: String {
        switch risk {
        case "dangerous": return "red"
        case "elevated": return "orange"
        default: return "yellow"
        }
    }
}
