import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModuleStorage } from "#core/modules/module-storage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import moduleManagerModule from "./index.js";

const stubCtx: ModuleContext = {
  cwd: "/tmp/test",
  verbose: false,
  config: {} as ModuleContext["config"],
  storage: new ModuleStorage("/tmp/test", "module-manager"),
  registerGroup: () => {},
  getRoutes: () => [],
  getContributedWorkflows: () => [],
  getContributedChannels: () => [],
  getContributedControlRoutes: () => [],
  getModuleSummaries: () => [],
  getModuleConfig: () => undefined,
  log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  getSecret: () => null,
  listTools: () => [],
  events: { emit: () => {}, subscribe: () => () => {}, listenerCount: () => 0 },
  createSession: () => ({ send: async () => "", close: () => {} }),
  registerProvider: () => {},
  getProvider: () => null,
  callTool: async () => ({ content: "" }),
  registerMiddleware: () => {},
  registerDynamicStateProvider: () => {},
  registerCleanupHook: () => {},
  registerPreSendHook: () => {},
  registerHarnessHook: () => {},
  resolveAgentDef: () => undefined,
  resolveSkillsPrompt: () => "",
  probeHealthChecks: async () => ({}),
  getRegisteredConfigKeys: () => new Set<string>(),
  client: {} as never,
};

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `kota-ext-cli-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  const cmds = moduleManagerModule.commands!(stubCtx);
  for (const cmd of cmds) program.addCommand(cmd);
  return program;
}

function captureOutput(fn: () => void): { out: string; err: string } {
  const outLines: string[] = [];
  const errLines: string[] = [];
  // biome-ignore lint/suspicious/noConsole: test harness captures console output via swap
  const logSpy = console.log;
  const errSpy = console.error;
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args: unknown[]) => { outLines.push(`${args.join(" ")}\n`); };
  console.error = (...args: unknown[]) => { errLines.push(`${args.join(" ")}\n`); };
  process.stdout.write = ((data: string | Uint8Array) => {
    outLines.push(typeof data === "string" ? data : Buffer.from(data).toString("utf-8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    console.log = logSpy;
    console.error = errSpy;
    process.stdout.write = stdoutWrite;
  }
  return { out: outLines.join(""), err: errLines.join("") };
}

describe("kota module new (TypeScript, default)", () => {
  let tmpDir: string;
  let scaffoldDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    scaffoldDir = join(tmpDir, "my-ext");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates package.json with the safe name", () => {
    const program = makeProgram();
    program.parse(["module", "new", "my-ext", "--dir", scaffoldDir], { from: "user" });
    expect(existsSync(join(scaffoldDir, "package.json"))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(scaffoldDir, "package.json"), "utf-8"));
    expect(pkg.name).toBe("my-ext");
  });

  it("creates tsconfig.json", () => {
    const program = makeProgram();
    program.parse(["module", "new", "my-ext", "--dir", scaffoldDir], { from: "user" });
    expect(existsSync(join(scaffoldDir, "tsconfig.json"))).toBe(true);
  });

  it("creates src/index.ts with KotaModule export", () => {
    const program = makeProgram();
    program.parse(["module", "new", "my-ext", "--dir", scaffoldDir], { from: "user" });
    const indexPath = join(scaffoldDir, "src", "index.ts");
    expect(existsSync(indexPath)).toBe(true);
    const content = readFileSync(indexPath, "utf-8");
    expect(content).toContain("KotaModule");
    expect(content).toContain("export default module");
  });

  it("creates AGENTS.md", () => {
    const program = makeProgram();
    program.parse(["module", "new", "my-ext", "--dir", scaffoldDir], { from: "user" });
    expect(existsSync(join(scaffoldDir, "AGENTS.md"))).toBe(true);
  });

  it("prints scaffold path to stdout", () => {
    const program = makeProgram();
    const { out } = captureOutput(() => {
      program.parse(["module", "new", "my-ext", "--dir", scaffoldDir], { from: "user" });
    });
    expect(out).toContain("scaffold created at");
    expect(out).toContain(scaffoldDir);
  });

  it("errors if the target directory already exists", () => {
    mkdirSync(scaffoldDir, { recursive: true });
    const program = makeProgram();
    let exited = false;
    try {
      captureOutput(() => {
        program.parse(["module", "new", "my-ext", "--dir", scaffoldDir], { from: "user" });
      });
    } catch {
      exited = true;
    }
    expect(exited).toBe(true);
  });
});

describe("kota module new --language python", () => {
  let tmpDir: string;
  let scaffoldDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    scaffoldDir = join(tmpDir, "my-py-ext");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates main.py", () => {
    const program = makeProgram();
    program.parse(["module", "new", "my-py-ext", "--language", "python", "--dir", scaffoldDir], { from: "user" });
    expect(existsSync(join(scaffoldDir, "main.py"))).toBe(true);
  });

  it("creates requirements.txt", () => {
    const program = makeProgram();
    program.parse(["module", "new", "my-py-ext", "--language", "python", "--dir", scaffoldDir], { from: "user" });
    expect(existsSync(join(scaffoldDir, "requirements.txt"))).toBe(true);
    expect(readFileSync(join(scaffoldDir, "requirements.txt"), "utf-8")).toBe("");
  });

  it("creates README.md with config registration instructions", () => {
    const program = makeProgram();
    program.parse(["module", "new", "my-py-ext", "--language", "python", "--dir", scaffoldDir], { from: "user" });
    const readme = readFileSync(join(scaffoldDir, "README.md"), "utf-8");
    expect(readme).toContain("foreignModules");
    expect(readme).toContain("stdio");
    expect(readme).toContain("my-py-ext");
  });

  it("creates .kota-config-snippet.json with stdio transport entry", () => {
    const program = makeProgram();
    program.parse(["module", "new", "my-py-ext", "--language", "python", "--dir", scaffoldDir], { from: "user" });
    const snippetPath = join(scaffoldDir, ".kota-config-snippet.json");
    expect(existsSync(snippetPath)).toBe(true);
    const snippet = JSON.parse(readFileSync(snippetPath, "utf-8"));
    expect(snippet.foreignModules).toBeDefined();
    expect(snippet.foreignModules[0].transport).toBe("stdio");
    expect(snippet.foreignModules[0].command).toBe("python3");
  });

  it("main.py contains manifest response and invoke handler", () => {
    const program = makeProgram();
    program.parse(["module", "new", "my-py-ext", "--language", "python", "--dir", scaffoldDir], { from: "user" });
    const mainPy = readFileSync(join(scaffoldDir, "main.py"), "utf-8");
    expect(mainPy).toContain("manifest");
    expect(mainPy).toContain("invoke");
    expect(mainPy).toContain("shutdown_ack");
    expect(mainPy).toContain("flush=True");
    expect(mainPy).toContain("my-py-ext");
  });

  it("main.py uses only stdlib imports", () => {
    const program = makeProgram();
    program.parse(["module", "new", "my-py-ext", "--language", "python", "--dir", scaffoldDir], { from: "user" });
    const mainPy = readFileSync(join(scaffoldDir, "main.py"), "utf-8");
    const importLines = mainPy.split("\n").filter((l) => l.startsWith("import ") || l.startsWith("from "));
    for (const line of importLines) {
      expect(line).toMatch(/^import (json|sys)|^from (json|sys)/);
    }
  });

  it("does not create TypeScript files", () => {
    const program = makeProgram();
    program.parse(["module", "new", "my-py-ext", "--language", "python", "--dir", scaffoldDir], { from: "user" });
    expect(existsSync(join(scaffoldDir, "package.json"))).toBe(false);
    expect(existsSync(join(scaffoldDir, "tsconfig.json"))).toBe(false);
  });

  it("prints scaffold path to stdout", () => {
    const program = makeProgram();
    const { out } = captureOutput(() => {
      program.parse(["module", "new", "my-py-ext", "--language", "python", "--dir", scaffoldDir], { from: "user" });
    });
    expect(out).toContain("scaffold created at");
    expect(out).toContain(scaffoldDir);
  });

  it("errors on unsupported language", () => {
    const program = makeProgram();
    let exited = false;
    try {
      captureOutput(() => {
        program.parse(["module", "new", "my-py-ext", "--language", "ruby", "--dir", scaffoldDir], { from: "user" });
      });
    } catch {
      exited = true;
    }
    expect(exited).toBe(true);
  });
});
