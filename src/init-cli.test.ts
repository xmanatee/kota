import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerInitCommand, runInit } from "./init-cli.js";

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `kota-init-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerInitCommand(program);
  return program;
}

function captureOutput(fn: () => void): { out: string; err: string } {
  const outLines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { outLines.push(`${args.join(" ")}\n`); };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return { out: outLines.join(""), err: "" };
}

describe("runInit", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("creates kota.config.ts in an empty directory", () => {
    runInit(tmpDir, false);
    expect(existsSync(join(tmpDir, "kota.config.ts"))).toBe(true);
  });

  it("creates data/inbox and all normalized task subdirectories", () => {
    runInit(tmpDir, false);
    expect(existsSync(join(tmpDir, "data", "inbox"))).toBe(true);
    const states = ["ready", "doing", "backlog", "blocked", "done", "dropped"];
    for (const state of states) {
      expect(existsSync(join(tmpDir, "data", "tasks", state))).toBe(true);
    }
  });

  it("creates AGENTS.md in inbox and each normalized task subdirectory", () => {
    runInit(tmpDir, false);
    expect(existsSync(join(tmpDir, "data", "inbox", "AGENTS.md"))).toBe(true);
    const states = ["ready", "doing", "backlog", "blocked", "done", "dropped"];
    for (const state of states) {
      expect(existsSync(join(tmpDir, "data", "tasks", state, "AGENTS.md"))).toBe(true);
    }
  });

  it("creates docs/ directory with AGENTS.md", () => {
    runInit(tmpDir, false);
    expect(existsSync(join(tmpDir, "docs", "AGENTS.md"))).toBe(true);
  });

  it("creates .kota/ runtime directory", () => {
    runInit(tmpDir, false);
    expect(existsSync(join(tmpDir, ".kota"))).toBe(true);
  });

  it("kota.config.ts contains module comment blocks", () => {
    runInit(tmpDir, false);
    const content = readFileSync(join(tmpDir, "kota.config.ts"), "utf-8");
    expect(content).toContain("telegram");
    expect(content).toContain("slack");
    expect(content).toContain("webhook");
  });

  it("is idempotent: second run skips existing files", () => {
    const first = runInit(tmpDir, false);
    const second = runInit(tmpDir, false);
    expect(first.created.length).toBeGreaterThan(0);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toContain(join(tmpDir, "kota.config.ts"));
  });

  it("idempotent: existing file content is not overwritten", () => {
    runInit(tmpDir, false);
    const configPath = join(tmpDir, "kota.config.ts");
    writeFileSync(configPath, "// my custom config", "utf-8");
    runInit(tmpDir, false);
    expect(readFileSync(configPath, "utf-8")).toBe("// my custom config");
  });

  it("--force overwrites kota.config.ts", () => {
    runInit(tmpDir, false);
    const configPath = join(tmpDir, "kota.config.ts");
    writeFileSync(configPath, "// my custom config", "utf-8");
    const result = runInit(tmpDir, true);
    expect(result.created).toContain(configPath);
    expect(readFileSync(configPath, "utf-8")).not.toBe("// my custom config");
  });

  it("--force does not overwrite inbox AGENTS.md", () => {
    runInit(tmpDir, false);
    const inboxAgents = join(tmpDir, "data", "inbox", "AGENTS.md");
    writeFileSync(inboxAgents, "# My custom inbox\n", "utf-8");
    runInit(tmpDir, true);
    expect(readFileSync(inboxAgents, "utf-8")).toBe("# My custom inbox\n");
  });

  it("returns created and skipped lists", () => {
    const result = runInit(tmpDir, false);
    expect(result.created).toContain(join(tmpDir, "kota.config.ts"));
    expect(result.skipped).toHaveLength(0);
  });

  it("works when data/ subdirs already exist", () => {
    mkdirSync(join(tmpDir, "data", "inbox"), { recursive: true });
    writeFileSync(join(tmpDir, "data", "inbox", "AGENTS.md"), "# Existing\n", "utf-8");
    runInit(tmpDir, false);
    expect(readFileSync(join(tmpDir, "data", "inbox", "AGENTS.md"), "utf-8")).toBe("# Existing\n");
  });
});

describe("kota init command", () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scaffolds a project and prints created files", () => {
    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "init"]);
    });
    expect(out).toContain("Created:");
    expect(out).toContain("kota.config.ts");
  });

  it("prints next steps after scaffolding", () => {
    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "init"]);
    });
    expect(out).toContain("kota doctor");
    expect(out).toContain("docs/");
  });

  it("second run shows skipped files", () => {
    makeProgram().parse(["node", "kota", "init"]);
    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "init"]);
    });
    expect(out).toContain("Skipped");
    expect(out).not.toContain("Created:");
  });

  it("--force flag is accepted and overwrites config", () => {
    makeProgram().parse(["node", "kota", "init"]);
    writeFileSync(join(tmpDir, "kota.config.ts"), "// custom", "utf-8");
    const { out } = captureOutput(() => {
      makeProgram().parse(["node", "kota", "init", "--force"]);
    });
    expect(out).toContain("Created:");
    expect(readFileSync(join(tmpDir, "kota.config.ts"), "utf-8")).not.toBe("// custom");
  });
});
