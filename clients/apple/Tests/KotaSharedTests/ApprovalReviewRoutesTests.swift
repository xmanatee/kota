import Foundation
import XCTest
@testable import KotaShared

@MainActor
final class ApprovalReviewRoutesTests: XCTestCase {
    func testApproveSendsDisplayedReviewDigest() async throws {
        URLProtocol.registerClass(MockURLProtocol.self)
        defer { URLProtocol.unregisterClass(MockURLProtocol.self) }

        let digest = String(repeating: "a", count: 64)
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/approvals/approval-1/approve")
            XCTAssertEqual(request.httpMethod, "POST")
            let body = request.readBody()
            let object = try? JSONSerialization.jsonObject(with: body!) as? [String: Any]
            XCTAssertEqual(object?["reviewDigest"] as? String, digest)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil
            )!
            return (response, Data())
        }

        let client = DaemonClient()
        client.setRemoteConnection(
            url: URL(string: "http://127.0.0.1:8765")!,
            token: "test-token"
        )
        try await client.approve(id: "approval-1", reviewDigest: digest)
    }
}

private extension URLRequest {
    func readBody() -> Data? {
        if let body = httpBody { return body }
        guard let stream = httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        let bufferSize = 1024
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let read = stream.read(buffer, maxLength: bufferSize)
            if read <= 0 { break }
            data.append(buffer, count: read)
        }
        return data
    }
}
