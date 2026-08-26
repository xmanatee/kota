import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarnessRunOptions,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
  UNKNOWN_AGENT_USAGE,
} from "#core/agent-harness/index.js";
import type { AgentDef } from "#core/agents/agent-types.js";
import { EventBus } from "#core/events/event-bus.js";
import {
  handoffApprovalQueue,
  handoffScopePolicy,
  handoffScopePolicyAuthority,
  initHandoffPolicyGitProject,
} from "#core/tools/handoff-agent-scope-policy-test-support.js";
import { executeTool } from "#core/tools/index.js";
import { executeWorkflowRun } from "#core/workflow/run-executor.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { createTestRunContext } from "#core/workflow/testing/run-context-fixture.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "#core/workflow/validation.js";
import { readEmptyTestWorkflowRuntimeState } from "#core/workflow/testing/runtime-state.js";

function harnessError(text: string) {
  return {
    text,
    streamedText: text,
    turns: 1,
    usage: UNKNOWN_AGENT_USAGE,
    isError: true,
  };
}

describe("named agent handoff workflow integration", () => {
  let projectDir: string;
  let parentAgent: AgentDef;
  let reviewerAgent: AgentDef;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-named-agent-handoff-"));
    mkdirSync(join(projectDir, "agents"), { recursive: true });
    writeFileSync(join(projectDir, "agents", "parent.md"), "Parent prompt.\n");
    writeFileSync(join(projectDir, "agents", "reviewer.md"), "Reviewer prompt.\n");
    initHandoffPolicyGitProject(projectDir);
    parentAgent = {
      name: "parent",
      role: "Coordinate review handoffs.",
      promptPath: "agents/parent.md",
      model: "parent-model",
      effort: "low",
      writeScope: [],
    };
    reviewerAgent = {
      name: "reviewer",
      role: "Return a structured review verdict.",
      promptPath: "agents/reviewer.md",
      model: "reviewer-model",
      effort: "medium",
      tools: {
        allowed: ["Bash", "Read"],
      },
      writeScope: [],
    };
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    clearAgentHarnessRegistryForTest();
  });

  it("links a child named-agent handoff to a parent workflow run and consumes the structured result", async () => {
    const resolveAgentDef = (name: string) => {
      if (name === parentAgent.name) return parentAgent;
      if (name === reviewerAgent.name) return reviewerAgent;
      return undefined;
    };
    const policy = handoffScopePolicy(projectDir);
    const scopeId = policy.scopeId;
    const scopePolicyAuthority = handoffScopePolicyAuthority(policy);
    const bus = new EventBus();
    const approvalQueue = handoffApprovalQueue(projectDir, scopeId, bus);
    const authorityConfigPath = join(projectDir, ".machine", "config.json");
    let parentWorkflowContext: AgentHarnessRunOptions["workflowContext"];
    registerAgentHarness({
      name: "handoff-fixture",
      description: "named handoff fixture harness",
      supportsMultiTurn: false,
      supportedHookKinds: [],
      askOwnerToolName: "ask_owner",
      emitsAgentMessageStream: false,
      toolControl: "kota",
      run: vi.fn(async (options) => {
        if (options.systemPrompt?.includes("Reviewer prompt.")) {
          if (
            options.scopePolicy !== policy ||
            options.scopePolicyAuthority !== scopePolicyAuthority ||
            options.approvalQueue !== approvalQueue ||
            options.authorityConfigPath !== authorityConfigPath ||
            options.sessionContext?.scopeId !== scopeId ||
            options.sessionContext.projectId !== scopeId
          ) {
            return harnessError("child did not inherit workflow scope authority");
          }
          const expectedAskOwnerSource = parentWorkflowContext
            ? `workflow:${parentWorkflowContext.workflowName}/${parentWorkflowContext.runId}/${parentWorkflowContext.stepId}`
            : "";
          if (options.askOwner?.source !== expectedAskOwnerSource) {
            return harnessError("child did not inherit askOwner source");
          }
          if (!options.allowedTools?.includes("ask_owner")) {
            return harnessError(
              "child allowedTools did not include inherited ask_owner tool",
            );
          }
          const guardDecision = await options.canUseTool?.(
            "Bash",
            { command: "git commit -m child" },
            {
              signal: new AbortController().signal,
              toolUseId: "child-bash-tool",
            },
          );
          if (guardDecision?.behavior !== "deny") {
            return harnessError("child did not inherit workflow canUseTool guard");
          }
          return {
            text: 'reviewed\n```json\n{"verdict":"pass","summary":"child reviewed"}\n```',
            streamedText: "reviewed",
            sessionId: "child-review-session",
            turns: 1,
            usage: UNKNOWN_AGENT_USAGE,
            isError: false,
          };
        }

        if (!options.workflowContext) {
          return harnessError("missing workflow context");
        }
        parentWorkflowContext = options.workflowContext;
        const handoff = await executeTool(
          "handoff_agent",
          {
            agent: "reviewer",
            mode: "call",
            input: { task: "Review the parent workflow output." },
            input_schema: {
              type: "object",
              properties: {
                task: { type: "string" },
              },
              required: ["task"],
              additionalProperties: false,
            },
            reason: "Parent workflow wants specialist review before consuming output.",
            autonomy_mode: "autonomous",
            budget: { max_turns: 2 },
            scope: {
              scope_id: options.workflowContext.scopeId,
              project_id: options.workflowContext.projectId,
            },
            output_schema: {
              type: "object",
              properties: {
                verdict: { type: "string" },
                summary: { type: "string" },
              },
              required: ["verdict", "summary"],
              additionalProperties: false,
            },
            allowed_tools: ["Read"],
          },
          {
            sessionId: "parent-session",
            toolUseId: "handoff-tool-use",
            scopeId: options.workflowContext.scopeId,
            projectId: options.workflowContext.projectId,
            workflow: options.workflowContext,
          },
        );
        if (handoff.is_error) {
          return harnessError(handoff.content);
        }
        const output = handoff.structuredContent?.structuredOutput as {
          verdict: string;
          summary: string;
        };
        const trace = handoff.structuredContent?.trace as {
          parentRunId: string;
          parentStepId: string;
          parentSpanId: string;
        };
        return {
          text:
            "parent consumed child review\n" +
            "```json\n" +
            JSON.stringify({
              verdict: output.verdict,
              summary: output.summary,
              childSessionId: handoff.structuredContent?.childSessionId,
              parentRunId: trace.parentRunId,
              parentStepId: trace.parentStepId,
              parentSpanId: trace.parentSpanId,
            }) +
            "\n```",
          streamedText: "parent consumed child review",
          sessionId: "parent-session",
          turns: 1,
          usage: UNKNOWN_AGENT_USAGE,
          isError: false,
        };
      }),
    });

    const [definition] = validateWorkflowDefinitions(
      [
        registerWorkflowDefinition("src/modules/test/workflows/handoff/workflow.ts", {
          name: "handoff-workflow",
          repository: "read",
          triggers: [{ event: "runtime.idle" }],
          steps: [
            {
              id: "parent-review",
              type: "agent",
              agentName: "parent",
              harness: "handoff-fixture",
              autonomyMode: "autonomous",
              outputFormat: "json",
              outputSchema: {
                type: "object",
                properties: {
                  verdict: { type: "string" },
                  summary: { type: "string" },
                  childSessionId: { type: "string" },
                  parentRunId: { type: "string" },
                  parentStepId: { type: "string" },
                  parentSpanId: { type: "string" },
                },
                required: ["verdict", "summary", "childSessionId", "parentRunId", "parentStepId", "parentSpanId"],
                additionalProperties: false,
              },
            },
            {
              id: "consume-review",
              type: "code",
              run: (ctx) => {
                const review = ctx.stepOutputs["parent-review"] as {
                  verdict: string;
                  childSessionId: string;
                  parentRunId: string;
                  parentStepId: string;
                  parentSpanId: string;
                };
                return {
                  consumed: true,
                  verdict: review.verdict,
                  childSessionId: review.childSessionId,
                  parentRunId: review.parentRunId,
                  parentStepId: review.parentStepId,
                  parentSpanId: review.parentSpanId,
                };
              },
            },
          ],
        }),
      ],
      projectDir,
      { resolveAgentDef },
    );

    const store = new WorkflowRunStore(projectDir);
    const { promise } = executeWorkflowRun(
      definition,
      { event: "runtime.idle", schemaRef: null, payload: {} },
      {
        readRuntimeState: readEmptyTestWorkflowRuntimeState,
        runContext: createTestRunContext(projectDir, {
          event: "runtime.idle",
          schemaRef: null,
          payload: {},
        }),
        bus,
        store,
        log: vi.fn(),
        resolveAgentDef,
        scopePolicyAuthority,
        approvalQueue,
        authorityConfigPath,
      },
      new AbortController(),
    );

    const result = await promise;

    expect(result.metadata.status).toBe("success");
    expect(result.metadata.steps.at(-1)?.output).toMatchObject({
      consumed: true,
      verdict: "pass",
      childSessionId: "child-review-session",
      parentRunId: result.metadata.id,
      parentStepId: "parent-review",
      parentSpanId: `${result.metadata.id}:parent-review`,
    });
  });
});
