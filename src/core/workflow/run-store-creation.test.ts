import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/usage.js";
import { WorkflowRunStore } from "./run-store.js";
import type { WorkflowDefinition } from "./types.js";

const minimalWorkflow: WorkflowDefinition = {
  name: "builder", enabled: true, repository: "read", tags: [],
  definitionPath: "workflows/builder.ts", moduleRoot: "/module", triggers: [], steps: [],
};
let workspaceRoot: string;
let store: WorkflowRunStore;
beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), "kota-run-creation-"));
  store = new WorkflowRunStore(workspaceRoot);
});
afterEach(() => rmSync(workspaceRoot, { recursive: true, force: true }));

it.each([
  { name: "absent", definition: [], payload: {}, tags: undefined },
  { name: "trigger", definition: [], payload: { tags: ["alpha"] }, tags: ["alpha"] },
  { name: "definition", definition: ["alpha"], payload: {}, tags: ["alpha"] },
  { name: "merged", definition: ["alpha"], payload: { tags: ["beta", "alpha"] }, tags: ["alpha", "beta"] },
  { name: "invalid trigger", definition: ["alpha"], payload: { tags: ["beta", 17] }, tags: ["alpha"] },
])("persists $name tags and filters reopened history", ({ definition, payload, tags }) => {
  const handle = store.createRun({ ...minimalWorkflow, tags: definition },
    { event: "manual", schemaRef: null, payload }, "selected");
  store.createRun(minimalWorkflow, { event: "manual", schemaRef: null, payload: {} }, "other");
  const reopened = new WorkflowRunStore(workspaceRoot);
  expect(reopened.getRun(handle.metadata.id)?.tags).toEqual(tags);
  expect(reopened.listRuns()).toHaveLength(2);
  expect(reopened.listRuns({ tag: "alpha" }).map((run) => run.id)).toEqual(tags ? ["selected"] : []);
  expect(reopened.listRuns({ tag: "missing" })).toEqual([]);
});

it("lists valid evidence alongside terminal malformed history while direct lookup rejects it", () => {
  mkdirSync(join(store.runsDir, "historical"));
  writeFileSync(join(store.runsDir, "historical", "metadata.json"), JSON.stringify({ id: "historical", status: "success" }));
  store.createRun(minimalWorkflow, { event: "manual", schemaRef: null, payload: {} }, "valid");
  expect(store.listRuns().map((run) => run.id)).toEqual(["valid"]);
  expect(() => store.getRun("historical")).toThrow();
});

it("scopes durable run trigger, metadata, agent inputs, messages, and step artifacts", () => {
  const secret = "storage-secret-token";
  const trigger = {
    event: "manual",
    schemaRef: null,
    payload: {
      token: secret,
      email: "owner@example.test",
      triggeredAt: new Date().toISOString(),
    },
  };
  const handle = store.createRun(minimalWorkflow, trigger);
  const runDir = join(workspaceRoot, handle.metadata.runDir);

  handle.writeAgentInputs(
    "agent",
    `system prompt ${secret}`,
    `user prompt ${secret}`,
  );
  handle.appendAgentMessage("agent", {
    type: "thinking",
    thinking: `private reasoning ${secret}`,
  });
  handle.appendAgentMessage("agent", {
    type: "tool_result",
    toolUseId: "tool-1",
    isError: false,
    content: `tool output ${secret}`,
  });
  handle.recordStep({
    id: "agent",
    type: "agent",
    status: "success",
    startedAt: new Date(1700000000000).toISOString(),
    completedAt: new Date(1700000001000).toISOString(),
    durationMs: 1000,
    output: { toolResult: `raw output ${secret}` },
    usage: UNKNOWN_AGENT_USAGE,
  });
  handle.finish({
    status: "failed",
    durationMs: 1000,
    error: `terminal error ${secret}`,
  });

  const durableText = [
    readFileSync(join(runDir, "trigger.json"), "utf-8"),
    readFileSync(join(runDir, "metadata.json"), "utf-8"),
    readFileSync(join(runDir, "steps", "agent.input.md"), "utf-8"),
    readFileSync(join(runDir, "steps", "agent.events.jsonl"), "utf-8"),
    readFileSync(join(runDir, "steps", "agent.json"), "utf-8"),
    readFileSync(join(runDir, "error.txt"), "utf-8"),
  ].join("\n");

  expect(durableText).not.toContain(secret);
  expect(durableText).not.toContain("owner@example.test");
  expect(durableText).toContain('"redacted":true');
});
