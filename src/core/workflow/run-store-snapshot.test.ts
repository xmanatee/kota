import { expect, it } from "vitest";
import { buildWorkflowSnapshot } from "./run-store-snapshot.js";
import type { WorkflowStep } from "./step-types.js";
import type { WorkflowDefinition } from "./types.js";

const workflow: WorkflowDefinition = {
  name: "builder", description: "Build a task", enabled: true, repository: "read", tags: [],
  definitionPath: "workflows/builder.ts", moduleRoot: "/module",
  triggers: [{ event: "manual", cooldownMs: 0 }], steps: [],
};

it("projects workflow identity, triggers and optional defaults into persisted evidence", () => {
  const { description, ...withoutDescription } = workflow;
  for (const input of [withoutDescription, { ...workflow, defaultAutonomyMode: "autonomous" as const }]) {
    const { name, enabled, definitionPath, triggers, ...rest } = input;
    expect(buildWorkflowSnapshot(input)).toEqual({
      name, enabled, definitionPath, triggers, steps: [],
      description: "description" in rest ? description : undefined,
      defaultAutonomyMode: "defaultAutonomyMode" in rest ? rest.defaultAutonomyMode : undefined,
    });
  }
});

it.each([
  { step: { id: "tool", type: "tool", tool: "Bash" }, projection: { tool: "Bash" } },
  { step: { id: "emit", type: "emit", event: "workflow.done" }, projection: { event: "workflow.done" } },
  { step: { id: "restart", type: "restart", requires: ["prepare"] }, projection: { requires: ["prepare"] } },
  { step: { id: "code", type: "code", run: () => ({}) }, projection: {} },
] satisfies Array<{ step: WorkflowStep; projection: object }>)(
  "projects $step.type steps and preserves exposed-output trust without executable callbacks", ({ step, projection }) => {
    for (const metadata of [
      {}, { exposeOutputToAgent: true }, { continueOnFailure: true },
      { exposeOutputToAgent: true, exposedOutputTrust: "untrusted" as const },
    ]) {
      expect(buildWorkflowSnapshot({ ...workflow, steps: [{ ...step, ...metadata }] }).steps).toEqual([
        { id: step.id, type: step.type, ...projection, ...metadata },
      ]);
    }
  },
);

it.each([false, true])("projects agent constraints with validation buffering=%s", (validated) => {
  const agent: WorkflowStep = {
    id: "agent", type: "agent", promptPath: "prompt.md", harness: "codex", moduleRoot: "/module",
    model: "example-model", effort: "high", autonomyMode: "passive", maxTurns: 4,
    allowedTools: ["read"], disallowedTools: ["write"],
    exposeOutputToAgent: true, exposedOutputTrust: "untrusted", continueOnFailure: true,
    ...(validated ? { validate: () => "accepted" } : {}),
  };
  expect(buildWorkflowSnapshot({ ...workflow, steps: [agent] }).steps).toEqual([{
    id: "agent", type: "agent", promptPath: "prompt.md", model: "example-model", effort: "high",
    autonomyMode: "passive", maxTurns: 4, allowedTools: ["read"], disallowedTools: ["write"],
    exposeOutputToAgent: true, exposedOutputTrust: "untrusted", continueOnFailure: true,
    ...(validated ? { agentMessageStreamPolicy: "buffer-until-validation-success" } : {}),
  }]);
});
