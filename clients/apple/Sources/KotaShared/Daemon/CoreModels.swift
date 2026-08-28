import Foundation

struct DaemonControlFile: Codable {
    let port: Int
    let pid: Int
    let startedAt: String
    let token: String
}

enum DaemonHealth {
    case unknown
    case offline
    case connected
    case error(String)

    var systemImageName: String {
        switch self {
        case .unknown: return "circle"
        case .offline: return "circle.slash"
        case .connected: return "checkmark.circle.fill"
        case .error: return "exclamationmark.circle.fill"
        }
    }

    var label: String {
        switch self {
        case .unknown: return "KOTA"
        case .offline: return "Daemon offline"
        case .connected: return "Connected"
        case .error(let message): return "Error: \(message)"
        }
    }
}
