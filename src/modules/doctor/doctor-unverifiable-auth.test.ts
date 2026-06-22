import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness,
  clearAgentHarnessRegistryForTest,
  registerAgentHarness,
} from "#core/agent-harness/index.js";
import { loadConfig } from "#core/config/config.js";
import type { StrandedDaemonInspection } from "#core/daemon/stranded-daemon.js";
import { runDoctorChecks } from "./index.js";

const strandedDaemonMocks = vi.hoisted(() => ({
  detectStrandedDaemonProcess: vi.fn<() => StrandedDaemonInspection>(() => ({
    kind: "none",
  })),
}));

vi.mock("#core/config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("#core/server/daemon-transport.js", () => ({
  getDaemonTransport: vi.fn(() => null),
}));

vi.mock("#core/daemon/stranded-daemon.js", () => ({
  detectStrandedDaemonProcess: strandedDaemonMocks.detectStrandedDaemonProcess,
}));

vi.mock("#core/modules/module-metadata.js", () => ({
  loadModuleMetadata: vi.fn(async () => ({
    getModuleSummaries: () => [{ name: "test-module" }],
    getContributedWorkflows: () => [],
    getAgentDef: () => undefined,
  })),
}));

vi.mock("#core/workflow/validation.js", () => ({
  validateWorkflowDefinitions: vi.fn(() => [{ name: "builder" }]),
  WorkflowDefinitionError: class WorkflowDefinitionError extends Error {},
}));

function makeTmpDir(): string {
  const dir = join(
    tmpdir(),
    `kota-doctor-unverifiable-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(dir, ".kota"), { recursive: true });
  return dir;
}

function registerAntigravityHarnessWithUnverifiableAuth(): void {
  const harness: AgentHarness = {
    name: "antigravity-cli",
    description: "antigravity unverifiable auth test harness",
    supportsMultiTurn: true,
    supportedHookKinds: [],
    askOwnerToolName: null,
    emitsAgentMessageStream: false,
    toolControl: "native",
    readiness: () => ({
      adapterKind: "native-cli",
      localRuntime: {
        kind: "node-package",
        status: "ready",
        required: true,
        packageName: "antigravity-cli-runtime",
        version: "1.0.0",
        summary: "antigravity-cli-runtime@1.0.0",
      },
      localAuth: {
        kind: "harness-managed-login",
        status: "unverifiable",
        required: true,
        command: "agy",
        detail: "no non-interactive auth-status command",
        summary:
          "Antigravity CLI auth cannot be verified non-interactively",
      },
      optionalRuntimes: [],
      unsupportedOptions: [
        {
          runOption: "canUseTool",
          option: "canUseTool",
          reason: "AGY owns tool policy.",
        },
      ],
    }),
    run: async () => ({
      text: "",
      streamedText: "",
      turns: 0,
      isError: false,
    }),
  };
  registerAgentHarness(harness);
}

describe("kota doctor unverifiable harness auth", () => {
  let projectDir: string;
  let originalGeminiApiKey: string | undefined;

  beforeEach(() => {
    originalGeminiApiKey = process.env.GEMINI_API_KEY;
    vi.mocked(loadConfig).mockReturnValue({});
    strandedDaemonMocks.detectStrandedDaemonProcess.mockReturnValue({
      kind: "none",
    });
    clearAgentHarnessRegistryForTest();
    registerAntigravityHarnessWithUnverifiableAuth();
    projectDir = makeTmpDir();
  });

  afterEach(() => {
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
    clearAgentHarnessRegistryForTest();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("warns without claiming Antigravity CLI auth is missing or ready", async () => {
    process.env.GEMINI_API_KEY = "g-test";

    const results = await runDoctorChecks(projectDir, {
      preset: "antigravity-cli",
      skipConnectivity: true,
    });

    const presetRow = results.find(
      (row) => row.label === "Preset: antigravity-cli",
    );
    const authRow = results.find(
      (row) => row.label === "Preset auth: antigravity-cli",
    );
    const unsupportedRow = results.find(
      (row) => row.label === "Preset unsupported options: antigravity-cli",
    );

    expect(presetRow?.status).toBe("warn");
    expect(presetRow?.detail).toContain("harness-managed auth unverifiable");
    expect(presetRow?.detail).toContain(
      "Antigravity CLI auth cannot be verified non-interactively",
    );
    expect(authRow?.status).toBe("warn");
    expect(unsupportedRow?.detail).toContain("canUseTool");
  });
});
