import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AgentHarness,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import {
  type HarnessParityDeps,
  listHarnessParityScenarios,
  runHarnessParity,
} from "./harness-parity-operations.js";

function writeScenario(scenariosRoot: string, id: string): void {
  const dir = join(scenariosRoot, id);
  mkdirSync(join(dir, "initial"), { recursive: true });
  writeFileSync(
    join(dir, "scenario.json"),
    JSON.stringify({
      id,
      description: `${id} description`,
      prompt: "do the thing",
      verification: { command: "true", timeoutMs: 1_000 },
    }),
  );
}

function createNoopHarness(): AgentHarness {
  return {
    name: "noop",
    description: "test no-op harness",
    supportsMultiTurn: true,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "kota",
    async run() {
      return {
        text: "done",
        streamedText: "done",
        turns: 1,
        isError: false,
      };
    },
  };
}

describe("harness-parity operations (local handler / daemon-down branch)", () => {
  let scenariosRoot: string;
  let evalFixturesRoot: string;
  let outRoot: string;
  let deps: HarnessParityDeps;

  beforeEach(() => {
    clearAgentHarnessRegistryForTest();
    scenariosRoot = mkdtempSync(join(tmpdir(), "kota-parity-ops-scenarios-"));
    evalFixturesRoot = mkdtempSync(join(tmpdir(), "kota-parity-ops-eval-"));
    outRoot = mkdtempSync(join(tmpdir(), "kota-parity-ops-out-"));
    deps = {
      projectDir: outRoot,
      scenariosRoot,
      evalFixturesRoot,
      defaultOutBaseDir: outRoot,
      kotaBinaryPath: join(process.cwd(), "bin/kota.mjs"),
      config: {},
    };
  });

  afterEach(() => {
    clearAgentHarnessRegistryForTest();
    rmSync(scenariosRoot, { recursive: true, force: true });
    rmSync(evalFixturesRoot, { recursive: true, force: true });
    rmSync(outRoot, { recursive: true, force: true });
  });

  it("lists every well-formed scenario sorted by id", () => {
    writeScenario(scenariosRoot, "alpha");
    writeScenario(scenariosRoot, "bravo");
    const result = listHarnessParityScenarios(deps);
    expect(result.scenarios.map((s) => s.id)).toEqual(["alpha", "bravo"]);
    expect(result.scenarios[0].description).toBe("alpha description");
  });

  it("returns an empty list when no scenarios are shipped", () => {
    expect(listHarnessParityScenarios(deps).scenarios).toEqual([]);
  });

  it("returns no_scenarios when the scenariosRoot exists but has no scenarios", async () => {
    const result = await runHarnessParity(deps, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_scenarios");
  });

  it("returns scenarios_load_error for an invalid scenario.json", async () => {
    const dir = join(scenariosRoot, "broken");
    mkdirSync(join(dir, "initial"), { recursive: true });
    writeFileSync(join(dir, "scenario.json"), "{ not valid json");
    const result = await runHarnessParity(deps, { scenarios: ["broken"] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("scenarios_load_error");
      expect(result.message).toContain("broken");
    }
  });

  it("rejects traversal scenario ids before an escaped verifier can run", async () => {
    registerAgentHarness(createNoopHarness());
    const escapedDir = mkdtempSync(
      join(dirname(scenariosRoot), "kota-parity-ops-escaped-"),
    );
    const traversalId = `../${basename(escapedDir)}`;
    const sentinelPath = join(outRoot, "escaped-verifier-ran.txt");
    try {
      mkdirSync(join(escapedDir, "initial"), { recursive: true });
      writeFileSync(
        join(escapedDir, "scenario.json"),
        JSON.stringify({
          id: traversalId,
          description: "escaped scenario",
          prompt: "do the thing",
          verification: {
            command: `node -e 'require("node:fs").writeFileSync(${JSON.stringify(
              sentinelPath,
            )}, "ran")'`,
            timeoutMs: 1_000,
          },
        }),
      );

      const result = await runHarnessParity(deps, {
        scenarios: [traversalId],
        harnesses: ["noop"],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("scenarios_load_error");
        expect(result.message).toContain("requested scenario id");
      }
      expect(existsSync(sentinelPath)).toBe(false);
    } finally {
      rmSync(escapedDir, { recursive: true, force: true });
    }
  });

  it("returns invalid_max_turns for a non-positive maxTurns", async () => {
    writeScenario(scenariosRoot, "demo");
    const result = await runHarnessParity(deps, {
      scenarios: ["demo"],
      maxTurns: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_max_turns");
  });

  it("returns no_harnesses when scenarios load but no harness is registered", async () => {
    writeScenario(scenariosRoot, "demo");
    const result = await runHarnessParity(deps, { scenarios: ["demo"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_harnesses");
  });
});
