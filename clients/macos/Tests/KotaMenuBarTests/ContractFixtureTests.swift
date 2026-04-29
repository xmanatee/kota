import XCTest
@testable import KotaMenuBar

/// Cross-client contract conformance.
///
/// Decodes the shared JSON fixture from
/// `clients/conformance/contract-fixture.json` through the macOS Codable
/// types in `ContractTypes.swift`. The same JSON tree is also exercised
/// by the TypeScript suites
/// (`src/core/daemon/client-contract.test.ts`,
/// `clients/web/src/api/client.test.ts`). When the contract drifts, all
/// three suites fail together.
///
/// The fixture is duplicated here as a string literal so SwiftPM does
/// not need to reach outside its target directory for resources; a
/// TypeScript guard (`contract-fixture-cross-client.test.ts`) asserts
/// this literal parses to the same JSON tree as the canonical file.
final class ContractFixtureTests: XCTestCase {
    private static let fixtureJSON = """
{
  "identity": {
    "projectName": "kota",
    "projectDir": "/Users/operator/projects/kota",
    "daemonVersion": "0.1.0",
    "pid": 12345,
    "startedAt": "2026-04-29T01:00:00.000Z",
    "dashboard": {
      "available": true,
      "path": "/"
    }
  },
  "identityWithoutDashboard": {
    "projectName": "kota",
    "projectDir": "/Users/operator/projects/kota",
    "daemonVersion": "0.1.0",
    "pid": 12345,
    "startedAt": "2026-04-29T01:00:00.000Z",
    "dashboard": {
      "available": false,
      "reason": "web_ui_not_built",
      "message": "Web dashboard is unavailable — run `pnpm --filter @kota/web build` to produce clients/web/dist."
    }
  },
  "capabilities": {
    "capabilities": [
      {
        "id": "dashboard",
        "moduleName": "web",
        "status": "ready",
        "message": "Embedded web dashboard is built and ready to serve.",
        "meta": { "distDir": "/Users/operator/projects/kota/clients/web/dist" }
      },
      {
        "id": "knowledge.search",
        "moduleName": "knowledge",
        "status": "ready"
      },
      {
        "id": "knowledge.semantic_search",
        "moduleName": "knowledge",
        "status": "unavailable",
        "reason": "embedding_unsupported",
        "message": "No embedding-backed knowledge provider is configured."
      },
      {
        "id": "workflow.trigger",
        "moduleName": "core",
        "status": "ready",
        "message": "8 of 12 workflow definition(s) currently enabled.",
        "meta": { "enabled": 8, "total": 12 }
      }
    ],
    "summary": { "ready": 3, "unavailable": 1, "init_failed": 0 }
  },
  "workflowDefinitions": {
    "definitions": [
      {
        "name": "builder",
        "enabled": true,
        "stepCount": 4,
        "triggers": [{ "type": "event", "event": "autonomy.queue.available" }]
      },
      {
        "name": "decomposer",
        "enabled": true,
        "stepCount": 3,
        "triggers": [{ "type": "event", "event": "autonomy.queue.available" }],
        "inputSchema": {
          "type": "object",
          "properties": {
            "taskId": { "type": "string" }
          }
        }
      }
    ]
  },
  "errorBodies": {
    "json": {
      "error": "Token rejected",
      "code": "auth-invalid"
    },
    "typedFailure": {
      "ok": false,
      "reason": "semantic_unavailable"
    },
    "voiceFailure": {
      "ok": false,
      "error": "STT unavailable",
      "code": "stt-unavailable"
    },
    "plainText": "<html><body>Bad gateway</body></html>"
  }
}
"""

    private struct Fixture: Decodable {
        let identity: ClientIdentity
        let identityWithoutDashboard: ClientIdentity
        let capabilities: CapabilityReadinessResponse
        let workflowDefinitions: WorkflowDefinitionsResponse
    }

    private func loadFixture() throws -> Fixture {
        guard let data = ContractFixtureTests.fixtureJSON.data(using: .utf8) else {
            XCTFail("fixture JSON is not valid UTF-8")
            throw NSError(domain: "fixture", code: -1)
        }
        return try JSONDecoder().decode(Fixture.self, from: data)
    }

    func testDecodesDashboardAvailableIdentity() throws {
        let fixture = try loadFixture()
        XCTAssertEqual(fixture.identity.projectName, "kota")
        XCTAssertEqual(fixture.identity.projectDir, "/Users/operator/projects/kota")
        XCTAssertEqual(fixture.identity.daemonVersion, "0.1.0")
        XCTAssertEqual(fixture.identity.pid, 12345)
        XCTAssertEqual(fixture.identity.dashboard.isAvailable, true)
        XCTAssertEqual(fixture.identity.dashboard.path, "/")
    }

    func testDecodesDashboardUnavailableIdentity() throws {
        let fixture = try loadFixture()
        XCTAssertEqual(fixture.identityWithoutDashboard.dashboard.isAvailable, false)
        XCTAssertEqual(fixture.identityWithoutDashboard.dashboard.reason, "web_ui_not_built")
        XCTAssertNotNil(fixture.identityWithoutDashboard.dashboard.message)
    }

    func testDecodesCapabilityReadinessResponse() throws {
        let fixture = try loadFixture()
        XCTAssertEqual(fixture.capabilities.summary.ready, 3)
        XCTAssertEqual(fixture.capabilities.summary.unavailable, 1)
        XCTAssertEqual(fixture.capabilities.summary.initFailed, 0)
        let dashboard = fixture.capabilities.capabilities.first {
            $0.id == DASHBOARD_CAPABILITY_ID
        }
        XCTAssertEqual(dashboard?.status, .ready)
        let trigger = fixture.capabilities.capabilities.first {
            $0.id == WORKFLOW_TRIGGER_CAPABILITY_ID
        }
        XCTAssertEqual(trigger?.meta?["enabled"]?.intValue, 8)
        let semantic = fixture.capabilities.capabilities.first {
            $0.id == "knowledge.semantic_search"
        }
        XCTAssertEqual(semantic?.status, .unavailable)
        XCTAssertEqual(semantic?.reason, "embedding_unsupported")
    }

    func testDecodesWorkflowDefinitions() throws {
        let fixture = try loadFixture()
        let defs = fixture.workflowDefinitions.definitions
        XCTAssertEqual(defs.count, 2)
        let decomposer = defs.first { $0.name == "decomposer" }
        XCTAssertNotNil(decomposer?.inputSchema)
        switch decomposer?.triggers.first {
        case .event(let event)?:
            XCTAssertEqual(event, "autonomy.queue.available")
        default:
            XCTFail("expected event trigger on decomposer")
        }
    }
}
