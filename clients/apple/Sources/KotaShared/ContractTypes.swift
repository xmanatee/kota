import Foundation

// MARK: - Thin-client contract decoders
//
// Codable mirrors of the daemon's typed thin-client contract. Every shape
// here matches a TypeScript source of truth one-to-one so the macOS menu
// bar speaks the same protocol as `kota-client.ts`, the web dashboard, and
// the CLI. The shared JSON fixture under
// `clients/conformance/contract-fixture.json` is exercised against these
// decoders in `ContractFixtureTests`, so any payload drift fails this
// suite alongside the TypeScript and web suites — see
// `clients/AGENTS.md` for the migration matrix.

// MARK: Capability readiness

/// Mirror of the daemon's `CapabilityStatus` union
/// (`src/core/daemon/capability-readiness.ts`). Strict decode so an
/// unknown status fails loudly instead of silently falling through.
enum CapabilityStatus: String, Codable, Equatable {
    case ready
    case unavailable
    case initFailed = "init_failed"
}

/// Mirror of the daemon's `CapabilityReadiness` shape. `meta` is decoded
/// permissively as primitive-only key/value pairs because its TypeScript
/// type is `Record<string, string | number | boolean>`.
struct CapabilityReadiness: Codable, Equatable {
    let id: String
    let moduleName: String
    let status: CapabilityStatus
    let reason: String?
    let message: String?
    let meta: [String: CapabilityMetaValue]?

    private enum CodingKeys: String, CodingKey {
        case id, moduleName, status, reason, message, meta
    }
}

/// Primitive-only value inside `CapabilityReadiness.meta`. Decoded via a
/// single-value container so each entry preserves its native JSON type
/// without flattening to a string.
enum CapabilityMetaValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(Bool.self) {
            self = .bool(value)
            return
        }
        if let value = try? container.decode(Double.self) {
            self = .number(value)
            return
        }
        if let value = try? container.decode(String.self) {
            self = .string(value)
            return
        }
        throw DecodingError.dataCorruptedError(
            in: container,
            debugDescription: "Unknown capability meta value type"
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .number(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        }
    }

    var stringValue: String? {
        switch self {
        case .string(let v): return v
        case .number(let v):
            if v.rounded() == v { return String(Int64(v)) }
            return String(v)
        case .bool(let v): return v ? "true" : "false"
        }
    }

    var intValue: Int? {
        if case .number(let v) = self, v.rounded() == v { return Int(v) }
        return nil
    }
}

/// Mirror of the daemon's `CapabilityReadinessSummary` shape.
struct CapabilityReadinessSummary: Codable, Equatable {
    let ready: Int
    let unavailable: Int
    let initFailed: Int

    private enum CodingKeys: String, CodingKey {
        case ready
        case unavailable
        case initFailed = "init_failed"
    }
}

/// Mirror of the daemon's `GET /capabilities` response shape.
struct CapabilityReadinessResponse: Codable, Equatable {
    let capabilities: [CapabilityReadiness]
    let summary: CapabilityReadinessSummary
}

// MARK: Stable capability ids

/// Stable id for the embedded dashboard capability. Mirrors
/// `DASHBOARD_CAPABILITY_ID` in `src/core/daemon/client-identity.ts`.
let DASHBOARD_CAPABILITY_ID = "dashboard"

/// Stable id the daemon registers when one or more workflow definitions
/// are enabled. Mirrors `WORKFLOW_TRIGGER_CAPABILITY_ID`.
let WORKFLOW_TRIGGER_CAPABILITY_ID = "workflow.trigger"

// MARK: Identity payload

/// Mirror of the daemon's `ClientDashboardAvailability` discriminated
/// union. The `available: true` arm carries the path the daemon serves
/// the dashboard at; the `available: false` arm carries the typed reason
/// the caller can map to UI without parsing a free-form message.
enum ClientDashboardAvailability: Codable, Equatable {
    case available(path: String)
    case unavailable(reason: String, message: String?)

    private enum CodingKeys: String, CodingKey {
        case available, path, reason, message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let available = try container.decode(Bool.self, forKey: .available)
        if available {
            let path = try container.decode(String.self, forKey: .path)
            self = .available(path: path)
            return
        }
        let reason = try container.decode(String.self, forKey: .reason)
        let message = try container.decodeIfPresent(String.self, forKey: .message)
        self = .unavailable(reason: reason, message: message)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .available(let path):
            try container.encode(true, forKey: .available)
            try container.encode(path, forKey: .path)
        case .unavailable(let reason, let message):
            try container.encode(false, forKey: .available)
            try container.encode(reason, forKey: .reason)
            try container.encodeIfPresent(message, forKey: .message)
        }
    }

    var isAvailable: Bool {
        if case .available = self { return true }
        return false
    }

    var path: String? {
        if case .available(let p) = self { return p }
        return nil
    }

    var reason: String? {
        if case .unavailable(let r, _) = self { return r }
        return nil
    }

    var message: String? {
        if case .unavailable(_, let m) = self { return m }
        return nil
    }
}

/// Mirror of the daemon's `ClientIdentity` payload from `GET /identity`.
struct ClientIdentity: Codable, Equatable {
    let projectName: String
    let projectDir: String
    let projects: ProjectRegistryProjection
    let daemonVersion: String
    let pid: Int
    let startedAt: String
    let dashboard: ClientDashboardAvailability
}

/// Mirror of the daemon's `ConfiguredProject` shape exposed through
/// `ClientIdentity.projects.projects` and the cross-project
/// `GET /projects` route.
struct ConfiguredProjectEntry: Codable, Equatable {
    let projectId: String
    let projectDir: String
    let displayName: String
}

/// Mirror of the daemon's `ProjectRegistryProjection` shape. Clients
/// render a project selector against this projection rather than parsing
/// `.kota/` files. Strict decode: an empty `projects` array or a
/// `defaultProjectId` that does not match any entry fails the suite.
struct ProjectRegistryProjection: Codable, Equatable {
    let defaultProjectId: String
    let projects: [ConfiguredProjectEntry]

    init(defaultProjectId: String, projects: [ConfiguredProjectEntry]) {
        self.defaultProjectId = defaultProjectId
        self.projects = projects
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let defaultProjectId = try container.decode(String.self, forKey: .defaultProjectId)
        let projects = try container.decode([ConfiguredProjectEntry].self, forKey: .projects)
        if projects.isEmpty {
            throw DecodingError.dataCorruptedError(
                forKey: .projects,
                in: container,
                debugDescription: "projects must declare at least one entry"
            )
        }
        if !projects.contains(where: { $0.projectId == defaultProjectId }) {
            throw DecodingError.dataCorruptedError(
                forKey: .defaultProjectId,
                in: container,
                debugDescription: "defaultProjectId \(defaultProjectId) does not match any registered project"
            )
        }
        self.defaultProjectId = defaultProjectId
        self.projects = projects
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(defaultProjectId, forKey: .defaultProjectId)
        try container.encode(projects, forKey: .projects)
    }

    private enum CodingKeys: String, CodingKey {
        case defaultProjectId, projects
    }
}

/// Mirror of the daemon's canonical `ScopeRegistryProjection` shape.
/// The root and default ids must both name entries in `scopes`; directory
/// backed scopes carry `directoryRoot`, while the global root does not.
struct ConfiguredScopeEntry: Codable, Equatable {
    let scopeId: String
    let displayName: String
    let parentScopeId: String?
    let directoryRoot: String?
}

struct ScopeRegistryProjection: Codable, Equatable {
    let rootScopeId: String
    let defaultScopeId: String
    let scopes: [ConfiguredScopeEntry]

    init(rootScopeId: String, defaultScopeId: String, scopes: [ConfiguredScopeEntry]) {
        self.rootScopeId = rootScopeId
        self.defaultScopeId = defaultScopeId
        self.scopes = scopes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let rootScopeId = try container.decode(String.self, forKey: .rootScopeId)
        let defaultScopeId = try container.decode(String.self, forKey: .defaultScopeId)
        let scopes = try container.decode([ConfiguredScopeEntry].self, forKey: .scopes)
        if scopes.isEmpty {
            throw DecodingError.dataCorruptedError(
                forKey: .scopes,
                in: container,
                debugDescription: "scopes must declare at least one entry"
            )
        }
        if !scopes.contains(where: { $0.scopeId == rootScopeId }) {
            throw DecodingError.dataCorruptedError(
                forKey: .rootScopeId,
                in: container,
                debugDescription: "rootScopeId \(rootScopeId) does not match any registered scope"
            )
        }
        if !scopes.contains(where: { $0.scopeId == defaultScopeId }) {
            throw DecodingError.dataCorruptedError(
                forKey: .defaultScopeId,
                in: container,
                debugDescription: "defaultScopeId \(defaultScopeId) does not match any registered scope"
            )
        }
        self.rootScopeId = rootScopeId
        self.defaultScopeId = defaultScopeId
        self.scopes = scopes
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(rootScopeId, forKey: .rootScopeId)
        try container.encode(defaultScopeId, forKey: .defaultScopeId)
        try container.encode(scopes, forKey: .scopes)
    }

    private enum CodingKeys: String, CodingKey {
        case rootScopeId, defaultScopeId, scopes
    }
}

/// Mirror of the daemon's typed `unknown_project` rejection that
/// project-scoped routes emit when `?projectId=` is set to an
/// unconfigured id. Strict decode: any other `reason` value fails.
struct UnknownProjectError: Codable, Equatable {
    let error: String
    let reason: String
    let projectId: String

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let error = try container.decode(String.self, forKey: .error)
        let reason = try container.decode(String.self, forKey: .reason)
        let projectId = try container.decode(String.self, forKey: .projectId)
        if reason != "unknown_project" {
            throw DecodingError.dataCorruptedError(
                forKey: .reason,
                in: container,
                debugDescription: "unknown reason: \(reason)"
            )
        }
        if error != "Unknown project" {
            throw DecodingError.dataCorruptedError(
                forKey: .error,
                in: container,
                debugDescription: "unknown error label: \(error)"
            )
        }
        self.error = error
        self.reason = reason
        self.projectId = projectId
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(error, forKey: .error)
        try container.encode(reason, forKey: .reason)
        try container.encode(projectId, forKey: .projectId)
    }

    private enum CodingKeys: String, CodingKey {
        case error, reason, projectId
    }
}

// MARK: Workflow definitions

/// Mirror of the daemon's `WorkflowDefinitionTriggerSummary` discriminated
/// union. Each arm carries exactly the fields its surface needs — strict
/// decode rejects unknown trigger types.
enum WorkflowDefinitionTriggerSummary: Codable, Equatable {
    case event(event: String)
    case cron(schedule: String)
    case interval(intervalMs: Int)
    case webhook
    case watch(patterns: [String], debounceMs: Int)

    private enum CodingKeys: String, CodingKey {
        case type, event, schedule, intervalMs, patterns, debounceMs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "event":
            let event = try container.decode(String.self, forKey: .event)
            self = .event(event: event)
        case "cron":
            let schedule = try container.decode(String.self, forKey: .schedule)
            self = .cron(schedule: schedule)
        case "interval":
            let intervalMs = try container.decode(Int.self, forKey: .intervalMs)
            self = .interval(intervalMs: intervalMs)
        case "webhook":
            self = .webhook
        case "watch":
            let patterns = try container.decode([String].self, forKey: .patterns)
            let debounceMs = try container.decode(Int.self, forKey: .debounceMs)
            self = .watch(patterns: patterns, debounceMs: debounceMs)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Unknown workflow trigger type: \(type)"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .event(let event):
            try container.encode("event", forKey: .type)
            try container.encode(event, forKey: .event)
        case .cron(let schedule):
            try container.encode("cron", forKey: .type)
            try container.encode(schedule, forKey: .schedule)
        case .interval(let intervalMs):
            try container.encode("interval", forKey: .type)
            try container.encode(intervalMs, forKey: .intervalMs)
        case .webhook:
            try container.encode("webhook", forKey: .type)
        case .watch(let patterns, let debounceMs):
            try container.encode("watch", forKey: .type)
            try container.encode(patterns, forKey: .patterns)
            try container.encode(debounceMs, forKey: .debounceMs)
        }
    }

    /// Short label suitable for a workflow picker. Tries to convey the
    /// trigger flavor without leaking implementation detail.
    var label: String {
        switch self {
        case .event(let event): return "event:\(event)"
        case .cron(let schedule): return "cron:\(schedule)"
        case .interval(let ms):
            let seconds = ms / 1000
            return seconds > 0 ? "interval:\(seconds)s" : "interval:\(ms)ms"
        case .webhook: return "webhook"
        case .watch(let patterns, _):
            return "watch:\(patterns.first ?? "")"
        }
    }
}

/// Mirror of the daemon's `WorkflowDefinitionSummary` shape returned by
/// `GET /workflow/definitions`. `inputSchema` is decoded as raw JSON
/// data because the daemon emits an arbitrary JSON Schema; clients that
/// need to render input fields decode the schema themselves.
struct WorkflowDefinitionSummary: Codable, Equatable, Identifiable {
    let name: String
    let enabled: Bool
    let runtimeEnabled: Bool?
    let stepCount: Int
    let triggers: [WorkflowDefinitionTriggerSummary]
    let inputSchema: WorkflowInputSchema?

    var id: String { name }
}

/// Opaque container around the JSON Schema the daemon emits for a
/// workflow's `inputSchema`. Decoding succeeds for any well-formed JSON
/// object so the macOS surface can detect "this workflow takes input"
/// without owning a JSON Schema engine.
struct WorkflowInputSchema: Codable, Equatable {
    let raw: Data

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let value = try container.decode(JSONValue.self)
        self.raw = try JSONEncoder().encode(value)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        let value = try JSONDecoder().decode(JSONValue.self, from: raw)
        try container.encode(value)
    }
}

/// Permissive JSON value used only to round-trip arbitrary JSON Schema
/// blobs through `WorkflowInputSchema`. Not exposed elsewhere — every
/// other contract type is strict.
private enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null; return }
        if let v = try? container.decode(Bool.self) { self = .bool(v); return }
        if let v = try? container.decode(Double.self) { self = .number(v); return }
        if let v = try? container.decode(String.self) { self = .string(v); return }
        if let v = try? container.decode([JSONValue].self) { self = .array(v); return }
        if let v = try? container.decode([String: JSONValue].self) { self = .object(v); return }
        throw DecodingError.dataCorruptedError(
            in: container,
            debugDescription: "Unsupported JSON value"
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let v): try container.encode(v)
        case .number(let v): try container.encode(v)
        case .bool(let v): try container.encode(v)
        case .null: try container.encodeNil()
        case .array(let v): try container.encode(v)
        case .object(let v): try container.encode(v)
        }
    }
}

/// Mirror of the daemon's `GET /workflow/definitions` envelope.
struct WorkflowDefinitionsResponse: Codable, Equatable {
    let definitions: [WorkflowDefinitionSummary]
}
