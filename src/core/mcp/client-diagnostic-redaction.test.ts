import { describe, expect, it, vi } from "vitest";
import { MCP_CURRENT_PROTOCOL_VERSION, MCP_TASKS_EXTENSION_ID, McpClient } from "./client.js";
import { McpAuthorizationError, mcpAuthorizationChallengeForRetry } from "./client-auth-types.js";
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
  it.each(["tools/call", "resources/read", "prompts/get", "tasks/get"] as const)(
    "redacts %s decoder errors without changing valid protocol keys",
    async (method) => {
      const secret = "synthetic-input-request-credential";
      let operationCalls = 0;
      const http = mockClientHttpFetch((request) => {
        if (request.body.method === "server/discover") {
          return jsonRpcHttpResponse(request.body.id, {
            supportedVersions: [MCP_CURRENT_PROTOCOL_VERSION],
            capabilities: { tools: {}, resources: {}, prompts: {}, extensions: { [MCP_TASKS_EXTENSION_ID]: {} } },
          });
        }
        expect(request.body.method).toBe(method);
        operationCalls++;
        const inputRequests = { [secret]: operationCalls === 1 ? null : {
          method: "elicitation/create", params: { mode: "form", message: "Provide input" },
        } };
        return jsonRpcHttpResponse(request.body.id, method === "tasks/get" ? {
          taskId: "task-1", status: "input_required", createdAt: "2026-09-13T00:00:00Z",
          lastUpdatedAt: "2026-09-13T00:00:00Z", ttlMs: null, inputRequests,
        } : { resultType: "input_required", inputRequests });
      });
      const client = new McpClient({ type: "http", url: "https://mcp.example.test/mcp", headers: { Authorization: `Bearer ${secret}` } }, "decoder-peer", { enableRemoteTasks: true });
      const invoke = () => {
        switch (method) {
          case "tools/call": return client.callTool("work", {});
          case "resources/read": return client.readResource("file:///document");
          case "prompts/get": return client.getPrompt("work");
          case "tasks/get": return client.getTask("task-1");
        }
      };
      try {
        await client.connect();
        const error = await invoke().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) throw new Error("Expected decoder rejection");
        expect(error.message).toContain(`Malformed MCP ${method} result: inputRequests.[redacted] must be an object`);
        expect([error.message, error.stack, JSON.stringify(error)].join("\n")).not.toContain(secret);
        expect(await invoke()).toMatchObject({ inputRequests: { [secret]: { method: "elicitation/create" } } });
      } finally {
        await client.close();
        http.mockRestore();
      }
    },
  );

  it.each(["tools/call", "resources/read", "prompts/get", "tasks/update"] as const)(
    "redacts peer-supplied retry keys rejected by %s validation",
    async (method) => {
      const secret = "synthetic-retry-key-credential";
      const http = mockClientHttpFetch((request) => jsonRpcHttpResponse(request.body.id, {
        supportedVersions: [MCP_CURRENT_PROTOCOL_VERSION],
        capabilities: { tools: {}, resources: {}, prompts: {}, extensions: { [MCP_TASKS_EXTENSION_ID]: {} } },
      }));
      const client = new McpClient({ type: "http", url: "https://mcp.example.test/mcp", headers: { "X-Api-Key": secret } }, "retry-peer", { enableRemoteTasks: true });
      const retry = { inputRequests: {}, inputResponses: { [secret]: { action: "accept" as const } } };
      const invoke = () => {
        switch (method) {
          case "tools/call": return client.callTool("work", {}, retry);
          case "resources/read": return client.readResource("file:///document", retry);
          case "prompts/get": return client.getPrompt("work", {}, retry);
          case "tasks/update": return client.updateTask("task-1", retry);
        }
      };
      try {
        await client.connect();
        const error = await invoke().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) throw new Error("Expected retry rejection");
        expect(error.message).toContain("inputResponses.[redacted] does not match an input request");
        expect([error.message, error.stack, JSON.stringify(error)].join("\n")).not.toContain(secret);
        expect(http.requests).toHaveLength(1);
      } finally {
        await client.close();
        http.mockRestore();
      }
    },
  );

  it.each(["application/json", "text/event-stream"])("redacts %s body-read failures", async (contentType) => {
    const secret = "synthetic-reader-credential";
    const http = mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, { supportedVersions: [MCP_CURRENT_PROTOCOL_VERSION], capabilities: { tools: {} } });
      }
      return new Response(new ReadableStream({
        start(controller) { controller.error(new Error(`reader failed ${secret}`)); },
      }), { headers: { "content-type": contentType } });
    });
    const client = new McpClient({ type: "http", url: "https://mcp.example.test/mcp", headers: { "X-Api-Key": secret } });
    try {
      await client.connect();
      const error = await client.callTool("work", {}).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw new Error("Expected reader failure");
      expect(error.message).toContain("reader failed [redacted]");
      expect([error.message, error.stack, JSON.stringify(error)].join("\n")).not.toContain(secret);
    } finally {
      await client.close();
      http.mockRestore();
    }
  });

  it("redacts peer labels from lifecycle errors before and after HTTP close", async () => {
    const secret = "synthetic-lifecycle-credential";
    const http = mockClientHttpFetch((request) => jsonRpcHttpResponse(request.body.id, {
      supportedVersions: [MCP_CURRENT_PROTOCOL_VERSION],
      serverInfo: { name: `peer-${secret}`, version: "1" }, capabilities: { tools: {} },
    }));
    const client = new McpClient({
      type: "http", url: "https://mcp.example.test/mcp", headers: { Authorization: `Bearer ${secret}` },
    });
    const expectRedacted = async (operation: Promise<unknown>, reason: string) => {
      const error = await operation.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw new Error("Expected lifecycle rejection");
      expect(error.message).toBe(`MCP server "peer-[redacted]" ${reason}`);
      expect([error.message, error.stack, JSON.stringify(error)].join("\n")).not.toContain(secret);
    };
    try {
      await client.connect();
      await expectRedacted(client.connect(), "is already connected");
      await client.close();
      await expectRedacted(client.callTool("work", {}), "is closed");
      await expectRedacted(client.listTools(), "is closed");
      await expectRedacted(client.connect(), "is closed");
      expect(http.requests).toHaveLength(1);
      expect(client.getName()).toBe(`peer-${secret}`);
    } finally {
      await client.close();
      http.mockRestore();
    }
  });

  it.each(["catalog", "skill index"] as const)("redacts peer labels from %s decoding failures", async (variant) => {
    const secret = "synthetic-decoder-credential";
    const http = mockClientHttpFetch((request) => {
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_CURRENT_PROTOCOL_VERSION],
          serverInfo: { name: `peer-${secret}`, version: "1" }, capabilities: { tools: {}, resources: {} },
        });
      }
      return jsonRpcHttpResponse(request.body.id, variant === "catalog"
        ? { tools: null }
        : { contents: [{ uri: request.body.params?.uri, text: "{}" }] });
    });
    const client = new McpClient({ type: "http", url: "https://mcp.example.test/mcp", headers: { "X-Api-Key": secret } });
    try {
      await client.connect();
      const error = await (variant === "catalog" ? client.listTools() : client.listRemoteSkills())
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw new Error("Expected decoding failure");
      expect(error.message).toContain('server "peer-[redacted]"');
      expect(error.message).toContain(variant === "catalog" ? "tools/list failed" : "Malformed MCP skill index");
      expect([error.message, error.stack, JSON.stringify(error)].join("\n")).not.toContain(secret);
    } finally {
      await client.close();
      http.mockRestore();
    }
  });

  it.each([
    { header: "X-Api-Key", value: "synthetic-api.a+b[42]", components: ["synthetic-api.a+b[42]"] },
    { header: "cOoKiE", value: 'session=synthetic-session==; refresh="synthetic-refresh"; empty=', components: ["synthetic-session==", "synthetic-refresh"] },
    { header: "Authorization", value: "Basic dXNlcjpzeW50aGV0aWMtcGFzcw==", components: ["dXNlcjpzeW50aGV0aWMtcGFzcw==", "synthetic-pass"] },
    { header: "Proxy-Authorization", value: "Bearer synthetic-proxy", components: ["synthetic-proxy"] },
  ])("redacts $header echoes from public warnings and request errors", async ({ header, value, components }) => {
    const echo = [value, ...components].join(" | ");
    const chunks: string[] = [];
    const terminal = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    const http = mockClientHttpFetch((request) => {
      expect(request.headers.get(header)).toBe(value);
      if (request.body.method === "server/discover") {
        return jsonRpcHttpResponse(request.body.id, {
          supportedVersions: [MCP_CURRENT_PROTOCOL_VERSION], capabilities: { tools: {} },
        });
      }
      return sseResponse(
        { jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: echo, progress: 1 } },
        { jsonrpc: "2.0", id: request.body.id, error: { code: -32000, message: `denied ${echo}; trace-readable` } },
      );
    });
    const client = new McpClient({ type: "http", url: "https://mcp.example.test/mcp", headers: { [header]: value, "X-Trace": "trace-readable" } });
    try {
      await client.connect();
      const error = await client.callTool("work", {}).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      if (!(error instanceof Error)) throw new Error("Expected request failure");
      expect(error.message).toContain("denied [redacted]");
      expect(error.message).toContain("trace-readable");
      expect(chunks.join("")).toContain('inactive token "[redacted]');
      for (const credential of [value, ...components]) {
        expect([error.message, error.stack, JSON.stringify(error), chunks.join("")].join("\n")).not.toContain(credential);
      }
    } finally {
      await client.close();
      http.mockRestore();
      terminal.mockRestore();
    }
  });

  it.each(["tool", "catalog", "authorization", "authorization flow"] as const)(
    "redacts peer labels from complete %s errors and their metadata",
    async (variant) => {
      const secret = "synthetic-label-credential";
      const peerName = `peer-${secret}`;
      const header = variant === "authorization flow" ? "X-Api-Key" : "Authorization";
      const headerValue = variant === "authorization flow" ? secret : `Bearer ${secret}`;
      const http = mockClientHttpFetch((request) => {
        if (request.method === "GET") return new Response(null, { status: 404 });
        expect(request.headers.get(header)).toBe(headerValue);
        if (request.body.method === "server/discover") {
          return jsonRpcHttpResponse(request.body.id, {
            supportedVersions: [MCP_CURRENT_PROTOCOL_VERSION],
            serverInfo: { name: peerName, version: "1" }, capabilities: { tools: {} },
          });
        }
        if (variant === "authorization" || variant === "authorization flow") {
          return new Response(null, { status: 403, headers: { "www-authenticate": `Bearer error="insufficient_scope", scope="${secret}"` } });
        }
        return sseResponse({ jsonrpc: "2.0", id: request.body.id, error: { code: -32000, message: "operation denied" } });
      });
      const client = new McpClient({
        type: "http", url: "https://mcp.example.test/mcp", headers: { [header]: headerValue },
        ...(variant === "authorization flow" ? {
          authorization: {
            type: "oauth" as const, issuer: "https://auth.example.test",
            redirectUri: "http://localhost/callback", scopes: [],
            client: { kind: "registered" as const, clientId: "test-client" },
          },
        } : {}),
      });
      try {
        await client.connect();
        const operation = variant === "catalog" ? client.listTools() : client.callTool("work", {});
        const error = await operation.catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) throw new Error("Expected request failure");
        expect(error.message).toContain('server "peer-[redacted]"');
        expect(error).toMatchObject({ serverName: "peer-[redacted]" });
        if (variant !== "authorization flow") {
          expect(error).toMatchObject({ method: variant === "catalog" ? "tools/list" : "tools/call" });
        }
        if (error instanceof McpAuthorizationError) {
          expect(error.challenge.scopes).toEqual(["[redacted]"]);
          expect(mcpAuthorizationChallengeForRetry(error).scopes).toEqual([secret]);
        }
        expect([error.message, error.stack, JSON.stringify(error)].join("\n")).not.toContain(secret);
        // Diagnostic projections must not rewrite the identity or credentials used by the protocol.
        expect(client.getName()).toBe(peerName);
      } finally {
        await client.close();
        http.mockRestore();
      }
    },
  );

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
