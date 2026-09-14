import { rmSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { getScopeSecretStore, resetSecretStores } from "#core/config/secrets.js";
import { jsonRpcHttpResponse, mockClientHttpFetch } from "#core/mcp/client-http-test-helpers.js";
import { MCP_STATELESS_PROTOCOL_VERSION } from "#core/mcp/client-protocol.js";
import { McpManager } from "#core/mcp/manager.js";
import { executeToolCalls } from "#core/tools/tool-runner.js";
import { extractToolResultContent } from "#modules/model-clients/openai/tool-result-projection.js";

// Detect a disclosure across MCP decoding, schema validation, runner masking and
// model projection. Only the peer HTTP port and host credential locations vary.
const host = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (original) => {
  const os = await original<typeof import("node:os")>();
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  host.home = mkdtempSync(join(os.tmpdir(), "kota-structured-masking-"));
  return { ...os, homedir: () => host.home, platform: () => "linux" };
});

afterEach(() => resetSecretStores());
afterAll(() => rmSync(host.home, { recursive: true, force: true }));

const credential = 'synthetic-credential-"quoted"-\\-123456';
const masked = "<secret:STRUCTURED_TEST_TOKEN>";
const cases: { name: string; raw: KotaJsonValue; expected: KotaJsonValue }[] = [
  { name: "scalar string", raw: credential, expected: masked },
  {
    name: "nested object",
    raw: { nested: { token: credential, message: `before ${credential} after` }, [credential]: "public" },
    expected: { nested: { token: masked, message: `before ${masked} after` }, [masked]: "public" },
  },
  {
    name: "array",
    raw: [credential, { nested: [credential, "public", "", 0, false, null] }],
    expected: [masked, { nested: [masked, "public", "", 0, false, null] }],
  },
  ...[null, false, 0, "", [], {}].map((raw) => ({ name: `nonsecret ${JSON.stringify(raw)}`, raw, expected: raw })),
];

describe("structured tool results reaching the model", () => {
  it.each(cases)("masks $name after authoritative schema validation", async ({ raw, expected }) => {
    getScopeSecretStore(host.home).set("STRUCTURED_TEST_TOKEN", credential);
    let invalid = false;
    const fetch = mockClientHttpFetch(({ body }) => {
      if (body.method === "server/discover") return jsonRpcHttpResponse(body.id, {
        resultType: "complete", ttlMs: 0, cacheScope: "private",
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "masking-peer", version: "1" } },
        supportedVersions: [MCP_STATELESS_PROTOCOL_VERSION], capabilities: { tools: {} },
      });
      if (body.method === "tools/list") return jsonRpcHttpResponse(body.id, {
        resultType: "complete", ttlMs: 0, cacheScope: "private", tools: [{
          name: "echo", annotations: { readOnlyHint: true },
          inputSchema: { type: "object", properties: {} },
          outputSchema: { const: raw },
        }],
      });
      expect(body.method).toBe("tools/call");
      return jsonRpcHttpResponse(body.id, {
        resultType: "complete", content: [{ type: "text", text: `public ${credential}` }],
        structuredContent: invalid ? { rejected: credential } : raw,
      });
    });
    const manager = new McpManager();
    try {
      await manager.initialize({ mcpServers: { masking: { type: "http", url: "https://masking.example.test/mcp" } } });
      const [tool] = manager.getTools();
      expect(tool).toBeDefined();
      const invoke = async () => (await executeToolCalls(
        [{ type: "tool_use", id: "masking-call", name: tool.name, input: {} }],
        { resultLimit: 50000, verbose: false, autonomyMode: "autonomous", mcpManager: manager },
      ))[0];
      const result = await invoke();
      expect(result.is_error).not.toBe(true);
      expect(result.content).toBe(`public ${masked}`);
      expect(result.blocks).toEqual([{ type: "text", text: `public ${masked}` }]);
      expect(result.structuredContent).toEqual(expected);
      const projection = extractToolResultContent({ ...result, type: "tool_result", content: result.blocks ?? result.content });
      expect(projection).toContain("[structuredContent]");
      expect(projection).toContain("public");
      expect(projection).toContain(masked);
      expect(projection).not.toContain("synthetic-credential");
      // Rejection still uses the original peer value, even though projection
      // deliberately changes strings that the peer's const schema requires.
      invalid = true;
      const rejected = await invoke();
      expect(rejected.is_error).toBe(true);
      expect(rejected.structuredContent).toBeUndefined();
      expect(JSON.stringify(rejected)).not.toContain("synthetic-credential");
    } finally {
      await manager.close();
      fetch.mockRestore();
    }
  });
});
