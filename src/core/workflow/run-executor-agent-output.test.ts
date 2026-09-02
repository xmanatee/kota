import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import {
  createPrimaryAgentBackoffFixture,
  createRunExecutorTestFixture,
  makeAgentStep,
  makeDefinition,
  type RunExecutorTestFixture,
  registerWorkflowScenarioDriver,
} from "./run-executor-test-fixture.js";

let fixture: RunExecutorTestFixture;

beforeEach(() => {
  fixture = createRunExecutorTestFixture();
});

afterEach(() => {
  fixture.dispose();
});

describe("agent output validation and retry", () => {
  it("validates agent output before recording step output or streamed agent frames", async () => {
    const harness = "workflow-agent-output-validator";
    const token = `${"ghp"}_${"A".repeat(36)}`;
    const responseText = ["```json", JSON.stringify({ body: `token: ${token}` }), "```"].join(
      "\n",
    );
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      await options.onMessage?.({ type: "text", text: responseText });
      return {
        text: responseText,
        streamedText: responseText,
        turns: 1,
        usage: {
          tokens: { state: "unknown" },
          cost: { state: "unknown" },
        },
        isError: false,
      };
    });

    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        makeAgentStep(fixture.workspaceRoot, harness, {
          outputFormat: "json",
          outputSchema: {
            type: "object",
            required: ["body"],
            properties: { body: { type: "string" } },
          },
          validate: (raw) => {
            if (JSON.stringify(raw).includes(token)) {
              throw new Error("github-token");
            }
            return raw as object;
          },
        }),
      ],
    });

    const result = await fixture.execute(definition).promise;
    const step = result.metadata.steps[0];
    const runDirPath = join(fixture.workspaceRoot, result.metadata.runDir);

    expect(result.metadata.status).toBe("failed");
    expect(step?.status).toBe("failed");
    expect(step?.output).toBeUndefined();
    expect(step?.error).toContain("github-token");
    expect(step?.error).not.toContain(token);
    expect(existsSync(join(runDirPath, "steps", "agent.events.jsonl"))).toBe(false);
    expect(readFileSync(join(runDirPath, "metadata.json"), "utf-8")).not.toContain(token);
    expect(readFileSync(join(runDirPath, "error.txt"), "utf-8")).not.toContain(token);
  }, 10_000);

  it("retries invalid fenced JSON output with a targeted correction prompt", async () => {
    const harness = "workflow-agent-invalid-json-retry";
    const prompts: string[] = [];
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      prompts.push(options.prompt);
      const attempt = prompts.length;
      const text =
        prompts.length === 1
          ? "```json\n{ invalid\n```"
          : ["```json", JSON.stringify({ body: "ok" }), "```"].join("\n");
      return {
        text,
        streamedText: text,
        turns: 1,
        usage: {
          tokens: {
            state: "complete",
            inputTokens: attempt === 1 ? 10 : 20,
            outputTokens: attempt === 1 ? 2 : 3,
          },
          cost: { state: "unavailable", reason: "provider-does-not-report" },
        },
        isError: false,
      };
    });

    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        makeAgentStep(fixture.workspaceRoot, harness, {
          outputFormat: "json",
          outputSchema: {
            type: "object",
            required: ["body"],
            properties: { body: { type: "string" } },
          },
          retry: { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 },
        }),
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("success");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(
      "Previous JSON output was invalid: the fenced block contains invalid JSON",
    );
    expect(result.metadata.steps[0]?.output).toEqual({ body: "ok" });
    expect(result.metadata.steps[0]?.usage).toEqual({
      tokens: { state: "complete", inputTokens: 30, outputTokens: 5 },
      cost: { state: "unavailable", reason: "provider-does-not-report" },
    });
  }, 10_000);

  it("parks repeated successful-empty JSON results after one correction attempt", async () => {
    const harness = "workflow-agent-successful-empty-json";
    let attempts = 0;
    registerWorkflowScenarioDriver(harness, async () => {
      attempts += 1;
      return {
        text: "",
        streamedText: "",
        turns: 1,
        usage: {
          tokens: { state: "unknown" },
          cost: { state: "unknown" },
        },
        isError: false,
        subtype: "antigravity_cli_empty_output",
      };
    });

    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        makeAgentStep(fixture.workspaceRoot, harness, {
          outputFormat: "json",
          outputSchema: {
            type: "object",
            required: ["body"],
            properties: { body: { type: "string" } },
          },
          retry: { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 },
        }),
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("failed");
    expect(attempts).toBe(2);
    expect(result.agentBackoff).toMatchObject({ kind: "output_contract" });
    expect(result.agentBackoff?.reason).toContain("antigravity_cli_empty_output");
  }, 10_000);

  it("activates shared backoff at the primary agent boundary before step retries", async () => {
    const harness = "workflow-primary-agent-provider-backoff";
    let attempts = 0;
    registerWorkflowScenarioDriver(harness, async () => {
      attempts += 1;
      return {
        text: "API Error: 503 provider unavailable",
        streamedText: "",
        turns: 1,
        usage: {
          tokens: { state: "unknown" },
          cost: { state: "unknown" },
        },
        isError: true,
        subtype: "error_during_execution",
      };
    });
    const backoff = createPrimaryAgentBackoffFixture();
    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        makeAgentStep(fixture.workspaceRoot, harness, {
          retry: { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 },
        }),
      ],
    });

    const result = await fixture.execute(definition, { agentBackoff: backoff.manager }).promise;

    expect(result.metadata.status).toBe("failed");
    expect(result.agentBackoff).toMatchObject({ kind: "provider" });
    expect(attempts).toBe(1);
    expect(backoff.registerAttempt).toHaveBeenCalledTimes(1);
    expect(backoff.apply).toHaveBeenCalledTimes(1);
  });

  it("retries missing fenced JSON output with a targeted correction prompt", async () => {
    const harness = "workflow-agent-missing-json-fence-retry";
    const prompts: string[] = [];
    registerWorkflowScenarioDriver(harness, async (options: AgentHarnessRunOptions) => {
      prompts.push(options.prompt);
      const text =
        prompts.length === 1
          ? JSON.stringify({ body: "ok" })
          : ["```json", JSON.stringify({ body: "ok" }), "```"].join("\n");
      return {
        text,
        streamedText: text,
        turns: 1,
        usage: {
          tokens: { state: "unknown" },
          cost: { state: "unknown" },
        },
        isError: false,
      };
    });

    const definition = makeDefinition({
      moduleRoot: fixture.workspaceRoot,
      steps: [
        makeAgentStep(fixture.workspaceRoot, harness, {
          outputFormat: "json",
          outputSchema: {
            type: "object",
            required: ["body"],
            properties: { body: { type: "string" } },
          },
          retry: { maxAttempts: 2, initialDelayMs: 1, backoffFactor: 1 },
        }),
      ],
    });

    const result = await fixture.execute(definition).promise;

    expect(result.metadata.status).toBe("success");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(
      "Previous output was missing usable structured JSON: no fenced JSON block was found in the response",
    );
    expect(result.metadata.steps[0]?.output).toEqual({ body: "ok" });
  }, 10_000);
});
