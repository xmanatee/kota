import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProjectSecretStore, resetSecretStores } from "#core/config/secrets.js";
import { ApprovalQueue } from "#core/daemon/approval-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { ModuleContext, ToolDef } from "#core/modules/module-types.js";
import {
  resolveAutonomyGate,
  supervisedGuardrailsConfig,
} from "#core/tools/autonomy-mode.js";
import { riskFromEffect } from "#core/tools/effect.js";
import { assess, getDefaultConfig } from "#core/tools/guardrails.js";
import { clearCustomTools, executeTool, registerTool } from "#core/tools/index.js";
import {
  registerSessionEnvironment,
  sessionEnvironmentForExecution,
  unregisterSessionEnvironment,
} from "#core/tools/session-environment.js";
import { executeToolCalls } from "#core/tools/tool-runner.js";
import { approvedApprovalResponse } from "#modules/approval-queue/approval-execution.js";
import secretsModule from "./index.js";

const SECRET_NAME = "KOTA_GET_SECRET_TOOL_TEST_TOKEN";
const SECRET_VALUE = "test-secret-value";

type TestSessionContext = {
  sessionId: string;
  scopeId: string;
};

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
  approvalQueue: ApprovalQueue,
  sessionContext: TestSessionContext,
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
      approvalQueue,
      sessionId: sessionContext.sessionId,
      scopeId: sessionContext.scopeId,
      projectId: sessionContext.scopeId,
      guardrailsConfig: supervisedGuardrailsConfig(getDefaultConfig()),
    },
  );
}

describe("secrets module get_secret tool gating", () => {
  let projectDir: string;
  let originalSecretValue: string | undefined;
  let approvalQueue: ApprovalQueue;
  let sessionContext: TestSessionContext;
  let otherSessionContext: TestSessionContext;
  let otherProjectContext: TestSessionContext;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-secrets-tool-"));
    const scopeId = deriveDirectoryScopeId(projectDir);
    sessionContext = { sessionId: "secrets-session-a", scopeId };
    otherSessionContext = { sessionId: "secrets-session-b", scopeId };
    otherProjectContext = {
      sessionId: "secrets-session-a",
      scopeId: "secrets-project-b",
    };
    originalSecretValue = process.env[SECRET_NAME];
    delete process.env[SECRET_NAME];
    clearCustomTools();
    resetSecretStores();
    getProjectSecretStore(projectDir).set(SECRET_NAME, SECRET_VALUE, "project");
    approvalQueue = new ApprovalQueue(
      join(projectDir, ".kota", "approvals"),
      null,
      scopeId,
    );
  });

  afterEach(() => {
    unregisterSessionEnvironment(sessionContext);
    unregisterSessionEnvironment(otherSessionContext);
    unregisterSessionEnvironment(otherProjectContext);
    clearCustomTools();
    resetSecretStores();
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

  it("denies passive get_secret calls before creating a credential overlay", async () => {
    registerGetSecret(projectDir);

    const results = await runGetSecret("passive", approvalQueue, sessionContext);

    expect(results).toHaveLength(1);
    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Blocked by autonomy mode \"passive\"");
    expect(process.env[SECRET_NAME]).toBeUndefined();
    expect(approvalQueue.list()).toEqual([]);
  });

  it("queues supervised get_secret calls before creating a credential overlay", async () => {
    registerGetSecret(projectDir);

    const results = await runGetSecret(
      "supervised",
      approvalQueue,
      sessionContext,
    );

    expect(results).toHaveLength(1);
    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain("Queued for approval");
    expect(process.env[SECRET_NAME]).toBeUndefined();

    const queued = approvalQueue.list("pending");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      tool: "get_secret",
      input: { redacted: true, reason: "tool-io" },
      risk: "moderate",
      reason: "autonomy mode \"supervised\" gates moderate tool calls through human approval",
      status: "pending",
    });
    expect(JSON.stringify(queued[0])).not.toContain(SECRET_NAME);
  });

  it("executes an approval into only its originating live session overlay", async () => {
    registerGetSecret(projectDir);
    registerSessionEnvironment(sessionContext);
    registerSessionEnvironment(otherSessionContext);
    await runGetSecret("supervised", approvalQueue, sessionContext);
    const queued = approvalQueue.list("pending")[0];
    if (queued === undefined) throw new Error("get_secret approval was not queued");
    const selection = approvalQueue.getExecutionSnapshot(queued.id);
    if (!selection.ok) throw new Error("get_secret approval input was unavailable");
    const approved = approvalQueue.approveForExecution(selection.snapshot.descriptor);
    if (!approved.ok) throw new Error("get_secret approval input was unavailable");

    const response = await approvedApprovalResponse(approved.approval, {
      scopeId: sessionContext.scopeId,
      projectId: sessionContext.scopeId,
      cwd: projectDir,
    }, selection.snapshot.descriptor);

    if (response.resolution.kind !== "tool_execution") {
      throw new Error("get_secret approval was not executed");
    }
    expect(response.resolution.execution.status).toBe("succeeded");
    expect(process.env[SECRET_NAME]).toBeUndefined();
    expect(sessionEnvironmentForExecution(sessionContext)).toEqual({
      [SECRET_NAME]: SECRET_VALUE,
    });
    expect(sessionEnvironmentForExecution(otherSessionContext)).toEqual({});
  });

  it("injects only into the authorized live session and project", async () => {
    registerGetSecret(projectDir);
    registerSessionEnvironment(sessionContext);
    registerSessionEnvironment(otherSessionContext);
    registerSessionEnvironment(otherProjectContext);

    const result = await executeTool(
      "get_secret",
      { name: SECRET_NAME },
      sessionContext,
    );

    expect(result.is_error).not.toBe(true);
    expect(result.content).toContain(`<secret:${SECRET_NAME}>`);
    expect(process.env[SECRET_NAME]).toBeUndefined();
    expect(sessionEnvironmentForExecution(sessionContext)).toEqual({
      [SECRET_NAME]: SECRET_VALUE,
    });
    expect(sessionEnvironmentForExecution(otherSessionContext)).toEqual({});
    expect(sessionEnvironmentForExecution(otherProjectContext)).toEqual({});
  });

  it("rejects credential injection without an active scoped session", async () => {
    registerGetSecret(projectDir);

    const result = await executeTool("get_secret", { name: SECRET_NAME });

    expect(result).toMatchObject({
      is_error: true,
      content: expect.stringContaining(
        "Credential injection requires an active session and project scope",
      ),
    });
    expect(process.env[SECRET_NAME]).toBeUndefined();
  });
});
