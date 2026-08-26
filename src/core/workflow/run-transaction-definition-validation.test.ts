import { describe, expect, it } from "vitest";
import {
  daemonWriteEffect,
  localWriteEffect,
  readOnlyLocalEffect,
} from "#core/tools/effect.js";
import { deregisterTool, registerTool } from "#core/tools/index.js";
import type { RepositoryAccess } from "./run-sandbox.js";
import type { WorkflowStepInput } from "./step-input-types.js";
import type { WorkflowDefinitionInput } from "./types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
  WorkflowDefinitionError,
} from "./validation.js";

function workflow(
  repository: RepositoryAccess,
  integration?: WorkflowDefinitionInput["integration"],
  steps: WorkflowStepInput[] = [{
    id: "record-result",
    type: "emit",
    event: "test.run-transaction.completed",
  }],
) {
  return registerWorkflowDefinition("test/run-transaction.ts", {
    name: "run-transaction",
    repository,
    ...(integration === undefined ? {} : { integration }),
    triggers: [{ event: "manual" }],
    steps,
  });
}

const integration = { validationCommand: ["pnpm", "test"] as const };

describe("workflow run transaction definition", () => {
  it("rejects an external definition that omits repository authority", () => {
    const missingRepository = {
      name: "missing-repository",
      definitionPath: "external/missing-repository.ts",
      triggers: [{ event: "manual" }],
      steps: [{ id: "record-result", type: "emit", event: "test.completed" }],
    } as unknown as Parameters<typeof validateWorkflowDefinitions>[0][number];

    expect(() => validateWorkflowDefinitions([missingRepository])).toThrow(
      'repository is required and must explicitly declare "none", "read", or "write"',
    );
  });

  it("requires an integration policy for repository writers", () => {
    expect(() => validateWorkflowDefinitions([
      workflow("write"),
    ])).toThrow(WorkflowDefinitionError);
    expect(() => validateWorkflowDefinitions([
      workflow("write"),
    ])).toThrow(/requests write access but has no integration policy/);
  });

  it.each(["none", "read"] as const)(
    "rejects integration for %s-only repository access",
    (repository) => {
      expect(() => validateWorkflowDefinitions([
        workflow(repository, integration),
      ])).toThrow(WorkflowDefinitionError);
      expect(() => validateWorkflowDefinitions([
        workflow(repository, integration),
      ])).toThrow(/declares integration but does not request write access/);
    },
  );

  it("accepts an integration policy for a repository writer", () => {
    const [validated] = validateWorkflowDefinitions([
      workflow("write", integration),
    ]);

    expect(validated).toMatchObject({
      repository: "write",
      integration,
    });
  });

  it("preserves a writer's semantic post-reconcile invariant", () => {
    const postReconcile = () => ({ satisfied: true } as const);
    const [validated] = validateWorkflowDefinitions([
      workflow("write", { ...integration, postReconcile }),
    ]);

    expect(validated.integration?.postReconcile).toBe(postReconcile);
  });

  it("disables owner questions for every writer-launched agent contract", () => {
    const [validated] = validateWorkflowDefinitions([
      workflow("write", integration, [
        {
          id: "writer-agent",
          type: "agent",
          harness: "writer-transaction-fixture",
          promptPath: "src/modules/autonomy/workflows/improver/prompt.md",
          model: "fixture-model",
          effort: "medium",
          autonomyMode: "autonomous",
          repairLoop: {
            checks: [{
              id: "judge",
              type: "code",
              resolveAgentContract: () => ({
                harness: "writer-transaction-fixture",
                model: "fixture-model",
                effort: "medium",
                autonomyMode: "autonomous",
                ownerQuestionAccess: "available",
              }),
              run: () => "ok",
            }],
          },
        },
        {
          id: "code-agent",
          type: "code",
          resolveAgentContract: () => ({
            harness: "writer-transaction-fixture",
            model: "fixture-model",
            effort: "medium",
            autonomyMode: "autonomous",
            ownerQuestionAccess: "available",
          }),
          run: () => "ok",
        },
      ]),
    ], process.cwd(), { defaultAgentHarness: "writer-transaction-fixture" });

    const agent = validated.steps[0];
    const code = validated.steps[1];
    expect(agent.type).toBe("agent");
    expect(code.type).toBe("code");
    if (agent.type !== "agent" || code.type !== "code") return;
    expect(agent.ownerQuestionAccess).toBe("disabled");
    expect(agent.repairLoop?.checks[0]?.type).toBe("code");
    const judge = agent.repairLoop?.checks[0];
    if (judge?.type !== "code" || !judge.resolveAgentContract) return;
    expect(judge.resolveAgentContract(agent).ownerQuestionAccess).toBe("disabled");
    expect(code.resolveAgentContract?.({} as never).ownerQuestionAccess).toBe("disabled");
  });

  it.each([
    {
      label: "approval",
      step: { id: "approve", type: "approval" } as const,
    },
    {
      label: "await-event",
      step: {
        id: "wait",
        type: "await-event",
        event: "owner.answered",
        matchValue: "question-1",
      } as const,
    },
  ])("rejects a pre-integration $label step", ({ label, step }) => {
    expect(() =>
      validateWorkflowDefinitions([workflow("write", integration, [step])])
    ).toThrow(`cannot contain ${label} step`);
  });

  it("rejects a restart request before integration", () => {
    expect(() =>
      validateWorkflowDefinitions([workflow("write", integration, [
        {
          id: "verify",
          type: "code",
          run: () => ({ ok: true }),
        },
        {
          id: "restart",
          type: "restart",
          requires: ["verify"],
        },
      ])])
    ).toThrow("cannot contain restart step");
  });

  it("rejects a child workflow trigger before integration", () => {
    const child = registerWorkflowDefinition("test/child.ts", {
      name: "transaction-child",
      repository: "none",
      triggers: [{ event: "manual" }],
      steps: [{ id: "done", type: "emit", event: "transaction.child.done" }],
    });
    expect(() =>
      validateWorkflowDefinitions([
        workflow("write", integration, [{
          id: "trigger-child",
          type: "trigger",
          workflow: "transaction-child",
        }]),
        child,
      ])
    ).toThrow("cannot contain trigger step");
  });

  it("accepts run-local tools and rejects shared or unverifiable tools", () => {
    const readTool = "writer_transaction_read_fixture";
    const writeTool = "writer_transaction_write_fixture";
    const sharedTool = "writer_transaction_shared_fixture";
    const tool = (name: string) => ({
      name,
      description: name,
      input_schema: { type: "object" as const, properties: {} },
    });
    registerTool(tool(readTool), async () => ({ content: "ok" }), undefined, {
      effect: readOnlyLocalEffect(),
    });
    registerTool(tool(writeTool), async () => ({ content: "ok" }), undefined, {
      effect: localWriteEffect(),
    });
    registerTool(tool(sharedTool), async () => ({ content: "ok" }), undefined, {
      effect: daemonWriteEffect(),
    });
    try {
      expect(() =>
        validateWorkflowDefinitions([workflow("write", integration, [{
          id: "shared-write",
          type: "tool",
          tool: sharedTool,
        }])])
      ).toThrow("shared effects must run from a repository:none workflow");
      expect(() =>
        validateWorkflowDefinitions([workflow("write", integration, [{
          id: "read",
          type: "tool",
          tool: readTool,
        }])])
      ).not.toThrow();
      expect(() =>
        validateWorkflowDefinitions([workflow("write", integration, [{
          id: "write",
          type: "tool",
          tool: writeTool,
        }])])
      ).not.toThrow();
      expect(() =>
        validateWorkflowDefinitions([workflow("write", integration, [{
          id: "unknown",
          type: "tool",
          tool: "writer_transaction_unknown_fixture",
        }])])
      ).toThrow("has no registered effect");
    } finally {
      deregisterTool(readTool);
      deregisterTool(writeTool);
      deregisterTool(sharedTool);
    }
  });
});
