import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkProviderConnectivity, runDoctorChecks, runDoctorFixes } from "./index.js";

vi.mock("#core/workflow/validation.js", () => ({
  validateWorkflowDefinitions: vi.fn(() => [{ name: "builder" }]),
  WorkflowDefinitionError: class WorkflowDefinitionError extends Error {},
}));

vi.mock("#core/modules/module-metadata.js", () => ({
  loadModuleMetadata: vi.fn(async () => ({
    getModuleSummaries: () => [{ name: "test-module" }],
    getContributedWorkflows: () => [],
  })),
}));

vi.mock("#core/config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("#core/server/daemon-client.js", () => ({
  DaemonControlClient: {
    fromStateDir: vi.fn(() => null),
  },
}));

vi.mock("#core/model/model-client.js", () => ({
  createModelClient: vi.fn(() => ({
    client: {
      messages: {
        create: vi.fn(async () => ({ id: "msg_test", content: [], role: "assistant" })),
      },
    },
    model: "claude-haiku-4-5-20251001",
    providerName: "anthropic",
  })),
}));

vi.mock("#modules/model-clients/factory.js", () => ({
  resolveApiKey: vi.fn(() => "sk-ant-test-key"),
}));

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("kota doctor — offline path", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeTmpDir();
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("passes disk check when .kota/ exists and is writable", async () => {
    const results = await runDoctorChecks(projectDir);
    const disk = results.find((r) => r.label.startsWith("Disk: .kota/ directory"));
    expect(disk?.status).toBe("pass");
    const writable = results.find((r) => r.label.startsWith("Disk: .kota/ writable"));
    expect(writable?.status).toBe("pass");
  });

  it("fails disk check when .kota/ is missing", async () => {
    rmSync(join(projectDir, ".kota"), { recursive: true });
    const results = await runDoctorChecks(projectDir);
    const disk = results.find((r) => r.label.startsWith("Disk: .kota/ directory"));
    expect(disk?.status).toBe("fail");
  });

  it("warns about daemon not running", async () => {
    const results = await runDoctorChecks(projectDir);
    const daemon = results.find((r) => r.label === "Daemon");
    expect(daemon?.status).toBe("warn");
  });

  it("does not treat daemon-state.json as a live daemon lock", async () => {
    writeFileSync(
      join(projectDir, ".kota", "daemon-state.json"),
      JSON.stringify({
        pid: 99999999,
        startedAt: "2026-04-22T10:00:00.000Z",
        completedRuns: 3,
      }),
    );
    const results = await runDoctorChecks(projectDir);
    const daemon = results.find((r) => r.label === "Daemon");
    expect(daemon?.detail).toBe("No daemon-control.json found — daemon is not running");
  });

  it("warns about missing project config", async () => {
    const results = await runDoctorChecks(projectDir);
    const cfg = results.find((r) => r.label.startsWith("Config: project"));
    expect(cfg?.status).toBe("warn");
  });

  it("fails config check for invalid JSON", async () => {
    writeFileSync(join(projectDir, ".kota", "config.json"), "{ not valid json");
    const results = await runDoctorChecks(projectDir);
    const cfg = results.find((r) => r.label.startsWith("Config: project"));
    expect(cfg?.status).toBe("fail");
  });

  it("passes config check for valid config.json", async () => {
    writeFileSync(join(projectDir, ".kota", "config.json"), JSON.stringify({ model: "claude-opus-4-7" }));
    const results = await runDoctorChecks(projectDir);
    const cfg = results.find((r) => r.label.startsWith("Config: project"));
    expect(cfg?.status).toBe("pass");
  });

  it("passes workflow check with valid shipped workflow definitions", async () => {
    const results = await runDoctorChecks(projectDir);
    const wf = results.find((r) => r.label.startsWith("Workflows"));
    expect(wf?.status).toBe("pass");
  });

  it("returns results for all check categories", async () => {
    const results = await runDoctorChecks(projectDir);
    const labels = results.map((r) => r.label);
    expect(labels.some((l) => l.startsWith("Daemon"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Config:"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Modules"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Providers"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Workflows"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Disk:"))).toBe(true);
  });

  it("renders capability readiness rows when the daemon reports them", async () => {
    const { DaemonControlClient } = await import("#core/server/daemon-client.js");
    const fromStateDir = vi.mocked(DaemonControlClient.fromStateDir);
    fromStateDir.mockReturnValueOnce({
      getDaemonStatus: vi.fn(async () => ({ pid: 1234, startedAt: "2026-04-29T00:00:00.000Z" })),
      getHealth: vi.fn(async () => ({ status: "ok", components: { scheduler: "ok", modules: "ok" } })),
      getWorkflowDefinitions: vi.fn(async () => ({ definitions: [{ name: "builder" }] })),
      getCapabilities: vi.fn(async () => ({
        capabilities: [
          { id: "knowledge.search", moduleName: "knowledge", status: "ready", message: "ready text" },
          {
            id: "knowledge.semantic_search",
            moduleName: "knowledge",
            status: "unavailable",
            reason: "embedding_unsupported",
            message: "load knowledge-semantic",
          },
          {
            id: "broken",
            moduleName: "broken",
            status: "init_failed",
            reason: "probe_threw",
            message: "boom",
          },
        ],
        summary: { ready: 1, unavailable: 1, init_failed: 1 },
      })),
    } as unknown as ReturnType<typeof DaemonControlClient.fromStateDir>);

    const results = await runDoctorChecks(projectDir);
    const ready = results.find((r) => r.label === "Capability: knowledge.search");
    expect(ready?.status).toBe("pass");
    expect(ready?.detail).toBe("ready text");
    const unavailable = results.find((r) => r.label === "Capability: knowledge.semantic_search");
    expect(unavailable?.status).toBe("warn");
    expect(unavailable?.detail).toBe("load knowledge-semantic");
    const broken = results.find((r) => r.label === "Capability: broken");
    expect(broken?.status).toBe("fail");
  });

  it("warns about unexpected module state and stray runtime directories", async () => {
    mkdirSync(join(projectDir, ".kota", "extensions", "tool-cache"), { recursive: true });
    mkdirSync(join(projectDir, "runs"), { recursive: true });
    mkdirSync(join(projectDir, "kota"), { recursive: true });

    const results = await runDoctorChecks(projectDir);
    expect(results.find((r) => r.label === "Disk: stray .kota/extensions/")?.status).toBe("warn");
    expect(results.find((r) => r.label === "Disk: stray runs/")?.status).toBe("warn");
    expect(results.find((r) => r.label === "Disk: stray kota/")?.status).toBe("warn");
  });
});

describe("kota doctor --fix", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeTmpDir();
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("skips lock file when no daemon-control.json exists", () => {
    const repairs = runDoctorFixes(projectDir);
    const lock = repairs.find((r) => r.item.includes("daemon-control.json"));
    expect(lock?.action).toBe("skipped");
  });

  it("removes stale lock file when PID is not alive", () => {
    // Use a PID that is guaranteed to not exist: 99999999
    const lockFile = join(projectDir, ".kota", "daemon-control.json");
    writeFileSync(lockFile, JSON.stringify({ pid: 99999999, port: 9999, token: "x", startedAt: "2020-01-01T00:00:00Z" }));
    const repairs = runDoctorFixes(projectDir);
    const lock = repairs.find((r) => r.item.includes("daemon-control.json"));
    expect(lock?.action).toBe("repaired");
    expect(existsSync(lockFile)).toBe(false);
  });

  it("skips lock file removal when PID is alive (own process)", () => {
    const lockFile = join(projectDir, ".kota", "daemon-control.json");
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, port: 9999, token: "x", startedAt: "2020-01-01T00:00:00Z" }));
    const repairs = runDoctorFixes(projectDir);
    const lock = repairs.find((r) => r.item.includes("daemon-control.json"));
    expect(lock?.action).toBe("skipped");
    expect(existsSync(lockFile)).toBe(true);
  });

  it("reports manual action for unparseable lock file", () => {
    const lockFile = join(projectDir, ".kota", "daemon-control.json");
    writeFileSync(lockFile, "{ not valid json");
    const repairs = runDoctorFixes(projectDir);
    const lock = repairs.find((r) => r.item.includes("daemon-control.json"));
    expect(lock?.action).toBe("manual");
  });

  it("creates missing .kota/ and .kota/runs/ directories", () => {
    rmSync(join(projectDir, ".kota"), { recursive: true });
    const repairs = runDoctorFixes(projectDir);
    const kotaRepair = repairs.find((r) => r.item.includes("Directory:") && !r.item.includes("runs"));
    const runsRepair = repairs.find((r) => r.item.includes("runs"));
    const extensionsRepair = repairs.find((r) => r.item.includes(".kota/modules"));
    expect(kotaRepair?.action).toBe("repaired");
    expect(runsRepair?.action).toBe("repaired");
    expect(extensionsRepair?.action).toBe("repaired");
    expect(existsSync(join(projectDir, ".kota"))).toBe(true);
    expect(existsSync(join(projectDir, ".kota", "runs"))).toBe(true);
    expect(existsSync(join(projectDir, ".kota", "modules"))).toBe(true);
  });

  it("skips directory creation when directories already exist", () => {
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    mkdirSync(join(projectDir, ".kota", "modules"), { recursive: true });
    const repairs = runDoctorFixes(projectDir);
    const dirRepairs = repairs.filter((r) => r.item.startsWith("Directory:"));
    expect(dirRepairs.every((r) => r.action === "skipped")).toBe(true);
  });

  it("removes stray root runs/ and kota/ directories", () => {
    mkdirSync(join(projectDir, "runs", "some-run"), { recursive: true });
    mkdirSync(join(projectDir, "kota", "runs", "some-run"), { recursive: true });
    const repairs = runDoctorFixes(projectDir);
    const runsRepair = repairs.find((r) => r.item === "Stray directory: runs/");
    const kotaRepair = repairs.find((r) => r.item === "Stray directory: kota/");
    expect(runsRepair?.action).toBe("repaired");
    expect(kotaRepair?.action).toBe("repaired");
    expect(existsSync(join(projectDir, "runs"))).toBe(false);
    expect(existsSync(join(projectDir, "kota"))).toBe(false);
  });

  it("does not report stray directories when they do not exist", () => {
    const repairs = runDoctorFixes(projectDir);
    const strayRepairs = repairs.filter((r) => r.item.startsWith("Stray directory:"));
    expect(strayRepairs).toHaveLength(0);
  });

  it("preserves daemon-state.json because daemon-control.json owns liveness", () => {
    const stateFile = join(projectDir, ".kota", "daemon-state.json");
    writeFileSync(
      stateFile,
      JSON.stringify({
        pid: 99999999,
        startedAt: "2026-04-22T10:00:00.000Z",
        completedRuns: 3,
      }),
    );
    const repairs = runDoctorFixes(projectDir);
    expect(repairs.some((r) => r.item.includes("daemon-state.json"))).toBe(false);
    expect(existsSync(stateFile)).toBe(true);
  });

});

describe("kota doctor — provider connectivity check", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeTmpDir();
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("passes when the model client responds successfully", async () => {
    const { createModelClient } = await import("#core/model/model-client.js");
    vi.mocked(createModelClient).mockReturnValueOnce({
      client: {
        messages: {
          stream: vi.fn(),
          create: vi.fn(async () => ({ id: "msg_ok" }) as never),
        },
      },
      model: "claude-haiku-4-5-20251001",
      providerName: "anthropic",
    });

    const results = await checkProviderConnectivity(projectDir);
    expect(results[0]?.status).toBe("pass");
    expect(results[0]?.detail).toContain("Reachable");
  });

  it("fails with authentication error on 401/403 response", async () => {
    const { createModelClient } = await import("#core/model/model-client.js");
    const authErr = Object.assign(new Error("Authentication failed"), { status: 401 });
    // Mimic Anthropic SDK AuthenticationError check via message pattern
    vi.mocked(createModelClient).mockReturnValueOnce({
      client: {
        messages: {
          stream: vi.fn(),
          create: vi.fn(async () => { throw new Error("OpenAI API error 401: Unauthorized"); }),
        },
      },
      model: "claude-haiku-4-5-20251001",
      providerName: "anthropic",
    });
    void authErr;

    const results = await checkProviderConnectivity(projectDir);
    expect(results[0]?.status).toBe("fail");
    expect(results[0]?.detail).toContain("Authentication failed");
  });

  it("fails with unreachable message on network error", async () => {
    const { createModelClient } = await import("#core/model/model-client.js");
    vi.mocked(createModelClient).mockReturnValueOnce({
      client: {
        messages: {
          stream: vi.fn(),
          create: vi.fn(async () => { throw new Error("ECONNREFUSED connect ECONNREFUSED 127.0.0.1:11434"); }),
        },
      },
      model: "llama3",
      providerName: "ollama",
    });

    const results = await checkProviderConnectivity(projectDir);
    expect(results[0]?.status).toBe("fail");
    expect(results[0]?.detail).toContain("Unreachable");
  });

  it("warns when API key is not set", async () => {
    const { resolveApiKey } = await import("#modules/model-clients/factory.js");
    vi.mocked(resolveApiKey).mockReturnValueOnce("");

    const results = await checkProviderConnectivity(projectDir);
    expect(results[0]?.status).toBe("warn");
    expect(results[0]?.detail).toContain("not set");
  });

  it("skips probe and warns when --skip-connectivity is passed", async () => {
    const results = await runDoctorChecks(projectDir, { skipConnectivity: true });
    const conn = results.find((r) => r.label === "Provider connectivity");
    expect(conn?.status).toBe("warn");
    expect(conn?.detail).toContain("Skipped");
  });
});
