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
  const { join } = require("node:path") as typeof import("node:path");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  return { FAKE_HOME: join(tmpdir(), `kota-config-cli-home-${Date.now()}`) };
});

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return { ...original, homedir: () => FAKE_HOME };
});

function makeScopeRoot(): string {
  const dir = join(
    tmpdir(),
    `kota-config-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

afterEach(() => {
  rmSync(FAKE_HOME, { recursive: true, force: true });
});

function trustScopeConfig(scopeRoot: string): void {
  mkdirSync(join(FAKE_HOME, ".kota"), { recursive: true });
  writeFileSync(
    join(FAKE_HOME, ".kota", "config.json"),
    JSON.stringify({ trustedScopes: [scopeRoot] }),
  );
}

function makeFakeCtx(scopeRoot: string, moduleKeys: ReadonlySet<string>): ModuleContext {
  const config: ConfigClient = {
    async validate() {
      return validateConfig(scopeRoot, moduleKeys);
    },
    async get(key) {
      return getConfigValue(scopeRoot, key);
    },
    async set(key, rawValue) {
      return setConfigValue(scopeRoot, moduleKeys, key, rawValue);
    },
    async schemaPath() {
      return { path: configSchemaPath() };
    },
    async schemaContent() {
      return { content: configSchemaContent() };
    },
  };
  const client = { config } as unknown as KotaClient;
  return { cwd: scopeRoot, client } as unknown as ModuleContext;
}

function makeProgram(scopeRoot: string, moduleKeys: ReadonlySet<string> = new Set()): Command {
  const program = new Command();
  program.exitOverride();
  program.addCommand(buildConfigCommand(makeFakeCtx(scopeRoot, moduleKeys)));
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
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((data) => {
    errLines.push(String(data));
    return true;
  });
  try {
    await fn();
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
  return { out: outLines.join(""), err: errLines.join("") };
}

describe("kota config validate", () => {
  let scopeRoot: string;
  let origCwd: string;

  beforeEach(() => {
    scopeRoot = makeScopeRoot();
    origCwd = process.cwd();
    process.chdir(scopeRoot);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("shows no sources when no config files exist", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(out).toContain("none found");
  });

  it("shows the scope source path when scope config exists", async () => {
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-7" }),
    );

    const { out } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(out).toContain("scope");
    expect(out).toContain(".kota");
  });

  it("includes resolved config in output", async () => {
    trustScopeConfig(scopeRoot);
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-7", maxTokens: 4096 }),
    );

    const { out } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(out).toContain("claude-opus-4-7");
    expect(out).toContain("4096");
  });

  it("warns about unknown top-level keys", async () => {
    trustScopeConfig(scopeRoot);
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6", modelTier: "fast" }),
    );

    const { err } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(err).toContain('Unknown key "modelTier"');
    expect(err).toContain("scope");
  });

  it("does not warn about module-registered config keys", async () => {
    trustScopeConfig(scopeRoot);
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6", scheduler: { concurrency: 2 }, webhooks: {} }),
    );

    const moduleKeys = new Set(["scheduler", "webhooks"]);
    const { err } = await captureOutput(async () => {
      await makeProgram(scopeRoot, moduleKeys).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(err).toBe("");
  });

  it("warns about keys not in core or module sets", async () => {
    trustScopeConfig(scopeRoot);
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ scheduler: {}, bogus: true }),
    );

    const moduleKeys = new Set(["scheduler"]);
    const { err } = await captureOutput(async () => {
      await makeProgram(scopeRoot, moduleKeys).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(err).toContain('Unknown key "bogus"');
    expect(err).not.toContain("scheduler");
  });

  it("does not warn about known keys", async () => {
    trustScopeConfig(scopeRoot);
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6", modelTiers: { fast: "claude-haiku-4-5" } }),
    );

    const { err } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(err).toBe("");
  });

  it("--json outputs only resolved config JSON", async () => {
    trustScopeConfig(scopeRoot);
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-7" }),
    );

    const { out } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "validate", "--json"]);
    });
    const parsed = JSON.parse(out.trim());
    expect(parsed.model).toBe("claude-opus-4-7");
  });

  it("--json does not include source headers or warnings", async () => {
    trustScopeConfig(scopeRoot);
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-7", unknownKey: true }),
    );

    const { out, err } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "validate", "--json"]);
    });
    expect(out).not.toContain("Config sources");
    expect(err).toBe("");
    const parsed = JSON.parse(out.trim());
    expect(parsed).toBeDefined();
  });

  it("warns when untrusted scope config is ignored", async () => {
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({
        skipConfirmations: true,
        guardrails: { toolOverrides: { process: "allow" } },
      }),
    );

    const { err } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "validate"]);
    });
    expect(err).toContain("ignored untrusted scope config");
    expect(err).toContain(join(scopeRoot, ".kota", "config.json"));
    expect(err).toContain("trustedScopes");
  });
});

describe("kota config get", () => {
  let scopeRoot: string;
  let origCwd: string;

  beforeEach(() => {
    scopeRoot = makeScopeRoot();
    origCwd = process.cwd();
    process.chdir(scopeRoot);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("prints top-level string value", async () => {
    trustScopeConfig(scopeRoot);
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-7" }),
    );

    const { out } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "get", "model"]);
    });
    expect(out.trim()).toBe("claude-opus-4-7");
  });

  it("prints nested value via dot-notation", async () => {
    trustScopeConfig(scopeRoot);
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota", "config.json"),
      JSON.stringify({ daemon: { shutdownGracePeriodMs: 12345 } }),
    );

    const { out } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "get", "daemon.shutdownGracePeriodMs"]);
    });
    expect(out.trim()).toBe("12345");
  });

  it("exits non-zero for missing key", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit");
    });
    await expect(
      captureOutput(async () => {
        await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "get", "nonexistent"]);
      }),
    ).rejects.toThrow();
    exitSpy.mockRestore();
  });
});

describe("kota config set", () => {
  let scopeRoot: string;
  let origCwd: string;

  beforeEach(() => {
    scopeRoot = makeScopeRoot();
    origCwd = process.cwd();
    process.chdir(scopeRoot);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("writes string value when not valid JSON", async () => {
    await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "set", "model", "claude-opus-4-7"]);
    });
    const written = JSON.parse(readFileSync(join(scopeRoot, ".kota", "config.json"), "utf-8"));
    expect(written.model).toBe("claude-opus-4-7");
  });

  it("creates the scope config file if it does not exist", async () => {
    expect(existsSync(join(scopeRoot, ".kota", "config.json"))).toBe(false);
    await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "set", "model", "claude-opus-4-7"]);
    });
    expect(existsSync(join(scopeRoot, ".kota", "config.json"))).toBe(true);
  });

  it("supports nested key via dot-notation", async () => {
    await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "set", "daemon.shutdownGracePeriodMs", "9000"]);
    });
    const written = JSON.parse(readFileSync(join(scopeRoot, ".kota", "config.json"), "utf-8"));
    expect(written.daemon.shutdownGracePeriodMs).toBe(9000);
  });

  it("warns for unrecognised key", async () => {
    const { err } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "set", "unknownKey", "value"]);
    });
    expect(err).toContain("not a recognised config key");
  });

  it("does not warn when setting a module-registered key", async () => {
    const moduleKeys = new Set(["scheduler"]);
    const { err } = await captureOutput(async () => {
      await makeProgram(scopeRoot, moduleKeys).parseAsync(["node", "kota", "config", "set", "scheduler.concurrency", "2"]);
    });
    expect(err).toBe("");
    const written = JSON.parse(readFileSync(join(scopeRoot, ".kota", "config.json"), "utf-8"));
    expect(written.scheduler.concurrency).toBe(2);
  });
});

describe("kota config schema", () => {
  let scopeRoot: string;
  beforeEach(() => {
    scopeRoot = makeScopeRoot();
  });
  afterEach(() => {
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("prints the path to the schema file", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "schema"]);
    });
    const schemaPath = out.trim();
    expect(schemaPath).toMatch(/kota-config\.schema\.json$/);
    expect(existsSync(schemaPath)).toBe(true);
  });

  it("schema file exists and is valid JSON Schema", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "schema"]);
    });
    const schemaPath = resolve(out.trim());
    const content = JSON.parse(readFileSync(schemaPath, "utf-8"));
    expect(content.$schema).toMatch(/json-schema/);
    expect(content.type).toBe("object");
    expect(content.properties).toBeDefined();
  });

  it("--print outputs schema content", async () => {
    const { out } = await captureOutput(async () => {
      await makeProgram(scopeRoot).parseAsync(["node", "kota", "config", "schema", "--print"]);
    });
    const content = JSON.parse(out.trim());
    expect(content.$schema).toBeDefined();
    expect(content.properties).toBeDefined();
  });

  it("committed schema matches generated output (run pnpm build:schema to fix)", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const root = resolve(import.meta.dirname, "../../..");
    const tmpOut = join(tmpdir(), `kota-schema-drift-check-${Date.now()}.json`);
    execSync(
      `KOTA_SCHEMA_OUT=${tmpOut} node --conditions=source --import tsx src/core/config/build-schema.ts`,
      {
        cwd: root,
        stdio: "ignore",
      },
    );
    const generated = readFileSync(tmpOut, "utf-8");
    const committed = readFileSync(resolve(root, "schema/kota-config.schema.json"), "utf-8");
		rmSync(tmpOut, { force: true });
		expect(committed).toBe(generated);
	});
});
