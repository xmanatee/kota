import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentHarnessReadiness, AgentHarnessUnsupportedOption } from "#core/agent-harness/index.js";
import { runScenarioAcrossHarnesses } from "./runner.js";
import { cleanupRunnerTestState, makeHarness, setupRunnerTestState } from "./runner.test-support.js";
import { loadScenario } from "./scenario.js";

describe("harness-parity runner capability metadata", () => {
let scenariosRoot: string;
let outRoot: string;

beforeEach(() => {
  ({ scenariosRoot, outRoot } = setupRunnerTestState());
});

afterEach(() => {
  cleanupRunnerTestState({ scenariosRoot, outRoot });
});

  it("records capability snapshots for KOTA-controlled and native harnesses", async () => {
    const scenario = loadScenario(scenariosRoot, "fix-add");
    const unsupportedRunOptions: readonly AgentHarnessUnsupportedOption[] = [
      {
        runOption: "allowedTools",
        option: "allowedTools",
        reason: "Native fake harness owns its tool allowlist.",
      },
      {
        runOption: "canUseTool",
        option: "canUseTool",
        reason: "Native fake harness does not route tool calls through KOTA.",
      },
    ];
    const nativeReadiness: AgentHarnessReadiness = {
      adapterKind: "native-cli",
      localRuntime: {
        kind: "native-cli",
        status: "ready",
        required: true,
        command: "fake-agent --version",
        binaryName: "fake-agent",
        executablePath: "/usr/local/bin/fake-agent",
        version: "1.2.3",
        summary: "Fake native CLI available.",
      },
      localAuth: {
        kind: "harness-managed-login",
        status: "missing",
        required: true,
        command: "fake-agent login status",
        detail: "No fake credential file.",
        summary: "Fake native CLI login missing.",
      },
      optionalRuntimes: [],
      unsupportedOptions: unsupportedRunOptions,
    };
    const kotaControlled = makeHarness(
      "kota-controlled",
      (workingDir) => {
        writeFileSync(
          join(workingDir, "add.js"),
          "exports.add = (a, b) => a + b;\n",
        );
      },
      {},
      {
        askOwnerToolName: "ask_owner",
        emitsAgentMessageStream: true,
      },
    );
    const nativeControlled = makeHarness(
      "native-controlled",
      (workingDir) => {
        writeFileSync(
          join(workingDir, "add.js"),
          "exports.add = (a, b) => a + b;\n",
        );
      },
      {},
      {
        toolControl: "native",
        supportsMultiTurn: false,
        unsupportedRunOptions,
        readiness: () => nativeReadiness,
      },
    );

    const artifacts = await runScenarioAcrossHarnesses({
      scenario,
      harnesses: [kotaControlled, nativeControlled],
      callOptions: { model: "test-model" },
      outBaseDir: outRoot,
    });

    const kotaMeta = JSON.parse(
      readFileSync(join(artifacts[0]!.artifactDir, "run-meta.json"), "utf-8"),
    );
    expect(kotaMeta.capability).toMatchObject({
      harnessName: "kota-controlled",
      toolControl: "kota",
      supportsMultiTurn: true,
      askOwnerToolName: "ask_owner",
      emitsAgentMessageStream: true,
      supportedHookKinds: ["preRun", "postRun"],
      unsupportedRunOptions: [],
    });

    const nativeMeta = JSON.parse(
      readFileSync(join(artifacts[1]!.artifactDir, "run-meta.json"), "utf-8"),
    );
    expect(nativeMeta.capability).toMatchObject({
      harnessName: "native-controlled",
      toolControl: "native",
      supportsMultiTurn: false,
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      unsupportedRunOptions: [
        {
          option: "allowedTools",
          runOption: "allowedTools",
          reason: "Native fake harness owns its tool allowlist.",
        },
        {
          option: "canUseTool",
          runOption: "canUseTool",
          reason: "Native fake harness does not route tool calls through KOTA.",
        },
      ],
      localReadiness: {
        adapterKind: "native-cli",
        localRuntime: {
          kind: "native-cli",
          status: "ready",
          command: "fake-agent --version",
          binaryName: "fake-agent",
          executablePath: "/usr/local/bin/fake-agent",
          version: "1.2.3",
        },
        localAuth: {
          kind: "harness-managed-login",
          status: "missing",
          command: "fake-agent login status",
        },
      },
    });

    const nativeSummary = readFileSync(
      join(artifacts[1]!.artifactDir, "trace-summary.md"),
      "utf-8",
    );
    expect(nativeSummary).toContain("## Capability boundary");
    expect(nativeSummary).toContain("- toolControl: native");
    expect(nativeSummary).toContain("- ownerQuestions: unsupported");
    expect(nativeSummary).toContain("- unsupportedRunOptions (2):");
    expect(nativeSummary).toContain(
      "Native fake harness does not route tool calls through KOTA.",
    );
    expect(nativeSummary.indexOf("## Capability boundary")).toBeLessThan(
      nativeSummary.indexOf("## Streamed text (tail)"),
    );

    const parity = JSON.parse(
      readFileSync(join(outRoot, "fix-add", "parity.json"), "utf-8"),
    );
    expect(parity.artifacts[0].capability).toMatchObject({
      toolControl: "kota",
      supportsOwnerQuestions: true,
      askOwnerToolName: "ask_owner",
      emitsAgentMessageStream: true,
      unsupportedRunOptions: [],
    });
    expect(parity.artifacts[1].capability).toMatchObject({
      toolControl: "native",
      supportsOwnerQuestions: false,
      askOwnerToolName: null,
      emitsAgentMessageStream: false,
      unsupportedRunOptions: [
        {
          option: "allowedTools",
          runOption: "allowedTools",
          reason: "Native fake harness owns its tool allowlist.",
        },
        {
          option: "canUseTool",
          runOption: "canUseTool",
          reason: "Native fake harness does not route tool calls through KOTA.",
        },
      ],
      localReadiness: {
        adapterKind: "native-cli",
        localRuntime: {
          kind: "native-cli",
          status: "ready",
          required: true,
          summary: "Fake native CLI available.",
        },
        localAuth: {
          kind: "harness-managed-login",
          status: "missing",
          required: true,
          summary: "Fake native CLI login missing.",
        },
        optionalRuntimes: [],
      },
    });
  });
});
