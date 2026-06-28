import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentHarness,
  AgentHarnessResult,
  AgentHarnessRunOptions,
} from "#core/agent-harness/index.js";
import { resetHarnessHooks } from "#core/agent-harness/index.js";

export const SHIPPED_SCENARIOS_ROOT = join(import.meta.dirname, "scenarios");

export function writeMinimalScenario(scenariosRoot: string, id = "fix-add"): void {
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

export function writeStagedScenario(scenariosRoot: string, id = "staged-upgrade"): void {
  const dir = join(scenariosRoot, id);
  mkdirSync(join(dir, "initial"), { recursive: true });
  writeFileSync(
    join(dir, "scenario.json"),
    JSON.stringify({
      id,
      description: "staged upgrade",
      stages: [
        {
          id: "upgrade-v2",
          prompt: "stage 1 release notes: write v2",
          verification: {
            command: "node test-v2.js",
            timeoutMs: 10_000,
          },
        },
        {
          id: "upgrade-v3",
          prompt: "stage 2 release notes: preserve v2 and write v3",
          verification: {
            command: "node test-v3.js",
            timeoutMs: 10_000,
          },
        },
      ],
    }),
  );
  writeFileSync(
    join(dir, "initial", "state.js"),
    'exports.state = () => "base";\n',
  );
  writeFileSync(
    join(dir, "initial", "test-v2.js"),
    "const assert = require('node:assert/strict');\n" +
      "assert.equal(require('./state.js').state(), 'v2');\n" +
      "console.log('ok');\n",
  );
  writeFileSync(
    join(dir, "initial", "test-v3.js"),
    "const assert = require('node:assert/strict');\n" +
      "assert.equal(require('./state.js').state(), 'v2+v3');\n" +
      "console.log('ok');\n",
  );
}

export function writeContextRetrievalScenario(
  scenariosRoot: string,
  id = "context-fix-add",
): void {
  const dir = join(scenariosRoot, id);
  mkdirSync(join(dir, "initial"), { recursive: true });
  writeFileSync(
    join(dir, "scenario.json"),
    JSON.stringify({
      id,
      description: "fix add with declared context retrieval",
      prompt: "fix add",
      verification: {
        command: "node -e \"require('./add.js').add(2,3)===5 || process.exit(1)\"",
        timeoutMs: 10_000,
      },
      contextRetrieval: {
        targets: [{ id: "adder", kind: "path", path: "add.js" }],
      },
    }),
  );
  writeFileSync(
    join(dir, "initial", "add.js"),
    "exports.add = (a, b) => a - b;\n",
  );
  writeFileSync(join(dir, "initial", "package.json"), "{}\n");
}

export function writeStagedContextRetrievalScenario(
  scenariosRoot: string,
  id = "staged-context-upgrade",
): void {
  const dir = join(scenariosRoot, id);
  mkdirSync(join(dir, "initial"), { recursive: true });
  writeFileSync(
    join(dir, "scenario.json"),
    JSON.stringify({
      id,
      description: "staged upgrade with declared context retrieval",
      stages: [
        {
          id: "upgrade-v2",
          prompt: "stage 1 release notes: write v2",
          verification: {
            command: "node test-v2.js",
            timeoutMs: 10_000,
          },
          contextRetrieval: {
            targets: [{ id: "state-file", kind: "path", path: "state.js" }],
          },
        },
        {
          id: "upgrade-v3",
          prompt: "stage 2 release notes: preserve v2 and write v3",
          verification: {
            command: "node test-v3.js",
            timeoutMs: 10_000,
          },
          contextRetrieval: {
            targets: [{ id: "state-file", kind: "path", path: "state.js" }],
          },
        },
      ],
    }),
  );
  writeFileSync(
    join(dir, "initial", "state.js"),
    'exports.state = () => "base";\n',
  );
  writeFileSync(
    join(dir, "initial", "test-v2.js"),
    "const assert = require('node:assert/strict');\n" +
      "assert.equal(require('./state.js').state(), 'v2');\n" +
      "console.log('ok');\n",
  );
  writeFileSync(
    join(dir, "initial", "test-v3.js"),
    "const assert = require('node:assert/strict');\n" +
      "assert.equal(require('./state.js').state(), 'v2+v3');\n" +
      "console.log('ok');\n",
  );
}

export function writePreviewArtifactScenario(
  scenariosRoot: string,
  id: string,
  previewArtifacts: readonly string[],
  verificationScript: string,
): void {
  const dir = join(scenariosRoot, id);
  mkdirSync(join(dir, "initial"), { recursive: true });
  writeFileSync(
    join(dir, "scenario.json"),
    JSON.stringify({
      id,
      description: "preview artifact scenario",
      prompt: "run the preview verifier",
      verification: {
        command: "node verify-preview.js",
        timeoutMs: 10_000,
      },
      previewArtifacts,
    }),
  );
  writeFileSync(join(dir, "initial", "verify-preview.js"), verificationScript);
}

export function makeHarness(
  name: string,
  behavior: (
    workingDir: string,
    options: AgentHarnessRunOptions,
  ) => Promise<void> | void,
  overrides: Partial<AgentHarnessResult> = {},
  harnessOverrides: Partial<
    Pick<
      AgentHarness,
      | "askOwnerToolName"
      | "emitsAgentMessageStream"
      | "readiness"
      | "supportedHookKinds"
      | "supportsMultiTurn"
      | "toolControl"
      | "unsupportedRunOptions"
    >
  > = {},
): AgentHarness {
  return {
    name,
    description: `test harness ${name}`,
    supportsMultiTurn: harnessOverrides.supportsMultiTurn ?? true,
    supportedHookKinds:
      harnessOverrides.supportedHookKinds ?? (["preRun", "postRun"] as const),
    askOwnerToolName: harnessOverrides.askOwnerToolName ?? null,
    emitsAgentMessageStream:
      harnessOverrides.emitsAgentMessageStream ?? false,
    toolControl: harnessOverrides.toolControl ?? "kota",
    ...(harnessOverrides.readiness !== undefined
      ? { readiness: harnessOverrides.readiness }
      : {}),
    ...(harnessOverrides.unsupportedRunOptions !== undefined
      ? { unsupportedRunOptions: harnessOverrides.unsupportedRunOptions }
      : {}),
    async run(options, writer) {
      const cwd = options.cwd ?? process.cwd();
      await behavior(cwd, options);
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

export type RunnerTestState = {
  scenariosRoot: string;
  outRoot: string;
};

export function setupRunnerTestState(): RunnerTestState {
  resetHarnessHooks();
  const scenariosRoot = mkdtempSync(join(tmpdir(), "kota-parity-scenarios-"));
  const outRoot = mkdtempSync(join(tmpdir(), "kota-parity-out-"));
  writeMinimalScenario(scenariosRoot);
  return { scenariosRoot, outRoot };
}

export function cleanupRunnerTestState(state: RunnerTestState): void {
  resetHarnessHooks();
  rmSync(state.scenariosRoot, { recursive: true, force: true });
  rmSync(state.outRoot, { recursive: true, force: true });
}
