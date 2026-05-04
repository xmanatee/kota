import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import { registerWebhookCommands } from "./cli.js";
import type { WebhookClient } from "./client.js";
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

function stubCtxWithLocalClient(
  cwd: string,
  workflows: RegisteredWorkflowDefinitionInput[] = [],
): ModuleContext {
  const ctxBase = {
    cwd,
    config: {},
    getContributedWorkflows: () => workflows,
  } as unknown as ModuleContext;
  const webhook: WebhookClient = {
    async list() {
      return listWebhooks(ctxBase);
    },
    async secretGenerate(workflow) {
      return generateWebhookSecret(ctxBase, workflow);
    },
    async secretRemove(workflow) {
      return removeWebhookSecret(ctxBase, workflow);
    },
  };
  return new Proxy(ctxBase, {
    get(target, prop, receiver) {
      if (prop === "client") return { webhook };
      return Reflect.get(target, prop, receiver);
    },
  });
}

function makeProjectDir(): string {
  return mkdtempSync(join(tmpdir(), "kota-webhook-cli-"));
}

function makeProgram(ctx: ModuleContext): Command {
  const program = new Command();
  program.exitOverride();
  const webhookCmd = program.command("webhook").description("Manage webhook secrets");
  registerWebhookCommands(webhookCmd, ctx);
  return program;
}

async function captureOutput(
  fn: () => Promise<void>,
): Promise<{ out: string; err: string }> {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    outLines.push(`${args.join(" ")}\n`);
  });
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    outLines.push(String(data));
    return true;
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args) => {
    errLines.push(`${args.join(" ")}\n`);
  });
  try {
    await fn();
  } finally {
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
    warnSpy.mockRestore();
  }
  return { out: outLines.join(""), err: errLines.join("") };
}

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
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { "my-webhook-flow": { secret: "abc123" } } }),
    );

    const { out } = await captureOutput(async () => {
      await makeProgram(ctx).parseAsync(["node", "kota", "webhook", "list"]);
    });
    expect(out).toContain("my-webhook-flow");
    expect(out).toContain("✓ configured");
  });

  it("never prints secret values", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { "my-webhook-flow": { secret: "supersecretvalue" } } }),
    );

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

    const configPath = join(projectDir, ".kota", "config.json");
    expect(existsSync(configPath)).toBe(true);
    const saved = JSON.parse(readFileSync(configPath, "utf-8"));
    const secret = saved.webhooks?.["my-webhook-flow"]?.secret;
    expect(typeof secret).toBe("string");
    expect(secret).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(secret)).toBe(true);
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

    const configPath = join(projectDir, ".kota", "config.json");
    const saved = JSON.parse(readFileSync(configPath, "utf-8"));
    const secret = saved.webhooks?.["my-webhook-flow"]?.secret;
    expect(out).toContain(secret);
  });

  it("warns when overwriting an existing secret", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { "my-webhook-flow": { secret: "old-secret" } } }),
    );

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
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4", webhooks: {} }),
    );

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

    const saved = JSON.parse(
      readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"),
    );
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
  });

  it("removes webhook entry from config", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({
        webhooks: { "my-webhook-flow": { secret: "todelete" }, other: { secret: "keep" } },
      }),
    );

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

    const saved = JSON.parse(
      readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"),
    );
    expect(saved.webhooks?.["my-webhook-flow"]).toBeUndefined();
    expect(saved.webhooks?.other?.secret).toBe("keep");
  });

  it("removes webhooks key entirely when last entry is deleted", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { "my-webhook-flow": { secret: "only" } } }),
    );

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

    const saved = JSON.parse(
      readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"),
    );
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
