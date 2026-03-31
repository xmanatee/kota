import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerConfigCommands } from "./config-cli.js";

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

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerConfigCommands(program);
  return program;
}

function captureOutput(fn: () => void): { out: string; err: string } {
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
    fn();
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

  it("shows no sources when no config files exist", () => {
    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "validate"]);
    });
    expect(out).toContain("none found");
  });

  it("shows project source path when project config exists", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-6" }),
    );

    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "validate"]);
    });
    expect(out).toContain("project");
    expect(out).toContain(".kota");
  });

  it("includes resolved config in output", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-6", maxTokens: 4096 }),
    );

    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "validate"]);
    });
    expect(out).toContain("claude-opus-4-6");
    expect(out).toContain("4096");
  });

  it("warns about unknown top-level keys", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6", modelTier: "fast" }),
    );

    const { err } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "validate"]);
    });
    expect(err).toContain('Unknown key "modelTier"');
    expect(err).toContain("project");
  });

  it("does not warn about known keys", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-sonnet-4-6", modelTiers: { fast: "claude-haiku-4-5" } }),
    );

    const { err } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "validate"]);
    });
    expect(err).toBe("");
  });

  it("--json outputs only resolved config JSON", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-6" }),
    );

    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "validate", "--json"]);
    });
    const parsed = JSON.parse(out.trim());
    expect(parsed.model).toBe("claude-opus-4-6");
  });

  it("--json does not include source headers or warnings", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-6", unknownKey: true }),
    );

    const { out, err } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "validate", "--json"]);
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

  it("prints top-level string value", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ model: "claude-opus-4-6" }),
    );

    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "get", "model"]);
    });
    expect(out.trim()).toBe("claude-opus-4-6");
  });

  it("prints nested value via dot-notation", () => {
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    writeFileSync(
      join(projectDir, ".kota", "config.json"),
      JSON.stringify({ daemon: { shutdownGracePeriodMs: 12345 } }),
    );

    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "get", "daemon.shutdownGracePeriodMs"]);
    });
    expect(out.trim()).toBe("12345");
  });

  it("exits non-zero for missing key", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit");
    });
    expect(() => {
      captureOutput(() => {
        makeProgram().parse(["node", "kota", "config", "get", "nonexistent"]);
      });
    }).toThrow();
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

  it("writes numeric value to project config", () => {
    captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "set", "dailyBudgetUsd", "5"]);
    });
    const written = JSON.parse(readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"));
    expect(written.dailyBudgetUsd).toBe(5);
  });

  it("writes string value when not valid JSON", () => {
    captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "set", "model", "claude-opus-4-6"]);
    });
    const written = JSON.parse(readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"));
    expect(written.model).toBe("claude-opus-4-6");
  });

  it("creates project config file if it does not exist", () => {
    expect(existsSync(join(projectDir, ".kota", "config.json"))).toBe(false);
    captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "set", "dailyBudgetUsd", "10"]);
    });
    expect(existsSync(join(projectDir, ".kota", "config.json"))).toBe(true);
  });

  it("supports nested key via dot-notation", () => {
    captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "set", "daemon.shutdownGracePeriodMs", "9000"]);
    });
    const written = JSON.parse(readFileSync(join(projectDir, ".kota", "config.json"), "utf-8"));
    expect(written.daemon.shutdownGracePeriodMs).toBe(9000);
  });

  it("warns for unrecognised key", () => {
    const { err } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "config", "set", "unknownKey", "value"]);
    });
    expect(err).toContain("not a recognised config key");
  });
});
