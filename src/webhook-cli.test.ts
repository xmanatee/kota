import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerWebhookCommands } from "./webhook-cli.js";

vi.mock("./workflow/registry.js", () => ({
  getBuiltinWorkflowDefinitions: vi.fn(() => [
    {
      name: "my-webhook-flow",
      triggers: [{ event: "webhook", webhook: true }],
      steps: [],
      enabled: true,
      definitionPath: "src/workflows/my-webhook-flow/workflow.ts",
    },
    {
      name: "no-webhook-flow",
      triggers: [{ event: "runtime.idle" }],
      steps: [],
      enabled: true,
      definitionPath: "src/workflows/no-webhook-flow/workflow.ts",
    },
  ]),
}));

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-webhook-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerWebhookCommands(program);
  return program;
}

function captureOutput(fn: () => void): { out: string; err: string } {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    outLines.push(`${args.join(" ")}\n`);
  });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...args) => {
    errLines.push(`${args.join(" ")}\n`);
  });
  try {
    fn();
  } finally {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  }
  return { out: outLines.join(""), err: errLines.join("") };
}

describe("kota webhook list", () => {
  let projectDir: string;
  let origCwd: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    origCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("shows webhook-triggered workflows with no-secret status", () => {
    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "webhook", "list"]);
    });
    expect(out).toContain("my-webhook-flow");
    expect(out).toContain("✗ not configured");
  });

  it("does not list workflows without webhook triggers", () => {
    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "webhook", "list"]);
    });
    expect(out).not.toContain("no-webhook-flow");
  });

  it("shows configured status when a secret exists in config", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { "my-webhook-flow": { secret: "abc123" } } }),
    );

    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "webhook", "list"]);
    });
    expect(out).toContain("my-webhook-flow");
    expect(out).toContain("✓ configured");
  });

  it("never prints secret values", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { "my-webhook-flow": { secret: "supersecretvalue" } } }),
    );

    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "webhook", "list"]);
    });
    expect(out).not.toContain("supersecretvalue");
  });
});

describe("kota webhook secret generate", () => {
  let projectDir: string;
  let origCwd: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    origCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("generates a 64-char hex secret and writes it to .kota/config.json", () => {
    captureOutput(() => {
      makeProgram().parse(["node", "kota", "webhook", "secret", "generate", "my-webhook-flow"]);
    });

    const configPath = join(projectDir, ".kota", "config.json");
    expect(existsSync(configPath)).toBe(true);
    const saved = JSON.parse(readFileSync(configPath, "utf-8"));
    const secret = saved.webhooks?.["my-webhook-flow"]?.secret;
    expect(typeof secret).toBe("string");
    expect(secret).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(secret)).toBe(true);
  });

  it("prints the generated secret once", () => {
    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "webhook", "secret", "generate", "my-webhook-flow"]);
    });

    const configPath = join(projectDir, ".kota", "config.json");
    const saved = JSON.parse(readFileSync(configPath, "utf-8"));
    const secret = saved.webhooks?.["my-webhook-flow"]?.secret;
    expect(out).toContain(secret);
  });

  it("warns when overwriting an existing secret", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { "my-webhook-flow": { secret: "old-secret" } } }),
    );

    const { err } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "webhook", "secret", "generate", "my-webhook-flow"]);
    });
    expect(err).toContain("already exists");
    expect(err).toContain("overwritten");
  });

  it("does not warn for a new workflow with no prior secret", () => {
    const { err } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "webhook", "secret", "generate", "brand-new"]);
    });
    expect(err).toBe("");
  });

  it("preserves other config fields when writing", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4", webhooks: {} }),
    );

    captureOutput(() => {
      makeProgram().parse(["node", "kota", "webhook", "secret", "generate", "my-webhook-flow"]);
    });

    const saved = JSON.parse(readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"));
    expect(saved.model).toBe("claude-opus-4");
    expect(saved.webhooks?.["my-webhook-flow"]?.secret).toBeTruthy();
  });
});

describe("kota webhook secret remove", () => {
  let projectDir: string;
  let origCwd: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    origCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("removes webhook entry from config", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { "my-webhook-flow": { secret: "todelete" }, other: { secret: "keep" } } }),
    );

    captureOutput(() => {
      makeProgram().parse(["node", "kota", "webhook", "secret", "remove", "my-webhook-flow"]);
    });

    const saved = JSON.parse(readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"));
    expect(saved.webhooks?.["my-webhook-flow"]).toBeUndefined();
    expect(saved.webhooks?.other?.secret).toBe("keep");
  });

  it("removes webhooks key entirely when last entry is deleted", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ webhooks: { "my-webhook-flow": { secret: "only" } } }),
    );

    captureOutput(() => {
      makeProgram().parse(["node", "kota", "webhook", "secret", "remove", "my-webhook-flow"]);
    });

    const saved = JSON.parse(readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"));
    expect(saved.webhooks).toBeUndefined();
  });

  it("prints 'No webhook secret configured' when workflow not found", () => {
    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "webhook", "secret", "remove", "nonexistent"]);
    });
    expect(out).toContain("No webhook secret configured");
  });
});
