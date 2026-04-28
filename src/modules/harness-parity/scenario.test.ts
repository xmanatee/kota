import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadAllScenarios,
  loadScenario,
  ScenarioLoadError,
} from "./scenario.js";

const SHIPPED_SCENARIOS_ROOT = join(import.meta.dirname, "scenarios");

function writeScenario(
  scenariosRoot: string,
  id: string,
  spec: Record<string, unknown>,
  initialFiles: Record<string, string> = {},
): string {
  const dir = join(scenariosRoot, id);
  mkdirSync(join(dir, "initial"), { recursive: true });
  writeFileSync(join(dir, "scenario.json"), JSON.stringify(spec, null, 2));
  for (const [relPath, contents] of Object.entries(initialFiles)) {
    const fullPath = join(dir, "initial", relPath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, contents);
  }
  return dir;
}

describe("scenario loader", () => {
  let scenariosRoot: string;
  beforeEach(() => {
    scenariosRoot = mkdtempSync(join(tmpdir(), "kota-harness-parity-scenarios-"));
  });
  afterEach(() => {
    rmSync(scenariosRoot, { recursive: true, force: true });
  });

  it("loads a well-formed scenario", () => {
    writeScenario(
      scenariosRoot,
      "demo",
      {
        id: "demo",
        description: "demo scenario",
        prompt: "do the thing",
        verification: { command: "true", timeoutMs: 10_000 },
      },
      { "hello.txt": "hi" },
    );
    const loaded = loadScenario(scenariosRoot, "demo");
    expect(loaded.spec.id).toBe("demo");
    expect(loaded.spec.prompt).toBe("do the thing");
    expect(loaded.spec.verification.timeoutMs).toBe(10_000);
  });

  it("defaults verification.timeoutMs when omitted", () => {
    writeScenario(
      scenariosRoot,
      "demo",
      {
        id: "demo",
        description: "demo scenario",
        prompt: "do the thing",
        verification: { command: "true" },
      },
      { "hello.txt": "hi" },
    );
    const loaded = loadScenario(scenariosRoot, "demo");
    expect(loaded.spec.verification.timeoutMs).toBe(60_000);
  });

  it("rejects an id mismatch between directory and scenario.json", () => {
    writeScenario(
      scenariosRoot,
      "demo",
      {
        id: "other",
        description: "demo",
        prompt: "do the thing",
        verification: { command: "true" },
      },
      { "hello.txt": "hi" },
    );
    expect(() => loadScenario(scenariosRoot, "demo")).toThrow(ScenarioLoadError);
  });

  it("rejects missing verification object", () => {
    writeScenario(
      scenariosRoot,
      "demo",
      {
        id: "demo",
        description: "demo",
        prompt: "do the thing",
      },
      { "hello.txt": "hi" },
    );
    expect(() => loadScenario(scenariosRoot, "demo")).toThrow(ScenarioLoadError);
  });

  it("rejects missing initial/ directory", () => {
    const dir = join(scenariosRoot, "demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "scenario.json"),
      JSON.stringify({
        id: "demo",
        description: "demo",
        prompt: "do the thing",
        verification: { command: "true" },
      }),
    );
    expect(() => loadScenario(scenariosRoot, "demo")).toThrow(ScenarioLoadError);
  });

  it("loadAllScenarios returns scenarios sorted by id and skips non-scenario directories", () => {
    writeScenario(
      scenariosRoot,
      "b-second",
      {
        id: "b-second",
        description: "b",
        prompt: "b",
        verification: { command: "true" },
      },
      { "x.txt": "x" },
    );
    writeScenario(
      scenariosRoot,
      "a-first",
      {
        id: "a-first",
        description: "a",
        prompt: "a",
        verification: { command: "true" },
      },
      { "x.txt": "x" },
    );
    mkdirSync(join(scenariosRoot, "not-a-scenario"), { recursive: true });

    const all = loadAllScenarios(scenariosRoot);
    expect(all.map((s) => s.spec.id)).toEqual(["a-first", "b-second"]);
  });

  it("returns [] when scenariosRoot does not exist", () => {
    rmSync(scenariosRoot, { recursive: true, force: true });
    expect(loadAllScenarios(scenariosRoot)).toEqual([]);
  });
});

describe("shipped scenarios", () => {
  it("covers the arithmetic-fix smoke, the multi-file workload, the failure-and-revise probe, the discovery probe, and the cross-file rename probe", () => {
    const all = loadAllScenarios(SHIPPED_SCENARIOS_ROOT);
    const ids = all.map((s) => s.spec.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "fix-arithmetic-bug",
        "extract-shared-helper",
        "revise-from-test-output",
        "discover-failing-source",
        "rename-across-files",
      ]),
    );
    // Guard against regressions that accidentally drop coverage back to a
    // single fixture. If a new scenario is added, bump this bound deliberately.
    expect(all.length).toBeGreaterThanOrEqual(5);
  });

  it("extract-shared-helper loads with prompt and verification resolved", () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "extract-shared-helper");
    expect(loaded.spec.id).toBe("extract-shared-helper");
    expect(loaded.spec.prompt.length).toBeGreaterThan(0);
    expect(loaded.spec.prompt).toMatch(/src\/sanitize\.js/);
    expect(loaded.spec.verification.command).toBe("node test.js");
    expect(loaded.spec.verification.timeoutMs).toBeGreaterThan(0);
    expect(existsSync(loaded.initialStateDir)).toBe(true);
    expect(statSync(loaded.initialStateDir).isDirectory()).toBe(true);
  });

  it("extract-shared-helper materializes into a fresh tmpdir and is solvable by hand", () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "extract-shared-helper");
    const workDir = mkdtempSync(join(tmpdir(), "kota-harness-parity-shipped-"));
    try {
      cpSync(loaded.initialStateDir, workDir, { recursive: true });
      expect(existsSync(join(workDir, "test.js"))).toBe(true);
      expect(existsSync(join(workDir, "src/greet.js"))).toBe(true);
      expect(existsSync(join(workDir, "src/farewell.js"))).toBe(true);

      // Verification fails before the fix — sanitize.js does not exist and
      // farewell() throws. The capability-gap path relies on that.
      const beforeFix = spawnSync(loaded.spec.verification.command, {
        shell: true,
        cwd: workDir,
        timeout: loaded.spec.verification.timeoutMs,
        encoding: "utf-8",
      });
      expect(beforeFix.status).not.toBe(0);

      // Apply the expected fix by hand and re-run: verification must pass.
      writeFileSync(
        join(workDir, "src/sanitize.js"),
        'function sanitize(raw) {\n' +
          '  return String(raw).trim().replace(/[^a-zA-Z0-9 ]/g, "");\n' +
          '}\n\nmodule.exports = { sanitize };\n',
      );
      writeFileSync(
        join(workDir, "src/greet.js"),
        'const { sanitize } = require("./sanitize.js");\n\n' +
          'function greet(raw) {\n' +
          '  return `Hello, ${sanitize(raw)}!`;\n' +
          '}\n\nmodule.exports = { greet };\n',
      );
      writeFileSync(
        join(workDir, "src/farewell.js"),
        'const { sanitize } = require("./sanitize.js");\n\n' +
          'function farewell(raw) {\n' +
          '  return `Goodbye, ${sanitize(raw)}!`;\n' +
          '}\n\nmodule.exports = { farewell };\n',
      );
      const afterFix = spawnSync(loaded.spec.verification.command, {
        shell: true,
        cwd: workDir,
        timeout: loaded.spec.verification.timeoutMs,
        encoding: "utf-8",
      });
      expect(afterFix.status).toBe(0);
      expect(afterFix.stdout).toContain("ok");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("discover-failing-source loads with a symptom-only prompt that does not name the buggy file", () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "discover-failing-source");
    expect(loaded.spec.id).toBe("discover-failing-source");
    expect(loaded.spec.prompt.length).toBeGreaterThan(0);
    expect(loaded.spec.verification.command).toBe("node test.js");
    // The prompt names only the verification command and the project as a
    // whole — no `src/...` file path leaks the location of the bug. The
    // agent must search the project on its own.
    expect(loaded.spec.prompt).not.toMatch(/src\/normalize\.js/);
    expect(loaded.spec.prompt).not.toMatch(/src\/slugify\.js/);
    expect(loaded.spec.prompt).not.toMatch(/src\/tokenize\.js/);
    expect(loaded.spec.prompt).not.toMatch(/src\/assemble\.js/);
    expect(existsSync(loaded.initialStateDir)).toBe(true);
    expect(statSync(loaded.initialStateDir).isDirectory()).toBe(true);
  });

  it("discover-failing-source ships realistic distractors, fails verification before any edit, and is solvable by editing exactly one source file", () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "discover-failing-source");
    const workDir = mkdtempSync(join(tmpdir(), "kota-harness-parity-discover-"));
    try {
      cpSync(loaded.initialStateDir, workDir, { recursive: true });
      // The discovery dimension requires at least three real source files
      // alongside test.js — one buggy, the others realistic distractors.
      // test.js itself imports only the entry module, so a harness that
      // stops at test.js's named imports cannot find the bug.
      expect(existsSync(join(workDir, "test.js"))).toBe(true);
      expect(existsSync(join(workDir, "src/slugify.js"))).toBe(true);
      expect(existsSync(join(workDir, "src/tokenize.js"))).toBe(true);
      expect(existsSync(join(workDir, "src/normalize.js"))).toBe(true);
      expect(existsSync(join(workDir, "src/assemble.js"))).toBe(true);

      // Verification fails before the fix — exit non-zero is the only signal
      // an operator gives, mirroring symptom-level prompting.
      const beforeFix = spawnSync(loaded.spec.verification.command, {
        shell: true,
        cwd: workDir,
        timeout: loaded.spec.verification.timeoutMs,
        encoding: "utf-8",
      });
      expect(beforeFix.status).not.toBe(0);

      // Editing only the buggy file makes verification pass; the distractor
      // helpers are correct as shipped and need no change.
      writeFileSync(
        join(workDir, "src/normalize.js"),
        'function normalize(token) {\n  return token.toLowerCase();\n}\n\nmodule.exports = { normalize };\n',
      );
      const afterFix = spawnSync(loaded.spec.verification.command, {
        shell: true,
        cwd: workDir,
        timeout: loaded.spec.verification.timeoutMs,
        encoding: "utf-8",
      });
      expect(afterFix.status).toBe(0);
      expect(afterFix.stdout).toContain("ok");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("rename-across-files loads with a prompt that names the rename target and the verification command but does not enumerate caller files", () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "rename-across-files");
    expect(loaded.spec.id).toBe("rename-across-files");
    expect(loaded.spec.prompt.length).toBeGreaterThan(0);
    expect(loaded.spec.verification.command).toBe("node test.js");
    // The prompt names the rename target verbatim and the verification
    // command, so the agent has the contract.
    expect(loaded.spec.prompt).toMatch(/format/);
    expect(loaded.spec.prompt).toMatch(/renderLine/);
    expect(loaded.spec.prompt).toMatch(/node test\.js/);
    // The prompt does not enumerate the caller files. The agent must search
    // the project to find every call site.
    expect(loaded.spec.prompt).not.toMatch(/src\/greeting\.js/);
    expect(loaded.spec.prompt).not.toMatch(/src\/warning\.js/);
    expect(loaded.spec.prompt).not.toMatch(/src\/notice\.js/);
    expect(existsSync(loaded.initialStateDir)).toBe(true);
    expect(statSync(loaded.initialStateDir).isDirectory()).toBe(true);
  });

  it("rename-across-files isolates cross-file rename discipline: a partial rename leaves verification failing, and only a complete rename passes", () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "rename-across-files");

    // The fixture ships the renamed source plus three or more caller files
    // and a test.js that exercises every caller path. test.js itself does
    // not import the renamed function — every reference goes through one
    // of the caller files via src/index.js.
    const initialChildren = readdirSync(join(loaded.initialStateDir, "src"))
      .filter((name) => name.endsWith(".js"))
      .sort();
    expect(initialChildren).toEqual(
      ["format.js", "greeting.js", "index.js", "notice.js", "warning.js"].sort(),
    );
    const testSource = readFileSync(join(loaded.initialStateDir, "test.js"), "utf-8");
    expect(testSource).not.toMatch(/require\(["'][^"']*format\.js["']\)/);

    const workDir = mkdtempSync(join(tmpdir(), "kota-harness-parity-rename-"));
    try {
      cpSync(loaded.initialStateDir, workDir, { recursive: true });

      // Apply a partial rename: the definition file is renamed and one
      // caller (greeting.js) is updated, but warning.js and notice.js
      // still destructure `format`. Verification must fail because the
      // unchanged callers reference an undefined symbol that crashes
      // when test.js exercises their code path.
      writeFileSync(
        join(workDir, "src/format.js"),
        "function renderLine(label, body) {\n" +
          "  return `[${label}] ${body}`;\n" +
          "}\n\n" +
          "module.exports = { renderLine };\n",
      );
      writeFileSync(
        join(workDir, "src/greeting.js"),
        'const { renderLine } = require("./format.js");\n\n' +
          "function greeting(name) {\n" +
          "  return renderLine(\"greet\", `hello ${name}`);\n" +
          "}\n\n" +
          "module.exports = { greeting };\n",
      );
      const partial = spawnSync(loaded.spec.verification.command, {
        shell: true,
        cwd: workDir,
        timeout: loaded.spec.verification.timeoutMs,
        encoding: "utf-8",
      });
      expect(partial.status).not.toBe(0);
      expect(`${partial.stdout ?? ""}\n${partial.stderr ?? ""}`).toMatch(
        /format is not a function/,
      );

      // Now finish the rename in the remaining callers. Verification must
      // pass — every caller now refers to renderLine consistently.
      writeFileSync(
        join(workDir, "src/warning.js"),
        'const { renderLine } = require("./format.js");\n\n' +
          "function warning(message) {\n" +
          '  return renderLine("warn", message);\n' +
          "}\n\n" +
          "module.exports = { warning };\n",
      );
      writeFileSync(
        join(workDir, "src/notice.js"),
        'const { renderLine } = require("./format.js");\n\n' +
          "function notice(message) {\n" +
          '  return renderLine("notice", message);\n' +
          "}\n\n" +
          "module.exports = { notice };\n",
      );
      const complete = spawnSync(loaded.spec.verification.command, {
        shell: true,
        cwd: workDir,
        timeout: loaded.spec.verification.timeoutMs,
        encoding: "utf-8",
      });
      expect(complete.status).toBe(0);
      expect(complete.stdout).toContain("ok");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("revise-from-test-output loads, fails verification before any edit, and surfaces the expected value in the failure output", () => {
    const loaded = loadScenario(SHIPPED_SCENARIOS_ROOT, "revise-from-test-output");
    expect(loaded.spec.id).toBe("revise-from-test-output");
    expect(loaded.spec.prompt.length).toBeGreaterThan(0);
    expect(loaded.spec.prompt).toMatch(/src\/secret\.js/);
    expect(loaded.spec.verification.command).toBe("node test.js");

    const workDir = mkdtempSync(join(tmpdir(), "kota-harness-parity-revise-"));
    try {
      cpSync(loaded.initialStateDir, workDir, { recursive: true });
      expect(existsSync(join(workDir, "test.js"))).toBe(true);
      expect(existsSync(join(workDir, "src/secret.js"))).toBe(true);

      // The naive initial tree must fail verification — a harness that
      // never runs the test cannot discover the expected value.
      const beforeFix = spawnSync(loaded.spec.verification.command, {
        shell: true,
        cwd: workDir,
        timeout: loaded.spec.verification.timeoutMs,
        encoding: "utf-8",
      });
      expect(beforeFix.status).not.toBe(0);

      // The failure output must carry the exact expected string — this is
      // the information the agent is supposed to read back from the tool
      // result and use to revise src/secret.js.
      const combinedOutput = [beforeFix.stdout ?? "", beforeFix.stderr ?? ""].join("\n");
      const match = combinedOutput.match(
        /secret\(\) must return exactly "([a-z0-9]+)"/,
      );
      expect(match).not.toBeNull();
      const revealedExpected = match?.[1] ?? "";
      expect(revealedExpected.length).toBeGreaterThan(0);

      // Writing exactly the revealed string makes verification pass.
      writeFileSync(
        join(workDir, "src/secret.js"),
        `function secret() {\n  return ${JSON.stringify(revealedExpected)};\n}\n\nmodule.exports = { secret };\n`,
      );
      const afterFix = spawnSync(loaded.spec.verification.command, {
        shell: true,
        cwd: workDir,
        timeout: loaded.spec.verification.timeoutMs,
        encoding: "utf-8",
      });
      expect(afterFix.status).toBe(0);
      expect(afterFix.stdout).toContain("ok");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
