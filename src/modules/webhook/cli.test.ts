import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  captureOutput,
  cleanupFakeHome,
  makeProgram,
  makeScopeRoot,
  readScopeConfig,
  stubCtxWithLocalClient,
  trustScopeConfig,
  workflowDef,
  writeScopeConfig,
} from "./cli-test-support.js";

describe("kota webhook list", () => {
  let scopeRoot: string;
  let ctx: ModuleContext;

  beforeEach(() => {
    scopeRoot = makeScopeRoot();
    ctx = stubCtxWithLocalClient(scopeRoot, [
      workflowDef("my-webhook-flow", [{ event: "webhook", webhook: true }]),
      workflowDef("no-webhook-flow", [{ event: "runtime.idle" }]),
    ]);
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
    cleanupFakeHome();
  });

  it("shows webhook-triggered workflows with no-secret status", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync(["node", "kota", "webhook", "list"]);
    });
    expect(out).toContain("my-webhook-flow");
    expect(out).toContain("✗ not configured");
  });

  it("shows configured status when a secret exists in config", async () => {
    trustScopeConfig(scopeRoot);
    writeScopeConfig(scopeRoot, {
      webhooks: { "my-webhook-flow": { secret: "abc123" } },
    });

    const { out } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync(["node", "kota", "webhook", "list"]);
    });
    expect(out).toContain("my-webhook-flow");
    expect(out).toContain("✓ configured");
  });

  it("never prints secret values", async () => {
    trustScopeConfig(scopeRoot);
    writeScopeConfig(scopeRoot, {
      webhooks: { "my-webhook-flow": { secret: "supersecretvalue" } },
    });

    const { out } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync(["node", "kota", "webhook", "list"]);
    });
    expect(out).not.toContain("supersecretvalue");
  });
});

describe("kota webhook secret generate", () => {
  let scopeRoot: string;
  let ctx: ModuleContext;

  beforeEach(() => {
    scopeRoot = makeScopeRoot();
    ctx = stubCtxWithLocalClient(scopeRoot);
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
    cleanupFakeHome();
  });

  it("prints the generated secret once", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync([
        "node",
        "kota",
        "webhook",
        "secret",
        "generate",
        "my-webhook-flow",
      ]);
    });

    const saved = readScopeConfig(scopeRoot) as {
      webhooks?: Record<string, { secret?: string }>;
    };
    const secret = saved.webhooks?.["my-webhook-flow"]?.secret;
    expect(out).toContain(secret);
  });

  it("prints timestamp-bound signing guidance", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync([
        "node",
        "kota",
        "webhook",
        "secret",
        "generate",
        "my-webhook-flow",
      ]);
    });

    expect(out).toContain("sha256-v2=");
    expect(out).toContain("X-Kota-Webhook-Timestamp");
    expect(out).toContain("Deliveries must sign");
    expect(out).not.toContain("sha256=<hex>");
    expect(out).not.toContain("Legacy body-only");
  });

  it("warns when overwriting an existing secret", async () => {
    trustScopeConfig(scopeRoot);
    writeScopeConfig(scopeRoot, {
      webhooks: { "my-webhook-flow": { secret: "old-secret" } },
    });

    const { err } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync([
        "node",
        "kota",
        "webhook",
        "secret",
        "generate",
        "my-webhook-flow",
      ]);
    });
    expect(err).toContain("already existed");
    expect(err).toContain("overwritten");
  });

  it("does not warn for a new workflow with no prior secret", async () => {
    const { err } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync([
        "node",
        "kota",
        "webhook",
        "secret",
        "generate",
        "brand-new",
      ]);
    });
    expect(err).toBe("");
  });
});

describe("kota webhook secret remove", () => {
  let scopeRoot: string;
  let ctx: ModuleContext;

  beforeEach(() => {
    scopeRoot = makeScopeRoot();
    ctx = stubCtxWithLocalClient(scopeRoot);
  });

  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
    cleanupFakeHome();
  });

  it("prints the removed workflow confirmation", async () => {
    trustScopeConfig(scopeRoot);
    writeScopeConfig(scopeRoot, {
      webhooks: {
        "my-webhook-flow": { secret: "todelete" },
        other: { secret: "keep" },
      },
    });

    const { out } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync([
        "node",
        "kota",
        "webhook",
        "secret",
        "remove",
        "my-webhook-flow",
      ]);
    });

    expect(out).toContain('Removed webhook secret for "my-webhook-flow"');
  });

  it("prints 'No webhook secret configured' when workflow not found", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync([
        "node",
        "kota",
        "webhook",
        "secret",
        "remove",
        "nonexistent",
      ]);
    });
    expect(out).toContain("No webhook secret configured");
  });
});
