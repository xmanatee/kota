import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentHarnessReadiness, AgentHarnessUnsupportedOption } from "#core/agent-harness/index.js";
import { runScenarioAcrossHarnesses } from "./runner.js";
import { cleanupRunnerTestState, makeHarness, setupRunnerTestState } from "./runner.test-support.js";
import { loadScenario } from "./scenario.js";

describe("harness-parity runner readiness metadata", () => {
let scenariosRoot: string;
let outRoot: string;

beforeEach(() => {
  ({ scenariosRoot, outRoot } = setupRunnerTestState());
});

afterEach(() => {
  cleanupRunnerTestState({ scenariosRoot, outRoot });
});

  it("renders readiness-only unsupported options in trace and parity artifacts", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const unsupportedOptions: readonly AgentHarnessUnsupportedOption[] = [
      {
        runOption: "autonomyMode.supervised",
        option: 'autonomyMode="supervised"',
        reason: "Readiness-only fake harness cannot route approvals.",
      },
    ];
    const readiness: AgentHarnessReadiness = {
      adapterKind: "provider-sdk",
      localRuntime: {
        kind: "node-package",
        status: "ready",
        required: true,
        packageName: "fake-sdk",
        version: "1.0.0",
        summary: "fake-sdk available.",
      },
      localAuth: {
        kind: "harness-managed-login",
        status: "expiring",
        required: true,
        command: "fake auth status",
        detail: "fake login expires at 2026-06-22T00:30:00.000Z",
        summary: "fake login expires soon",
        expiresAt: "2026-06-22T00:30:00.000Z",
        renewalSummary: "run `fake login` before unattended runs",
      },
      optionalRuntimes: [],
      unsupportedOptions,
    };
    const harness = makeHarness(
      "readiness-only",
      (workingDir) => {
        writeFileSync(
          join(workingDir, "add.js"),
          "exports.add = (a, b) => a + b;\n",
        );
      },
      {},
      {
        readiness: () => readiness,
      },
    );

    const artifacts = await runScenarioAcrossHarnesses({
      scenario,
      harnesses: [harness],
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    const meta = JSON.parse(
      readFileSync(join(artifacts[0]!.artifactDir, "run-meta.json"), "utf-8"),
    );
    expect(meta.capability.unsupportedRunOptions).toEqual([
      {
        option: 'autonomyMode="supervised"',
        runOption: "autonomyMode.supervised",
        reason: "Readiness-only fake harness cannot route approvals.",
      },
    ]);
    expect(meta.capability.localReadiness.localAuth).toMatchObject({
      status: "expiring",
      expiresAt: "2026-06-22T00:30:00.000Z",
      renewalSummary: "run `fake login` before unattended runs",
    });

    const summary = readFileSync(
      join(artifacts[0]!.artifactDir, "trace-summary.md"),
      "utf-8",
    );
    expect(summary).toContain("- unsupportedRunOptions (1):");
    expect(summary).toContain(
      '- autonomyMode="supervised" [autonomyMode.supervised]: Readiness-only fake harness cannot route approvals.',
    );
    expect(summary).toContain("auth: expiring - fake login expires soon");

    const parity = JSON.parse(
      readFileSync(join(outRoot, "fix-add", "parity.json"), "utf-8"),
    );
    expect(parity.artifacts[0].capability.unsupportedRunOptions).toEqual([
      {
        option: 'autonomyMode="supervised"',
        runOption: "autonomyMode.supervised",
        reason: "Readiness-only fake harness cannot route approvals.",
      },
    ]);
    expect(
      parity.artifacts[0].capability.localReadiness.localAuth,
    ).toMatchObject({
      status: "expiring",
      expiresAt: "2026-06-22T00:30:00.000Z",
      renewalSummary: "run `fake login` before unattended runs",
    });
  });
});
