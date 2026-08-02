import { describe, expect, it } from "vitest";
import { createWorkflowAgentGuards } from "./guards.js";

const options = {
  signal: new AbortController().signal,
  toolUseId: "scope-authority-test",
};

describe("workflow agent machine-authority guard", () => {
  it("denies authority mutations through the CLI and direct control route", async () => {
    const guard = createWorkflowAgentGuards();
    for (const command of [
      "pnpm kota project authority set scope-1 --trust trusted --reason unsafe",
      "kota project authority set scope-1 --clear-policy --reason unsafe",
      "node dist/cli.js project authority set scope-1 --trust trusted --reason unsafe",
      "curl -X PUT http://127.0.0.1:4310/scopes/scope-1/authority -d '{}';",
      "fetch('http://127.0.0.1:4310/scopes/scope-1/authority', { method: 'PUT' })",
    ]) {
      const result = await guard("Bash", { command }, options);
      expect(result).toMatchObject({
        behavior: "deny",
        decisionAttribution: "operator-deny",
      });
      if (result.behavior === "deny") {
        expect(result.message).toMatch(/interactive operator client/);
      }
    }
  });

  it("denies authority-token access through read and arbitrary-code tools", async () => {
    const guard = createWorkflowAgentGuards();
    for (const [toolName, input] of [
      ["Read", { file_path: "/Users/operator/.kota/scope-authority-token.json" }],
      ["code_exec", { code: "readFileSync('/tmp/scope-authority-token.json')" }],
      ["Bash", { command: "cat ~/.kota/scope-authority-token.json" }],
    ] as const) {
      const result = await guard(toolName, input, options);
      expect(result).toMatchObject({
        behavior: "deny",
        decisionAttribution: "operator-deny",
      });
      if (result.behavior === "deny") {
        expect(result.message).toMatch(/operator token/);
      }
    }
  });
});
