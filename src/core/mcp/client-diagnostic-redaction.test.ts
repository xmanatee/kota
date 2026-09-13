import { describe, expect, it, vi } from "vitest";
import { MCP_CURRENT_PROTOCOL_VERSION, McpClient } from "./client.js";
import {
  jsonRpcHttpResponse,
  mockClientHttpFetch,
  waitForAssertion,
} from "./client-http-test-helpers.js";

function sseResponse(...messages: object[]): Response {
  return new Response(messages.map((message) => `data: ${JSON.stringify(message)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("MCP client diagnostic redaction", () => {
  it.each(["subscription", "subscription stream failure", "progress"] as const)(
    "redacts bearer credentials from %s diagnostics while preserving useful output",
    async (variant) => {
      const secret = "synthetic-mcp-credential.a+b[42]";
      const authorization = `Bearer ${secret}`;
      const chunks: string[] = [];
      const terminal = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        chunks.push(String(chunk));
        return true;
      });
      const progress = vi.fn();
      const http = mockClientHttpFetch((request) => {
        expect(request.headers.get("authorization")).toBe(authorization);
        if (request.body.method === "server/discover") {
          return jsonRpcHttpResponse(request.body.id, {
            supportedVersions: [MCP_CURRENT_PROTOCOL_VERSION],
            capabilities: { tools: { listChanged: variant !== "progress" } },
          });
        }
        if (request.body.method === "subscriptions/listen") {
          if (variant === "subscription stream failure") {
            return new Response(new ReadableStream({
              start(controller) {
                controller.error(new Error(`stream failed ${authorization} and ${secret}`));
              },
            }), { headers: { "content-type": "text/event-stream" } });
          }
          return sseResponse({
            jsonrpc: "2.0",
            id: request.body.id,
            error: { code: -32000, message: `subscription denied ${authorization} and ${secret}` },
          });
        }
        if (request.body.method === "tools/call") {
          return sseResponse(
            {
              jsonrpc: "2.0",
              method: "notifications/progress",
              params: { progressToken: `${authorization} and ${secret}`, progress: 1 },
            },
            {
              jsonrpc: "2.0",
              method: "notifications/progress",
              params: { progressToken: "active", progress: 2, message: "working" },
            },
            {
              jsonrpc: "2.0",
              id: request.body.id,
              result: { content: [{ type: "text", text: "finished" }] },
            },
          );
        }
        throw new Error(`Unexpected request: ${request.body.method}`);
      });
      const client = new McpClient({
        type: "http",
        url: "https://mcp.example.test/mcp",
        headers: { Authorization: authorization },
      }, `peer-${secret}`);
      try {
        await client.connect();
        if (variant === "progress") {
          await expect(client.callTool("work", {}, undefined, {
            progress: { token: "active", onProgress: progress },
          })).resolves.toMatchObject({ content: [{ type: "text", text: "finished" }] });
          expect(progress).toHaveBeenCalledOnce();
          expect(progress).toHaveBeenCalledWith(expect.objectContaining({ progress: 2, message: "working" }));
        }
        const expected = variant === "progress"
          ? 'ignored progress notification for inactive token "[redacted] and [redacted]"'
          : variant === "subscription"
            ? "failed to open subscription: MCP error -32000: subscription denied [redacted] and [redacted]"
            : "failed to open subscription: stream failed [redacted] and [redacted]";
        await waitForAssertion(() => expect(chunks.join("")).toContain(expected));
        expect(chunks.join("")).toContain('MCP server "peer-[redacted]"');
        expect(chunks.join("")).not.toContain(secret);
      } finally {
        await client.close();
        http.mockRestore();
        terminal.mockRestore();
      }
    },
  );
});
