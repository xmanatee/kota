import XCTest
@testable import KotaShared

/// Cross-client contract conformance.
///
/// Decodes the shared JSON fixture from
/// `clients/conformance/contract-fixture.json` (copied into this test
/// target as a SwiftPM resource — see `Package.swift`) through the macOS
/// Codable types in `Models.swift` and `ContractTypes.swift`. The same
/// JSON tree is also exercised by the TypeScript suites
/// (`src/core/daemon/client-contract.test.ts`,
/// `clients/web/src/api/client.test.ts`,
/// `clients/mobile/src/__tests__/contractFixture.test.ts`). When the
/// contract drifts, every suite fails together.
///
/// The cross-client integration test
/// (`src/contract-fixture-cross-client.integration.test.ts`) keeps the
/// embedded resource file byte-identical to the canonical fixture.
final class ContractFixtureTests: XCTestCase {
    private static func loadFixtureData() throws -> Data {
        guard let url = Bundle.module.url(
            forResource: "contract-fixture",
            withExtension: "json"
        ) else {
            XCTFail("contract-fixture.json missing from KotaMenuBarTests resources — check Package.swift")
            throw NSError(domain: "fixture", code: -1)
        }
        return try Data(contentsOf: url)
    }

    private static func loadFixtureTree() throws -> [String: Any] {
        let data = try loadFixtureData()
        guard let tree = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            XCTFail("contract-fixture.json did not parse as a JSON object")
            throw NSError(domain: "fixture", code: -1)
        }
        return tree
    }

    private static func sectionData(_ key: String) throws -> Data {
        let tree = try loadFixtureTree()
        guard let sub = tree[key] else {
            XCTFail("contract-fixture.json missing top-level key \"\(key)\"")
            throw NSError(domain: "fixture", code: -1)
        }
        return try JSONSerialization.data(withJSONObject: sub, options: [.sortedKeys])
    }

    private static func nestedData(_ path: [String]) throws -> Data {
        var current: Any = try loadFixtureTree()
        for key in path {
            guard let dict = current as? [String: Any], let next = dict[key] else {
                XCTFail("contract-fixture.json missing path \(path.joined(separator: "."))")
                throw NSError(domain: "fixture", code: -1)
            }
            current = next
        }
        return try JSONSerialization.data(withJSONObject: current, options: [.sortedKeys])
    }

    // MARK: - Identity

    func testDecodesDashboardAvailableIdentity() throws {
        let data = try Self.sectionData("identity")
        let identity = try JSONDecoder().decode(ClientIdentity.self, from: data)
        XCTAssertEqual(identity.projectName, "kota")
        XCTAssertEqual(identity.projectDir, "/Users/operator/projects/kota")
        XCTAssertEqual(identity.daemonVersion, "0.1.0")
        XCTAssertEqual(identity.pid, 12345)
        XCTAssertEqual(identity.dashboard.isAvailable, true)
        XCTAssertEqual(identity.dashboard.path, "/")
        XCTAssertEqual(identity.projects.defaultProjectId, "p-kota-fixture-default")
        XCTAssertEqual(identity.projects.projects.count, 2)
        XCTAssertEqual(identity.projects.projects[1].displayName, "side-project")
    }

    // MARK: - Project registry projection

    func testDecodesProjectRegistryProjection() throws {
        let data = try Self.sectionData("projects")
        let projection = try JSONDecoder().decode(ProjectRegistryProjection.self, from: data)
        XCTAssertEqual(projection.defaultProjectId, "p-kota-fixture-default")
        XCTAssertEqual(projection.projects.count, 2)
        XCTAssertEqual(projection.projects.first?.displayName, "kota")
    }

    func testProjectRegistryProjectionRejectsUnknownDefault() throws {
        let json = """
        {
          "defaultProjectId": "p-missing",
          "projects": [
            { "projectId": "p-real", "projectDir": "/tmp", "displayName": "real" }
          ]
        }
        """
        let data = Data(json.utf8)
        XCTAssertThrowsError(
            try JSONDecoder().decode(ProjectRegistryProjection.self, from: data)
        )
    }

    func testProjectRegistryProjectionRejectsEmptyProjects() throws {
        let json = """
        {
          "defaultProjectId": "p-real",
          "projects": []
        }
        """
        let data = Data(json.utf8)
        XCTAssertThrowsError(
            try JSONDecoder().decode(ProjectRegistryProjection.self, from: data)
        )
    }

    // MARK: - Scope registry projection

    func testDecodesScopeRegistryProjection() throws {
        let data = try Self.sectionData("scopes")
        let projection = try JSONDecoder().decode(ScopeRegistryProjection.self, from: data)
        XCTAssertEqual(projection.rootScopeId, "global")
        XCTAssertEqual(projection.defaultScopeId, "p-kota-fixture-default")
        XCTAssertEqual(projection.scopes.count, 3)
        XCTAssertEqual(projection.scopes.first?.scopeId, "global")
        XCTAssertEqual(projection.scopes.filter { $0.directoryRoot != nil }.count, 2)
    }

    func testScopeRegistryProjectionRejectsUnknownDefault() throws {
        let json = """
        {
          "rootScopeId": "global",
          "defaultScopeId": "missing",
          "scopes": [
            { "scopeId": "global", "displayName": "Global" }
          ]
        }
        """
        let data = Data(json.utf8)
        XCTAssertThrowsError(
            try JSONDecoder().decode(ScopeRegistryProjection.self, from: data)
        )
    }

    func testScopeRegistryProjectionRejectsEmptyScopes() throws {
        let json = """
        {
          "rootScopeId": "global",
          "defaultScopeId": "global",
          "scopes": []
        }
        """
        let data = Data(json.utf8)
        XCTAssertThrowsError(
            try JSONDecoder().decode(ScopeRegistryProjection.self, from: data)
        )
    }

    func testDecodesUnknownProjectError() throws {
        let data = try Self.sectionData("unknownProjectError")
        let err = try JSONDecoder().decode(UnknownProjectError.self, from: data)
        XCTAssertEqual(err.reason, "unknown_project")
        XCTAssertEqual(err.projectId, "p-not-configured")
    }

    func testUnknownProjectErrorRejectsAlienReason() throws {
        let json = """
        {
          "error": "Unknown project",
          "reason": "future_reason",
          "projectId": "p-x"
        }
        """
        let data = Data(json.utf8)
        XCTAssertThrowsError(
            try JSONDecoder().decode(UnknownProjectError.self, from: data)
        )
    }

    func testDecodesDashboardUnavailableIdentity() throws {
        let data = try Self.sectionData("identityWithoutDashboard")
        let identity = try JSONDecoder().decode(ClientIdentity.self, from: data)
        XCTAssertEqual(identity.dashboard.isAvailable, false)
        XCTAssertEqual(identity.dashboard.reason, "web_ui_not_built")
        XCTAssertNotNil(identity.dashboard.message)
    }

    // MARK: - Capabilities

    func testDecodesCapabilityReadinessResponse() throws {
        let data = try Self.sectionData("capabilities")
        let caps = try JSONDecoder().decode(CapabilityReadinessResponse.self, from: data)
        XCTAssertEqual(caps.summary.ready, 3)
        XCTAssertEqual(caps.summary.unavailable, 1)
        XCTAssertEqual(caps.summary.initFailed, 0)
        let dashboard = caps.capabilities.first { $0.id == DASHBOARD_CAPABILITY_ID }
        XCTAssertEqual(dashboard?.status, .ready)
        let trigger = caps.capabilities.first { $0.id == WORKFLOW_TRIGGER_CAPABILITY_ID }
        XCTAssertEqual(trigger?.meta?["enabled"]?.intValue, 8)
        let semantic = caps.capabilities.first { $0.id == "knowledge.semantic_search" }
        XCTAssertEqual(semantic?.status, .unavailable)
        XCTAssertEqual(semantic?.reason, "embedding_unsupported")
    }

    // MARK: - Setup requirements

    func testDecodesSetupRequirementsStatus() throws {
        let data = try Self.nestedData(["setupRequirements", "status"])
        let response = try JSONDecoder().decode(SetupStatusResponse.self, from: data)
        XCTAssertEqual(response.requirements.count, 4)
        XCTAssertEqual(response.summary.ready, 1)
        XCTAssertEqual(response.summary.missing, 1)
        XCTAssertEqual(response.summary.pending, 1)
        let oauth = response.requirements.first { $0.kind == .oauth }
        XCTAssertEqual(oauth?.state, .pending)
        XCTAssertEqual(oauth?.pendingAction?.status, .pending)
        let config = response.requirements.first { $0.kind == .config }
        if case .form(let fields)? = config?.setup {
            XCTAssertEqual(fields.first?.valueKind, .secretReference)
        } else {
            XCTFail("expected config setup form fields")
        }
        let browser = response.requirements.first { $0.kind == .browserProfile }
        XCTAssertEqual(browser?.sensitivity, .browserProfile)
    }

    func testSetupRequirementsRejectUnknownState() throws {
        let data = try Self.nestedData(["setupRequirements", "negative_unknownState"])
        XCTAssertThrowsError(try JSONDecoder().decode(SetupStatusResponse.self, from: data))
    }

    func testSetupRequirementsRejectUnknownKind() throws {
        let data = try Self.nestedData(["setupRequirements", "negative_unknownKind"])
        XCTAssertThrowsError(try JSONDecoder().decode(SetupStatusResponse.self, from: data))
    }

    func testSetupRequirementsRejectUnknownMode() throws {
        let data = try Self.nestedData(["setupRequirements", "negative_unknownSetupMode"])
        XCTAssertThrowsError(try JSONDecoder().decode(SetupStatusResponse.self, from: data))
    }

    func testSetupRequirementsRejectUnknownFieldValueKind() throws {
        let data = try Self.nestedData(["setupRequirements", "negative_unknownFieldValueKind"])
        XCTAssertThrowsError(try JSONDecoder().decode(SetupStatusResponse.self, from: data))
    }

    // MARK: - Workflow definitions

    func testDecodesWorkflowDefinitions() throws {
        let data = try Self.sectionData("workflowDefinitions")
        let response = try JSONDecoder().decode(WorkflowDefinitionsResponse.self, from: data)
        XCTAssertEqual(response.definitions.count, 2)
        let decomposer = response.definitions.first { $0.name == "decomposer" }
        XCTAssertNotNil(decomposer?.inputSchema)
        switch decomposer?.triggers.first {
        case .event(let event)?:
            XCTAssertEqual(event, "autonomy.queue.available")
        default:
            XCTFail("expected event trigger on decomposer")
        }
    }

    // MARK: - Recall

    func testDecodesRecallSuccessMixedSources() throws {
        let data = try Self.nestedData(["recall", "successMixedSources"])
        let result = try JSONDecoder().decode(RecallSearchResponse.self, from: data)
        guard case .success(let hits) = result else {
            XCTFail("expected ok=true recall response")
            return
        }
        XCTAssertEqual(hits.count, 5)
        XCTAssertEqual(
            hits.map { $0.source },
            ["knowledge", "memory", "history", "tasks", "answer"]
        )
    }

    func testDecodesRecallSuccessAnswerHitFailureArm() throws {
        let data = try Self.nestedData(["recall", "successAnswerHitFailureArm"])
        let result = try JSONDecoder().decode(RecallSearchResponse.self, from: data)
        guard case .success(let hits) = result, hits.count == 1 else {
            XCTFail("expected single answer hit")
            return
        }
        XCTAssertEqual(hits[0].source, "answer")
        XCTAssertEqual(hits[0].describe, "[no_hits] What is the latest deploy status?")
    }

    func testDecodesRecallSemanticUnavailable() throws {
        let data = try Self.nestedData(["recall", "semanticUnavailable"])
        let result = try JSONDecoder().decode(RecallSearchResponse.self, from: data)
        if case .semanticUnavailable = result { return }
        XCTFail("expected semantic_unavailable arm")
    }

    func testRecallNegativeUnknownSourceFails() throws {
        let data = try Self.nestedData(["recall", "negative_unknownSource"])
        XCTAssertThrowsError(try JSONDecoder().decode(RecallSearchResponse.self, from: data))
    }

    func testRecallNegativeUnknownAnswerResultReasonFails() throws {
        let data = try Self.nestedData(["recall", "negative_unknownAnswerResultReason"])
        XCTAssertThrowsError(try JSONDecoder().decode(RecallSearchResponse.self, from: data))
    }

    func testRecallNegativeUnknownReasonFails() throws {
        let data = try Self.nestedData(["recall", "negative_unknownReason"])
        XCTAssertThrowsError(try JSONDecoder().decode(RecallSearchResponse.self, from: data))
    }

    // MARK: - Answer

    func testDecodesAnswerSuccess() throws {
        let data = try Self.nestedData(["answer", "success"])
        let result = try JSONDecoder().decode(AnswerResult.self, from: data)
        guard case .success(let answer, let citations, let hits) = result else {
            XCTFail("expected ok=true answer result")
            return
        }
        XCTAssertFalse(answer.isEmpty)
        XCTAssertEqual(citations.count, 3)
        XCTAssertEqual(hits.count, 3)
        XCTAssertTrue(
            citations.contains { $0.source == "answer" && $0.id == "ans-1" },
            "expected the success arm to include a source: 'answer' citation"
        )
        XCTAssertTrue(
            hits.contains { $0.source == "answer" && $0.id == "ans-1" },
            "expected the success arm to include a matching source: 'answer' hit"
        )
    }

    func testDecodesAnswerNoHits() throws {
        let data = try Self.nestedData(["answer", "noHits"])
        let result = try JSONDecoder().decode(AnswerResult.self, from: data)
        if case .noHits = result { return }
        XCTFail("expected no_hits arm")
    }

    func testDecodesAnswerSemanticUnavailable() throws {
        let data = try Self.nestedData(["answer", "semanticUnavailable"])
        let result = try JSONDecoder().decode(AnswerResult.self, from: data)
        if case .semanticUnavailable = result { return }
        XCTFail("expected semantic_unavailable arm")
    }

    func testDecodesAnswerSynthesisFailed() throws {
        let data = try Self.nestedData(["answer", "synthesisFailed"])
        let result = try JSONDecoder().decode(AnswerResult.self, from: data)
        if case .synthesisFailed = result { return }
        XCTFail("expected synthesis_failed arm")
    }

    func testAnswerNegativeUnknownReasonFails() throws {
        let data = try Self.nestedData(["answer", "negative_unknownReason"])
        XCTAssertThrowsError(try JSONDecoder().decode(AnswerResult.self, from: data))
    }

    func testAnswerNegativeUnknownCitationSourceFails() throws {
        let data = try Self.nestedData(["answer", "negative_unknownCitationSource"])
        XCTAssertThrowsError(try JSONDecoder().decode(AnswerResult.self, from: data))
    }

    // MARK: - Answer history

    func testDecodesAnswerHistoryList() throws {
        let data = try Self.nestedData(["answerHistory", "list"])
        let result = try JSONDecoder().decode(AnswerHistoryListResult.self, from: data)
        XCTAssertEqual(result.entries.count, 2)
        switch result.entries[0].result {
        case .success(let count): XCTAssertEqual(count, 2)
        default: XCTFail("expected ok=true entry first")
        }
        switch result.entries[1].result {
        case .noHits: break
        default: XCTFail("expected no_hits entry second")
        }
    }

    func testDecodesAnswerHistoryShowFound() throws {
        let data = try Self.nestedData(["answerHistory", "showFound"])
        let result = try JSONDecoder().decode(AnswerHistoryShowResult.self, from: data)
        guard case .success(let record) = result else {
            XCTFail("expected ok=true show result")
            return
        }
        XCTAssertEqual(record.id, "ans-1")
        XCTAssertFalse(record.recallHits.isEmpty)
    }

    func testDecodesAnswerHistoryShowNotFound() throws {
        let data = try Self.nestedData(["answerHistory", "showNotFound"])
        let result = try JSONDecoder().decode(AnswerHistoryShowResult.self, from: data)
        if case .notFound = result { return }
        XCTFail("expected not_found arm")
    }

    func testAnswerHistoryNegativeUnknownReasonFails() throws {
        let data = try Self.nestedData(["answerHistory", "negative_unknownReason"])
        XCTAssertThrowsError(try JSONDecoder().decode(AnswerHistoryShowResult.self, from: data))
    }

    // MARK: - Capture

    func testDecodesCaptureSuccessMemory() throws {
        let data = try Self.nestedData(["capture", "successMemory"])
        let result = try JSONDecoder().decode(CaptureResult.self, from: data)
        guard case .success(let record) = result, case .memory = record else {
            XCTFail("expected ok=true memory record")
            return
        }
    }

    func testDecodesCaptureSuccessTasks() throws {
        let data = try Self.nestedData(["capture", "successTasks"])
        let result = try JSONDecoder().decode(CaptureResult.self, from: data)
        guard case .success(let record) = result,
              case .tasks(_, let path) = record else {
            XCTFail("expected ok=true tasks record")
            return
        }
        XCTAssertTrue(path.contains("data/tasks/"))
    }

    func testDecodesCaptureAmbiguous() throws {
        let data = try Self.nestedData(["capture", "ambiguous"])
        let result = try JSONDecoder().decode(CaptureResult.self, from: data)
        guard case .ambiguous(let suggestions) = result else {
            XCTFail("expected ambiguous arm")
            return
        }
        XCTAssertEqual(suggestions, [.memory, .knowledge])
    }

    func testDecodesCaptureContributorFailed() throws {
        let data = try Self.nestedData(["capture", "contributorFailed"])
        let result = try JSONDecoder().decode(CaptureResult.self, from: data)
        guard case .contributorFailed(let target, let message) = result else {
            XCTFail("expected contributor_failed arm")
            return
        }
        XCTAssertEqual(target, .tasks)
        XCTAssertEqual(message, "filesystem unavailable")
    }

    func testCaptureNegativeUnknownTargetFails() throws {
        let data = try Self.nestedData(["capture", "negative_unknownTarget"])
        XCTAssertThrowsError(try JSONDecoder().decode(CaptureResult.self, from: data))
    }

    func testCaptureNegativeUnknownReasonFails() throws {
        let data = try Self.nestedData(["capture", "negative_unknownReason"])
        XCTAssertThrowsError(try JSONDecoder().decode(CaptureResult.self, from: data))
    }

    // MARK: - Retract

    func testDecodesRetractSuccessTasksMovedToDropped() throws {
        let data = try Self.nestedData(["retract", "successTasks"])
        let result = try JSONDecoder().decode(RetractResult.self, from: data)
        guard case .success(let record) = result,
              case .tasks(_, let previousPath, let path, let toState) = record else {
            XCTFail("expected ok=true tasks record")
            return
        }
        XCTAssertTrue(previousPath.hasSuffix(".md"))
        XCTAssertTrue(path.contains("dropped"))
        XCTAssertEqual(toState, "dropped")
    }

    func testDecodesRetractNotFound() throws {
        let data = try Self.nestedData(["retract", "notFound"])
        let result = try JSONDecoder().decode(RetractResult.self, from: data)
        guard case .notFound(let target, let identifier) = result else {
            XCTFail("expected not_found arm")
            return
        }
        XCTAssertEqual(target, .tasks)
        XCTAssertEqual(identifier, "task-missing")
    }

    func testRetractNegativeUnknownTargetFails() throws {
        let data = try Self.nestedData(["retract", "negative_unknownTarget"])
        XCTAssertThrowsError(try JSONDecoder().decode(RetractResult.self, from: data))
    }

    func testRetractNegativeUnknownReasonFails() throws {
        let data = try Self.nestedData(["retract", "negative_unknownReason"])
        XCTAssertThrowsError(try JSONDecoder().decode(RetractResult.self, from: data))
    }

    // MARK: - Per-store semantic search

    func testDecodesKnowledgeSearchSuccess() throws {
        let data = try Self.nestedData(["knowledgeSearch", "success"])
        let result = try JSONDecoder().decode(KnowledgeSearchResponse.self, from: data)
        if case .success(let entries) = result {
            XCTAssertEqual(entries.count, 2)
            return
        }
        XCTFail("expected ok=true entries")
    }

    func testDecodesKnowledgeSearchSemanticUnavailable() throws {
        let data = try Self.nestedData(["knowledgeSearch", "semanticUnavailable"])
        let result = try JSONDecoder().decode(KnowledgeSearchResponse.self, from: data)
        if case .semanticUnavailable = result { return }
        XCTFail("expected semantic_unavailable arm")
    }

    func testKnowledgeSearchNegativeUnknownReasonFails() throws {
        let data = try Self.nestedData(["knowledgeSearch", "negative_unknownReason"])
        XCTAssertThrowsError(try JSONDecoder().decode(KnowledgeSearchResponse.self, from: data))
    }

    func testDecodesMemorySearchSuccess() throws {
        let data = try Self.nestedData(["memorySearch", "success"])
        let result = try JSONDecoder().decode(MemorySearchResponse.self, from: data)
        if case .success(let entries) = result {
            XCTAssertEqual(entries.count, 1)
            return
        }
        XCTFail("expected ok=true entries")
    }

    func testMemorySearchNegativeUnknownReasonFails() throws {
        let data = try Self.nestedData(["memorySearch", "negative_unknownReason"])
        XCTAssertThrowsError(try JSONDecoder().decode(MemorySearchResponse.self, from: data))
    }

    func testDecodesHistorySearchSuccess() throws {
        let data = try Self.nestedData(["historySearch", "success"])
        let result = try JSONDecoder().decode(HistorySearchResponse.self, from: data)
        if case .success(let conversations) = result {
            XCTAssertEqual(conversations.count, 1)
            XCTAssertEqual(conversations[0].source, "user")
            return
        }
        XCTFail("expected ok=true conversations")
    }

    func testHistorySearchNegativeUnknownReasonFails() throws {
        let data = try Self.nestedData(["historySearch", "negative_unknownReason"])
        XCTAssertThrowsError(try JSONDecoder().decode(HistorySearchResponse.self, from: data))
    }

    func testHistorySearchNegativeUnknownSourceFails() throws {
        let data = try Self.nestedData(["historySearch", "negative_unknownSource"])
        XCTAssertThrowsError(
            try JSONDecoder().decode(HistorySearchResponse.self, from: data),
            "Expected ConversationRecord.source decode to reject the unknown closed-set value"
        )
    }

    func testDecodesTasksSearchSuccess() throws {
        let data = try Self.nestedData(["tasksSearch", "success"])
        let result = try JSONDecoder().decode(TasksSearchResponse.self, from: data)
        if case .success(let tasks) = result {
            XCTAssertEqual(tasks.count, 1)
            XCTAssertEqual(tasks[0].priority, "p1")
            return
        }
        XCTFail("expected ok=true tasks")
    }

    func testTasksSearchNegativeUnknownReasonFails() throws {
        let data = try Self.nestedData(["tasksSearch", "negative_unknownReason"])
        XCTAssertThrowsError(try JSONDecoder().decode(TasksSearchResponse.self, from: data))
    }

    // MARK: - Attention

    func testDecodesAttentionResponse() throws {
        let data = try Self.sectionData("attention")
        let response = try JSONDecoder().decode(AttentionResponse.self, from: data)
        XCTAssertEqual(response.data.items.count, 2)
        XCTAssertFalse(response.text.isEmpty)
    }

    // MARK: - Digest

    func testDecodesDigestResponse() throws {
        let data = try Self.sectionData("digest")
        let response = try JSONDecoder().decode(DigestResponse.self, from: data)
        XCTAssertEqual(response.data.builderCommits.count, 1)
        XCTAssertEqual(response.data.queueDelta.current.ready, 2)
        XCTAssertEqual(response.data.queueDelta.delta.ready, 1)
        XCTAssertEqual(response.data.quiet, false)
    }

    // MARK: - Error bodies

    func testDecodesErrorBodyJson() throws {
        let data = try Self.nestedData(["errorBodies", "json"])
        guard let body = decodeDaemonErrorBody(from: data) else {
            XCTFail("expected JSON error body to decode")
            return
        }
        XCTAssertEqual(body.error, "Token rejected")
        XCTAssertEqual(body.code, "auth-invalid")
    }

    // MARK: - Voice failure envelopes

    func testDecodesVoiceTranscribeFailureSttUnavailable() throws {
        let data = try Self.nestedData(["voice", "transcribeFailureSttUnavailable"])
        guard let body = decodeDaemonErrorBody(from: data) else {
            XCTFail("expected voice failure body to decode")
            return
        }
        XCTAssertEqual(body.error, "STT unavailable")
        XCTAssertEqual(body.code, "stt-unavailable")
    }

    func testDecodesVoiceSynthesizeFailureFormatUnsupported() throws {
        let data = try Self.nestedData(["voice", "synthesizeFailureTtsFormatUnsupported"])
        guard let body = decodeDaemonErrorBody(from: data) else {
            XCTFail("expected voice failure body to decode")
            return
        }
        XCTAssertEqual(body.error, "TTS format unsupported")
        XCTAssertEqual(body.code, "tts-format-unsupported")
    }
}
