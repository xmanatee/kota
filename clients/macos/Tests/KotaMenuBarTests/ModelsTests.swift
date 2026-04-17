import XCTest
@testable import KotaMenuBar

final class ModelsTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testDaemonControlFileDecodes() throws {
        let json = """
        {"port": 7777, "pid": 1234, "startedAt": "2026-04-16T00:00:00Z", "token": "abc123"}
        """.data(using: .utf8)!
        let control = try decoder.decode(DaemonControlFile.self, from: json)
        XCTAssertEqual(control.port, 7777)
        XCTAssertEqual(control.pid, 1234)
        XCTAssertEqual(control.token, "abc123")
    }

    func testStatusResponseWithRunsDecodes() throws {
        let json = """
        {
            "running": true,
            "workflow": {
                "activeRuns": [
                    {"runId": "r1", "workflow": "builder", "startedAt": "2026-04-16T00:00:00Z"}
                ],
                "paused": false
            }
        }
        """.data(using: .utf8)!
        let resp = try decoder.decode(DaemonStatusResponse.self, from: json)
        XCTAssertTrue(resp.running)
        XCTAssertEqual(resp.workflow?.activeRuns.count, 1)
        XCTAssertEqual(resp.workflow?.activeRuns.first?.runId, "r1")
        XCTAssertEqual(resp.workflow?.paused, false)
    }

    func testStatusResponseWithoutWorkflowDecodes() throws {
        let json = """
        {"running": false}
        """.data(using: .utf8)!
        let resp = try decoder.decode(DaemonStatusResponse.self, from: json)
        XCTAssertFalse(resp.running)
        XCTAssertNil(resp.workflow)
    }

    func testApprovalsResponseDecodes() throws {
        let json = """
        {
            "approvals": [
                {"id": "a1", "tool": "shell", "risk": "dangerous", "reason": "rm -rf", "createdAt": "t", "status": "pending", "input": {"anything": true}}
            ]
        }
        """.data(using: .utf8)!
        let resp = try decoder.decode(ApprovalsResponse.self, from: json)
        XCTAssertEqual(resp.approvals.count, 1)
        let approval = resp.approvals[0]
        XCTAssertEqual(approval.id, "a1")
        XCTAssertEqual(approval.tool, "shell")
        XCTAssertEqual(approval.risk, "dangerous")
        XCTAssertEqual(approval.reason, "rm -rf")
        XCTAssertEqual(approval.status, "pending")
    }

    func testApprovalRiskColors() {
        XCTAssertEqual(makeApproval(risk: "dangerous").riskColor, "red")
        XCTAssertEqual(makeApproval(risk: "elevated").riskColor, "orange")
        XCTAssertEqual(makeApproval(risk: "normal").riskColor, "yellow")
        XCTAssertEqual(makeApproval(risk: "anything-else").riskColor, "yellow")
    }

    func testTaskQueueResponseDecodes() throws {
        let json = """
        {
            "counts": {"inbox": 1, "ready": 2, "backlog": 3, "doing": 4, "blocked": 5},
            "tasks": {
                "doing": [{"id": "t1", "title": "Task 1", "priority": "p1", "area": "core", "summary": "s"}],
                "ready": []
            }
        }
        """.data(using: .utf8)!
        let resp = try decoder.decode(TaskQueueResponse.self, from: json)
        XCTAssertEqual(resp.counts.inbox, 1)
        XCTAssertEqual(resp.counts.ready, 2)
        XCTAssertEqual(resp.counts.backlog, 3)
        XCTAssertEqual(resp.counts.doing, 4)
        XCTAssertEqual(resp.counts.blocked, 5)
        XCTAssertEqual(resp.tasks.doing.count, 1)
        XCTAssertEqual(resp.tasks.doing[0].id, "t1")
        XCTAssertEqual(resp.tasks.ready.count, 0)
    }

    func testRunHistoryResponseDecodes() throws {
        let json = """
        {
            "runs": [
                {"id": "r1", "workflow": "builder", "status": "success", "startedAt": "t", "durationMs": 5000},
                {"id": "r2", "workflow": "critic", "status": "failed", "startedAt": "t", "durationMs": null}
            ]
        }
        """.data(using: .utf8)!
        let resp = try decoder.decode(RunHistoryResponse.self, from: json)
        XCTAssertEqual(resp.runs.count, 2)
        XCTAssertEqual(resp.runs[0].durationMs, 5000)
        XCTAssertNil(resp.runs[1].durationMs)
    }

    func testRunSummaryDurationDescription() {
        XCTAssertEqual(makeRun(ms: nil).durationDescription, "")
        XCTAssertEqual(makeRun(ms: 0).durationDescription, "")
        XCTAssertEqual(makeRun(ms: 5_000).durationDescription, "5s")
        XCTAssertEqual(makeRun(ms: 59_000).durationDescription, "59s")
        XCTAssertEqual(makeRun(ms: 60_000).durationDescription, "1m")
        XCTAssertEqual(makeRun(ms: 125_000).durationDescription, "2m 5s")
    }

    func testRunSummaryStatusIconAndColor() {
        XCTAssertEqual(makeRun(status: "success").statusIcon, "checkmark.circle.fill")
        XCTAssertEqual(makeRun(status: "success").statusColor, "green")
        XCTAssertEqual(makeRun(status: "failed").statusIcon, "xmark.circle.fill")
        XCTAssertEqual(makeRun(status: "failed").statusColor, "red")
        XCTAssertEqual(makeRun(status: "interrupted").statusIcon, "slash.circle.fill")
        XCTAssertEqual(makeRun(status: "interrupted").statusColor, "orange")
        XCTAssertEqual(makeRun(status: "completed-with-warnings").statusIcon, "exclamationmark.circle.fill")
        XCTAssertEqual(makeRun(status: "completed-with-warnings").statusColor, "yellow")
        XCTAssertEqual(makeRun(status: "unknown").statusIcon, "circle")
        XCTAssertEqual(makeRun(status: "unknown").statusColor, "secondary")
    }

    func testRunDetailCurrentStep() throws {
        let json = """
        {
            "id": "r1",
            "workflow": "builder",
            "status": "running",
            "startedAt": "t",
            "steps": [
                {"id": "s1", "type": "agent", "status": "success", "durationMs": 1000, "error": null, "costUsd": 0.1},
                {"id": "s2", "type": "agent", "status": "running", "durationMs": 500, "error": null, "costUsd": null}
            ]
        }
        """.data(using: .utf8)!
        let detail = try decoder.decode(RunDetail.self, from: json)
        XCTAssertEqual(detail.currentStep?.id, "s2")
    }

    func testRunDetailCurrentStepFallsBackToLast() throws {
        let json = """
        {
            "id": "r1",
            "workflow": "builder",
            "status": "success",
            "startedAt": "t",
            "steps": [
                {"id": "s1", "type": "agent", "status": "success", "durationMs": 1000, "error": null, "costUsd": 0.1},
                {"id": "s2", "type": "agent", "status": "success", "durationMs": 500, "error": null, "costUsd": null}
            ]
        }
        """.data(using: .utf8)!
        let detail = try decoder.decode(RunDetail.self, from: json)
        XCTAssertEqual(detail.currentStep?.id, "s2")
    }

    func testOwnerQuestionsResponseDecodes() throws {
        let json = """
        {
            "questions": [
                {
                    "id": "oq-1",
                    "context": "task-xyz",
                    "question": "Which approach should we take?",
                    "reason": "Ambiguous requirement",
                    "source": "builder",
                    "createdAt": "2026-04-17T00:00:00Z",
                    "status": "pending",
                    "proposedAnswers": ["Option A", "Option B"]
                },
                {
                    "id": "oq-2",
                    "context": "task-abc",
                    "question": "Proceed?",
                    "reason": "",
                    "source": "critic",
                    "createdAt": "2026-04-17T00:00:00Z",
                    "status": "answered"
                }
            ]
        }
        """.data(using: .utf8)!
        let resp = try decoder.decode(OwnerQuestionsResponse.self, from: json)
        XCTAssertEqual(resp.questions.count, 2)
        let first = resp.questions[0]
        XCTAssertEqual(first.id, "oq-1")
        XCTAssertEqual(first.source, "builder")
        XCTAssertEqual(first.status, "pending")
        XCTAssertEqual(first.proposedAnswers, ["Option A", "Option B"])
        XCTAssertNil(resp.questions[1].proposedAnswers)
    }

    func testSessionsResponseDecodes() throws {
        let json = """
        {"sessions": [{"id": "s1", "createdAt": "t", "lastActive": 1700000000.5}]}
        """.data(using: .utf8)!
        let resp = try decoder.decode(SessionsResponse.self, from: json)
        XCTAssertEqual(resp.sessions.count, 1)
        XCTAssertEqual(resp.sessions[0].id, "s1")
        XCTAssertEqual(resp.sessions[0].lastActive, 1700000000.5)
    }

    func testDaemonHealthProperties() {
        XCTAssertEqual(DaemonHealth.unknown.systemImageName, "circle")
        XCTAssertEqual(DaemonHealth.unknown.label, "KOTA")
        XCTAssertEqual(DaemonHealth.offline.systemImageName, "circle.slash")
        XCTAssertEqual(DaemonHealth.offline.label, "Daemon offline")
        XCTAssertEqual(DaemonHealth.idle.systemImageName, "checkmark.circle.fill")
        XCTAssertEqual(DaemonHealth.idle.label, "Idle")
        XCTAssertEqual(DaemonHealth.running(1).systemImageName, "arrow.2.circlepath.circle.fill")
        XCTAssertEqual(DaemonHealth.running(1).label, "1 run active")
        XCTAssertEqual(DaemonHealth.running(3).label, "3 runs active")
        XCTAssertEqual(DaemonHealth.error("boom").systemImageName, "exclamationmark.circle.fill")
        XCTAssertEqual(DaemonHealth.error("boom").label, "Error: boom")
    }

    func testTriggerRequestEncodes() throws {
        let req = TriggerRequest(workflow: "builder")
        let data = try JSONEncoder().encode(req)
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        XCTAssertEqual(obj?["workflow"] as? String, "builder")
    }

    func testCreateSessionResponseDecodes() throws {
        let json = """
        {"session_id": "sess-123"}
        """.data(using: .utf8)!
        let resp = try decoder.decode(CreateSessionResponse.self, from: json)
        XCTAssertEqual(resp.session_id, "sess-123")
    }

    // MARK: - Helpers

    private func makeApproval(risk: String) -> ApprovalRequest {
        let json = """
        {"id": "x", "tool": "t", "risk": "\(risk)", "reason": null, "createdAt": "", "status": "pending"}
        """.data(using: .utf8)!
        return try! decoder.decode(ApprovalRequest.self, from: json)
    }

    private func makeRun(ms: Double? = nil, status: String = "success") -> RunSummary {
        let durationJSON = ms.map { "\($0)" } ?? "null"
        let json = """
        {"id": "r", "workflow": "w", "status": "\(status)", "startedAt": "", "durationMs": \(durationJSON)}
        """.data(using: .utf8)!
        return try! decoder.decode(RunSummary.self, from: json)
    }
}
