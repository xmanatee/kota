import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  captureOutput,
  cleanupFakeHome,
  makeProgram,
  makeProjectDir,
  projectConfigExists,
  readProjectConfig,
  stubCtxWithLocalClient,
  trustProjectConfig,
  workflowDef,
  writeProjectConfig,
} from "./cli-test-support.js";

describe("kota webhook list", () => {
  let projectDir: string;
  let ctx: ModuleContext;

  beforeEach(() => {
    projectDir = makeProjectDir();
    ctx = stubCtxWithLocalClient(projectDir, [
      workflowDef("my-webhook-flow", [{ event: "webhook", webhook: true }]),
      workflowDef("no-webhook-flow", [{ event: "runtime.idle" }]),
    ]);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    cleanupFakeHome();
  });

  it("shows webhook-triggered workflows with no-secret status", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync(["node", "kota", "webhook", "list"]);
    });
    expect(out).toContain("my-webhook-flow");
    expect(out).toContain("✗ not configured");
  });

  it("does not list workflows without webhook triggers", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync(["node", "kota", "webhook", "list"]);
    });
    expect(out).not.toContain("no-webhook-flow");
  });

  it("shows configured status when a secret exists in config", async () => {
    trustProjectConfig(projectDir);
    writeProjectConfig(projectDir, {
      webhooks: { "my-webhook-flow": { secret: "abc123" } },
    });

    const { out } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync(["node", "kota", "webhook", "list"]);
    });
    expect(out).toContain("my-webhook-flow");
    expect(out).toContain("✓ configured");
  });

  it("never prints secret values", async () => {
    trustProjectConfig(projectDir);
    writeProjectConfig(projectDir, {
      webhooks: { "my-webhook-flow": { secret: "supersecretvalue" } },
    });

    const { out } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync(["node", "kota", "webhook", "list"]);
    });
    expect(out).not.toContain("supersecretvalue");
  });
});

describe("kota webhook secret generate", () => {
  let projectDir: string;
  let ctx: ModuleContext;

  beforeEach(() => {
    projectDir = makeProjectDir();
    ctx = stubCtxWithLocalClient(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    cleanupFakeHome();
  });

  it("generates a 64-char hex secret and writes it to .kota/config.json", async () => {
    await captureOutput(async () => {
      await makeProgram(ctx).parseAsync([
        "node",
        "kota",
        "webhook",
        "secret",
        "generate",
        "my-webhook-flow",
      ]);
    });

    expect(projectConfigExists(projectDir)).toBe(true);
    const saved = readProjectConfig(projectDir) as {
      webhooks?: Record<string, { secret?: string }>;
    };
    const secret = saved.webhooks?.["my-webhook-flow"]?.secret;
    expect(typeof secret).toBe("string");
    expect(secret).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(secret ?? "")).toBe(true);
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

    const saved = readProjectConfig(projectDir) as {
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
    trustProjectConfig(projectDir);
    writeProjectConfig(projectDir, {
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

  it("preserves other config fields when writing", async () => {
    writeProjectConfig(projectDir, { model: "claude-opus-4", webhooks: {} });

    await captureOutput(async () => {
      await makeProgram(ctx).parseAsync([
        "node",
        "kota",
        "webhook",
        "secret",
        "generate",
        "my-webhook-flow",
      ]);
    });

    const saved = readProjectConfig(projectDir) as {
      model?: string;
      webhooks?: Record<string, { secret?: string }>;
    };
    expect(saved.model).toBe("claude-opus-4");
    expect(saved.webhooks?.["my-webhook-flow"]?.secret).toBeTruthy();
  });
});

describe("kota webhook secret remove", () => {
  let projectDir: string;
  let ctx: ModuleContext;

  beforeEach(() => {
    projectDir = makeProjectDir();
    ctx = stubCtxWithLocalClient(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    cleanupFakeHome();
  });

  it("removes webhook entry from config", async () => {
    trustProjectConfig(projectDir);
    writeProjectConfig(projectDir, {
      webhooks: {
        "my-webhook-flow": { secret: "todelete" },
        other: { secret: "keep" },
      },
    });

    await captureOutput(async () => {
      await makeProgram(ctx).parseAsync([
        "node",
        "kota",
        "webhook",
        "secret",
        "remove",
        "my-webhook-flow",
      ]);
    });

    const saved = readProjectConfig(projectDir) as {
      webhooks?: Record<string, { secret?: string }>;
    };
    expect(saved.webhooks?.["my-webhook-flow"]).toBeUndefined();
    expect(saved.webhooks?.other?.secret).toBe("keep");
  });

  it("removes webhooks key entirely when last entry is deleted", async () => {
    trustProjectConfig(projectDir);
    writeProjectConfig(projectDir, {
      webhooks: { "my-webhook-flow": { secret: "only" } },
    });

    await captureOutput(async () => {
      await makeProgram(ctx).parseAsync([
        "node",
        "kota",
        "webhook",
        "secret",
        "remove",
        "my-webhook-flow",
      ]);
    });

    const saved = readProjectConfig(projectDir) as { webhooks?: unknown };
    expect(saved.webhooks).toBeUndefined();
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
