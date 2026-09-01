import XCTest
@testable import KotaShared

final class DaemonContractGeneratedTests: XCTestCase {
    func testCaptureWriteFailureForRepoTargetsDecodesGenericFailureVariant() throws {
        let targets: [(wire: String, expected: CaptureTarget)] = [
            ("tasks", .tasks),
            ("inbox", .inbox),
        ]

        for target in targets {
            let data = """
                {"ok":false,"reason":"write_failed","target":"\(target.wire)","message":"disk full"}
                """.data(using: .utf8)!
            let result = try JSONDecoder().decode(CaptureResult.self, from: data)

            XCTAssertEqual(result, .writeFailed(target: target.expected, message: "disk full"))
        }
    }
}
