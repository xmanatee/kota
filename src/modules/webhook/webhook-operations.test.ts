import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  generateWebhookSecret,
  listWebhooks,
  removeWebhookSecret,
} from "./webhook-operations.js";

function workflowDef(
  name: string,
  triggers: RegisteredWorkflowDefinitionInput["triggers"],
): RegisteredWorkflowDefinitionInput {
  return {
    name,
    triggers,
    steps: [],
    enabled: true,
    definitionPath: `src/modules/test/workflows/${name}/workflow.ts`,
  } as unknown as RegisteredWorkflowDefinitionInput;
}

function stubCtx(
  cwd: string,
  workflows: RegisteredWorkflowDefinitionInput[] = [],
): ModuleContext {
  return {
    cwd,
    config: {},
    getContributedWorkflows: () => workflows,
  } as unknown as ModuleContext;
}

describe("webhook-operations (local handler / daemon-up shared logic)", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-webhook-ops-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("listWebhooks surfaces only webhook-triggered workflows with no-secret status", () => {
    const ctx = stubCtx(projectDir, [
      workflowDef("hooked", [{ event: "webhook", webhook: true }]),
      workflowDef("unhooked", [{ event: "runtime.idle" }]),
    ]);

    const result = listWebhooks(ctx);
    expect(result.entries).toEqual([
      { workflow: "hooked", hasSecret: false },
    ]);
  });

  it("listWebhooks reports configured status when a secret exists in config", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { hooked: { secret: "abc123" } } }),
    );

    const ctx = stubCtx(projectDir, [
      workflowDef("hooked", [{ event: "webhook", webhook: true }]),
    ]);

    const result = listWebhooks(ctx);
    expect(result.entries[0]).toEqual({ workflow: "hooked", hasSecret: true });
  });

  it("generateWebhookSecret writes a 64-char hex secret to .kota/config.json", () => {
    const ctx = stubCtx(projectDir);

    const result = generateWebhookSecret(ctx, "hooked");
    expect(result.workflow).toBe("hooked");
    expect(result.overwrote).toBe(false);
    expect(result.secret).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(result.secret)).toBe(true);

    const saved = JSON.parse(
      readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"),
    );
    expect(saved.webhooks?.hooked?.secret).toBe(result.secret);
  });

  it("generateWebhookSecret reports overwrote: true when an existing secret was replaced", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { hooked: { secret: "old" } } }),
    );
    const ctx = stubCtx(projectDir);

    const result = generateWebhookSecret(ctx, "hooked");
    expect(result.overwrote).toBe(true);
    expect(result.secret).not.toBe("old");
  });

  it("generateWebhookSecret preserves other config fields", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4", webhooks: {} }),
    );
    const ctx = stubCtx(projectDir);

    generateWebhookSecret(ctx, "hooked");
    const saved = JSON.parse(
      readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"),
    );
    expect(saved.model).toBe("claude-opus-4");
    expect(saved.webhooks?.hooked?.secret).toBeTruthy();
  });

  it("removeWebhookSecret returns removed: false when no secret existed", () => {
    const ctx = stubCtx(projectDir);
    const result = removeWebhookSecret(ctx, "missing");
    expect(result).toEqual({ ok: true, workflow: "missing", removed: false });
  });

  it("removeWebhookSecret deletes the entry and preserves siblings", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({
        webhooks: { hooked: { secret: "x" }, other: { secret: "keep" } },
      }),
    );
    const ctx = stubCtx(projectDir);

    const result = removeWebhookSecret(ctx, "hooked");
    expect(result).toEqual({ ok: true, workflow: "hooked", removed: true });

    const saved = JSON.parse(
      readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"),
    );
    expect(saved.webhooks?.hooked).toBeUndefined();
    expect(saved.webhooks?.other?.secret).toBe("keep");
  });

  it("removeWebhookSecret drops the webhooks key entirely when last entry is deleted", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { hooked: { secret: "only" } } }),
    );
    const ctx = stubCtx(projectDir);

    removeWebhookSecret(ctx, "hooked");
    const saved = JSON.parse(
      readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"),
    );
    expect(saved.webhooks).toBeUndefined();
  });

  it("listWebhooks does not surface secret values", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { hooked: { secret: "supersecret" } } }),
    );
    const ctx = stubCtx(projectDir, [
      workflowDef("hooked", [{ event: "webhook", webhook: true }]),
    ]);

    const result = listWebhooks(ctx);
    expect(JSON.stringify(result)).not.toContain("supersecret");
  });
});
