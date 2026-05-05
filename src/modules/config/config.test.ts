import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { KotaClient } from "#core/server/kota-client.js";
import type { ConfigClient } from "./client.js";
import {
  configSchemaContent,
  configSchemaPath,
  getConfigValue,
  setConfigValue,
  validateConfig,
} from "./config-operations.js";
import { buildConfigCommand } from "./index.js";

const { FAKE_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require("node:os") as typeof import("node:os");
  return { FAKE_HOME: join(tmpdir(), `kota-config-cli-home-${Date.now()}`) };
});

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return { ...original, homedir: () => FAKE_HOME };
});

function makeProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-config-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

function makeFakeCtx(projectDir: string, moduleKeys: ReadonlySet<string>): ModuleContext {
  const config: ConfigClient = {
    async validate() {
      return validateConfig(projectDir, moduleKeys);
    },
    async get(key) {
      return getConfigValue(projectDir, key);
    },
    async set(key, rawValue) {
      return setConfigValue(projectDir, moduleKeys, key, rawValue);
    },
    async schemaPath() {
      return { path: configSchemaPath() };
    },
    async schemaContent() {
      return { content: configSchemaContent() };
    },
  };
  const client = { config } as unknown as KotaClient;
  return { cwd: projectDir, client } as unknown as ModuleContext;
}

function makeProgram(projectDir: string, moduleKeys: ReadonlySet<string> = new Set()): Command {
  const program = new Command();
  program.exitOverride();
  program.addCommand(buildConfigCommand(makeFakeCtx(projectDir, moduleKeys)));
  return program;
}

async function captureOutput(fn: () => Promise<void> | void): Promise<{ out: string; err: string }> {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
    outLines.push(`${args.join(" ")}\n`);
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    errLines.push(`${args.join(" ")}\n`);
  });
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((data) => {
    outLines.push(String(data));
    return true;
  });
  try {
    await fn();
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    stdoutSpy.mockRestore();
  }
  return { out: outLines.join(""), err: errLines.join("") };
}

describe("kota config validate", () => {
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

  it("shows no sources when no config files exist", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(out).toContain("none found");
  });

  it("shows project source path when project config exists", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-7" }),
    );

    const { out } = await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(out).toContain("project");
    expect(out).toContain(".kota");
  });

  it("includes resolved config in output", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-7", maxTokens: 4096 }),
    );

    const { out } = await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(out).toContain("claude-opus-4-7");
    expect(out).toContain("4096");
  });

  it("warns about unknown top-level keys", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6", modelTier: "fast" }),
    );

    const { err } = await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(err).toContain('Unknown key "modelTier"');
    expect(err).toContain("project");
  });

  it("does not warn about module-registered config keys", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6", scheduler: { agentConcurrency: 2 }, webhooks: {} }),
    );

    const moduleKeys = new Set(["scheduler", "webhooks"]);
    const { err } = await captureOutput(async () => {
      await makeProgram(projectDir, moduleKeys).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(err).toBe("");
  });

  it("warns about keys not in core or module sets", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ scheduler: {}, bogus: true }),
    );

    const moduleKeys = new Set(["scheduler"]);
    const { err } = await captureOutput(async () => {
      await makeProgram(projectDir, moduleKeys).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(err).toContain('Unknown key "bogus"');
    expect(err).not.toContain("scheduler");
  });

  it("does not warn about known keys", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6", modelTiers: { fast: "claude-haiku-4-5" } }),
    );

    const { err } = await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(err).toBe("");
  });

  it("--json outputs only resolved config JSON", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-7" }),
    );

    const { out } = await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "validate", "--json"]);
    });
    const parsed = JSON.parse(out.trim());
    expect(parsed.model).toBe("claude-opus-4-7");
  });

  it("--json does not include source headers or warnings", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-7", unknownKey: true }),
    );

    const { out, err } = await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "validate", "--json"]);
    });
    expect(out).not.toContain("Config sources");
    expect(err).toBe("");
    const parsed = JSON.parse(out.trim());
    expect(parsed).toBeDefined();
  });
});

describe("kota config get", () => {
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

  it("prints top-level string value", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-7" }),
    );

    const { out } = await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "get", "model"]);
    });
    expect(out.trim()).toBe("claude-opus-4-7");
  });

  it("prints nested value via dot-notation", async () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ daemon: { shutdownGracePeriodMs: 12345 } }),
    );

    const { out } = await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "get", "daemon.shutdownGracePeriodMs"]);
    });
    expect(out.trim()).toBe("12345");
  });

  it("exits non-zero for missing key", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit");
    });
    await expect(
      captureOutput(async () => {
        await makeProgram(projectDir).parseAsync(["node", "kota", "config", "get", "nonexistent"]);
      }),
    ).rejects.toThrow();
    exitSpy.mockRestore();
  });
});

describe("kota config set", () => {
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

  it("writes string value when not valid JSON", async () => {
    await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "set", "model", "claude-opus-4-7"]);
    });
    const written = JSON.parse(readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"));
    expect(written.model).toBe("claude-opus-4-7");
  });

  it("creates project config file if it does not exist", async () => {
    expect(existsSync(join(projectDir, ".kota", "config.json"))).toBe(false);
    await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "set", "model", "claude-opus-4-7"]);
    });
    expect(existsSync(join(projectDir, ".kota", "config.json"))).toBe(true);
  });

  it("supports nested key via dot-notation", async () => {
    await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "set", "daemon.shutdownGracePeriodMs", "9000"]);
    });
    const written = JSON.parse(readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"));
    expect(written.daemon.shutdownGracePeriodMs).toBe(9000);
  });

  it("warns for unrecognised key", async () => {
    const { err } = await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "set", "unknownKey", "value"]);
    });
    expect(err).toContain("not a recognised config key");
  });

  it("does not warn when setting a module-registered key", async () => {
    const moduleKeys = new Set(["scheduler"]);
    const { err } = await captureOutput(async () => {
      await makeProgram(projectDir, moduleKeys).parseAsync(["node", "kota", "config", "set", "scheduler.agentConcurrency", "2"]);
    });
    expect(err).toBe("");
    const written = JSON.parse(readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"));
    expect(written.scheduler.agentConcurrency).toBe(2);
  });
});

describe("kota config schema", () => {
  let projectDir: string;
  beforeEach(() => {
    projectDir = makeProjectDir();
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("prints the path to the schema file", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "schema"]);
    });
    const schemaPath = out.trim();
    expect(schemaPath).toMatch(/kota-config\.schema\.json$/);
    expect(existsSync(schemaPath)).toBe(true);
  });

  it("schema file exists and is valid JSON Schema", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "schema"]);
    });
    const schemaPath = resolve(out.trim());
    const content = JSON.parse(readFileSync(schemaPath, "utf-8"));
    expect(content.$schema).toMatch(/json-schema/);
    expect(content.type).toBe("object");
    expect(content.properties).toBeDefined();
  });

  it("--print outputs schema content", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(projectDir).parseAsync(["node", "kota", "config", "schema", "--print"]);
    });
    const content = JSON.parse(out.trim());
    expect(content.$schema).toBeDefined();
    expect(content.properties).toBeDefined();
  });

  it("committed schema matches generated output (run pnpm build:schema to fix)", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const root = resolve(import.meta.dirname, "../../..");
    const tmpOut = join(tmpdir(), `kota-schema-drift-check-${Date.now()}.json`);
    execSync(`KOTA_SCHEMA_OUT=${tmpOut} NODE_OPTIONS=--conditions=source tsx src/core/config/build-schema.ts`, {
      cwd: root,
      stdio: "ignore",
    });
    const generated = readFileSync(tmpOut, "utf-8");
    const committed = readFileSync(resolve(root, "schema/kota-config.schema.json"), "utf-8");
    try {
      rmSync(tmpOut);
    } catch {}
    expect(committed).toBe(generated);
  });
});
