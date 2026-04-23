import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentHarness, AgentHarnessResult } from "#core/agent-harness/index.js";
import { resetHarnessHooks } from "#core/agent-harness/index.js";
import { runScenarioAcrossHarnesses, runScenarioOnHarness } from "./runner.js";
import { loadScenario } from "./scenario.js";

function writeMinimalScenario(scenariosRoot: string, id = "fix-add"): void {
  const dir = join(scenariosRoot, id);
  mkdirSync(join(dir, "initial"), { recursive: true });
  writeFileSync(
    join(dir, "scenario.json"),
    JSON.stringify({
      id,
      description: "fix add",
      prompt: "fix add",
      verification: {
        command: "node -e \"require('./add.js').add(2,3)===5 || process.exit(1)\"",
        timeoutMs: 10_000,
      },
    }),
  );
  writeFileSync(
    join(dir, "initial", "add.js"),
    "exports.add = (a, b) => a - b;\n",
  );
}

function makeHarness(
  name: string,
  behavior: (workingDir: string) => Promise<void> | void,
  overrides: Partial<AgentHarnessResult> = {},
): AgentHarness {
  return {
    name,
    description: `test harness ${name}`,
    supportsMultiTurn: true,
    supportedHookKinds: ["preRun", "postRun"] as const,
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    async run(options, writer) {
      const cwd = options.cwd ?? process.cwd();
      await behavior(cwd);
      writer?.write(`[${name}] ran with prompt: ${options.prompt}\n`);
      return {
        text: `[${name}] done`,
        streamedText: `[${name}] done`,
        turns: 1,
        isError: false,
        ...overrides,
      };
    },
  };
}

describe("harness-parity runner", () => {
  let scenariosRoot: string;
  let outRoot: string;

  beforeEach(() => {
    resetHarnessHooks();
    scenariosRoot = mkdtempSync(join(tmpdir(), "kota-parity-scenarios-"));
    outRoot = mkdtempSync(join(tmpdir(), "kota-parity-out-"));
    writeMinimalScenario(scenariosRoot);
  });

  afterEach(() => {
    resetHarnessHooks();
    rmSync(scenariosRoot, { recursive: true, force: true });
    rmSync(outRoot, { recursive: true, force: true });
  });

  it("passes verification when the harness applies the expected fix", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const harness = makeHarness("fixing", (workingDir) => {
      writeFileSync(
        join(workingDir, "add.js"),
        "exports.add = (a, b) => a + b;\n",
      );
    });

    const artifact = await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    expect(artifact.verification.passed).toBe(true);
    expect(artifact.changedFiles).toContain("add.js");
    expect(artifact.harnessName).toBe("fixing");
    expect(artifact.isError).toBe(false);
    expect(artifact.effort).toBe("xhigh");

    const meta = JSON.parse(
      readFileSync(join(artifact.artifactDir, "run-meta.json"), "utf-8"),
    );
    expect(meta.verification.passed).toBe(true);
    expect(meta.effort).toBe("xhigh");

    const summary = readFileSync(
      join(artifact.artifactDir, "trace-summary.md"),
      "utf-8",
    );
    expect(summary).toContain("- effort: xhigh");

    const trace = readFileSync(join(artifact.artifactDir, "trace.txt"), "utf-8");
    expect(trace).toContain("ran with prompt");

    const diff = readFileSync(join(artifact.artifactDir, "diff.patch"), "utf-8");
    expect(diff).toContain("add.js");
  });

  it("records a verification failure when the harness leaves the bug in place", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const harness = makeHarness("text-only", () => {
      // Simulates thin harness: text response, no file edits.
    });

    const artifact = await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    expect(artifact.verification.passed).toBe(false);
    expect(artifact.changedFiles).toEqual([]);
    expect(artifact.isError).toBe(false);
  });

  it("captures harness errors without crashing the runner", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const failing: AgentHarness = {
      name: "broken",
      description: "broken",
      supportsMultiTurn: true,
      supportedHookKinds: ["preRun", "postRun"] as const,
      askOwnerToolName: null,
    emitsAgentMessageStream: false,
      async run() {
        throw new Error("adapter exploded");
      },
    };

    const artifact = await runScenarioOnHarness({
      scenario,
      harness: failing,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    expect(artifact.isError).toBe(true);
    expect(artifact.verification.passed).toBe(false);
    const meta = JSON.parse(
      readFileSync(join(artifact.artifactDir, "run-meta.json"), "utf-8"),
    );
    expect(meta.error.message).toBe("adapter exploded");
  });

  it("writes paired artifacts under one directory per scenario across harnesses", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const passing = makeHarness("passing", (workingDir) => {
      writeFileSync(
        join(workingDir, "add.js"),
        "exports.add = (a, b) => a + b;\n",
      );
    });
    const failing = makeHarness("failing", () => {
      // no file change
    });

    const artifacts = await runScenarioAcrossHarnesses({
      scenario,
      harnesses: [passing, failing],
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    expect(artifacts.map((a) => a.harnessName)).toEqual(["passing", "failing"]);
    expect(artifacts[0]?.verification.passed).toBe(true);
    expect(artifacts[1]?.verification.passed).toBe(false);

    const parity = JSON.parse(
      readFileSync(join(outRoot, "fix-add", "parity.json"), "utf-8"),
    );
    expect(parity.artifacts).toHaveLength(2);
    expect(parity.artifacts[0].verificationPassed).toBe(true);
    expect(parity.artifacts[1].verificationPassed).toBe(false);
    expect(parity.artifacts[0].effort).toBe("xhigh");
    expect(parity.artifacts[1].effort).toBe("xhigh");
  });

  it("leaves the scenario initial/ tree untouched", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const harness = makeHarness("tampering", (workingDir) => {
      writeFileSync(
        join(workingDir, "add.js"),
        "exports.add = (a, b) => a + b;\n",
      );
    });

    await runScenarioOnHarness({
      scenario,
      harness,
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    const initialAdd = readFileSync(
      join(scenario.initialStateDir, "add.js"),
      "utf-8",
    );
    expect(initialAdd).toBe("exports.add = (a, b) => a - b;\n");
  });
});
