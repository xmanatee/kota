import XCTest
@testable import KotaShared

final class ApprovalReviewModelsTests: XCTestCase {
    func testApprovalReviewPreservesSafeOperationAndDigest() throws {
        let data = """
        {
          "approvals": [{
            "id": "a1",
            "tool": "shell",
            "risk": "dangerous",
            "reason": "deploy",
            "createdAt": "t",
            "status": "pending",
            "review": {
              "status": "available",
              "input": {
                "command": "deploy --target /srv/app",
                "authorization": "[redacted]"
              },
              "context": "user: deploy the client release",
              "digest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
            }
          }]
        }
        """.data(using: .utf8)!

        let approval = try JSONDecoder().decode(ApprovalsResponse.self, from: data).approvals[0]

        XCTAssertTrue(approval.reviewIsAvailable)
        XCTAssertTrue(approval.reviewInputText?.contains("deploy --target /srv/app") == true)
        XCTAssertTrue(approval.reviewInputText?.contains("[redacted]") == true)
        XCTAssertEqual(approval.reviewContext, "user: deploy the client release")
        XCTAssertEqual(approval.reviewDigest, String(repeating: "a", count: 64))
    }

    func testMissingReviewFailsClosedAsUnavailable() throws {
        let data = """
        {
          "approvals": [{
            "id": "legacy",
            "tool": "shell",
            "risk": "dangerous",
            "reason": "deploy",
            "createdAt": "t",
            "status": "pending"
          }]
        }
        """.data(using: .utf8)!

        let approval = try JSONDecoder().decode(ApprovalsResponse.self, from: data).approvals[0]

        XCTAssertFalse(approval.reviewIsAvailable)
        XCTAssertNil(approval.reviewInputText)
        XCTAssertNil(approval.reviewDigest)
    }
}
