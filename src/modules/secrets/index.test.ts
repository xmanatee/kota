import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ApprovalQueue,
  getApprovalQueue,
  resetApprovalQueue,
  setApprovalQueueInstance,
} from "#core/daemon/approval-queue.js";
import type { ModuleContext, ToolDef } from "#core/modules/module-types.js";
import {
  resolveAutonomyGate,
  supervisedGuardrailsConfig,
} from "#core/tools/autonomy-mode.js";
import { riskFromEffect } from "#core/tools/effect.js";
import { assess, getDefaultConfig } from "#core/tools/guardrails.js";
import { clearCustomTools, registerTool } from "#core/tools/index.js";
import { executeToolCalls } from "#core/tools/tool-runner.js";
import secretsModule from "./index.js";

const SECRET_NAME = "KOTA_GET_SECRET_TOOL_TEST_TOKEN";
const SECRET_VALUE = "test-secret-value";

function logNoop(): ModuleContext["log"] {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
}

function makeContext(projectDir: string): ModuleContext {
  return {
    cwd: projectDir,
    getSecret: (name: string) => (name === SECRET_NAME ? SECRET_VALUE : null),
    log: logNoop(),
  } as unknown as ModuleContext;
}

function contributedTools(ctx: ModuleContext): ToolDef[] {
  if (typeof secretsModule.tools === "function") {
    return [...secretsModule.tools(ctx)];
  }
  return [...(secretsModule.tools ?? [])];
}

function registerGetSecret(projectDir: string): ToolDef {
  const entry = contributedTools(makeContext(projectDir)).find(
    (tool) => tool.tool.name === "get_secret",
  );
  if (!entry) throw new Error("secrets module did not contribute get_secret");
  registerTool(entry.tool, entry.runner, secretsModule.name, {
    effect: entry.effect,
  });
  return entry;
}

async function runGetSecret(
  autonomyMode: "passive" | "supervised",
) {
  return executeToolCalls(
    [{
      type: "tool_use",
      id: `tu_${autonomyMode}`,
      name: "get_secret",
      input: { name: SECRET_NAME },
    }],
    {
      resultLimit: 10_000,
      verbose: false,
      autonomyMode,
      guardrailsConfig: supervisedGuardrailsConfig(getDefaultConfig()),
    },
  );
}

describe("secrets module get_secret tool gating", () => {
  let projectDir: string;
  let originalSecretValue: string | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-secrets-tool-"));
    originalSecretValue = process.env[SECRET_NAME];
    delete process.env[SECRET_NAME];
    clearCustomTools();
    resetApprovalQueue();
    setApprovalQueueInstance(
      new ApprovalQueue(join(projectDir, ".kota", "approvals")),
    );
  });

  afterEach(() => {
    clearCustomTools();
    resetApprovalQueue();
    rmSync(projectDir, { recursive: true, force: true });
    if (originalSecretValue === undefined) {
      delete process.env[SECRET_NAME];
    } else {
      process.env[SECRET_NAME] = originalSecretValue;
    }
  });

  it("declares credential injection as a non-safe effect", () => {
    const entry = registerGetSecret(projectDir);

    expect(entry.effect).toEqual({
      kind: "write",
      scope: "process-env",
      idempotent: false,
      openWorld: false,
    });
    expect(riskFromEffect(entry.effect)).toBe("moderate");

    const assessment = assess("get_secret", { name: SECRET_NAME }, getDefaultConfig());
    expect(assessment.risk).toBe("moderate");
    expect(resolveAutonomyGate("passive", assessment).action).toBe("deny");
    expect(resolveAutonomyGate("supervised", assessment).action).toBe("queue");
  });

  it("denies passive get_secret calls before injecting into process.env", async () => {
    registerGetSecret(projectDir);

    const results = await runGetSecret("passive");

    expect(results).toHaveLength(1);
    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Blocked by autonomy mode \"passive\"");
    expect(process.env[SECRET_NAME]).toBeUndefined();
    expect(getApprovalQueue().list()).toEqual([]);
  });

  it("queues supervised get_secret calls before injecting into process.env", async () => {
    registerGetSecret(projectDir);

    const results = await runGetSecret("supervised");

    expect(results).toHaveLength(1);
    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Queued for approval");
    expect(process.env[SECRET_NAME]).toBeUndefined();

    const queued = getApprovalQueue().list("pending");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      tool: "get_secret",
      input: { name: SECRET_NAME },
      risk: "moderate",
      reason: "autonomy mode \"supervised\" gates moderate tool calls through human approval",
      status: "pending",
    });
  });
});
