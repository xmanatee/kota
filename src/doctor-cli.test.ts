import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctorChecks } from "./doctor-cli.js";

vi.mock("./workflow/registry.js", () => ({
  getBuiltinWorkflowDefinitions: vi.fn(() => []),
}));

vi.mock("./workflow/validation.js", () => ({
  validateWorkflowDefinitions: vi.fn(() => [{ name: "builder" }]),
  WorkflowDefinitionError: class WorkflowDefinitionError extends Error {},
}));

vi.mock("./extension-discovery.js", () => ({
  discoverExtensions: vi.fn(async () => []),
}));

vi.mock("./extension-loader.js", () => ({
  ExtensionLoader: vi.fn().mockImplementation(() => ({
    setCwd: vi.fn(),
    loadAll: vi.fn(async () => {}),
    getExtensionSummaries: vi.fn(() => [{ name: "test-ext" }]),
  })),
}));

vi.mock("./extensions/index.js", () => ({
  builtinExtensions: [],
}));

vi.mock("./config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("./server/daemon-client.js", () => ({
  DaemonControlClient: {
    fromStateDir: vi.fn(() => null),
  },
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
    writeFileSync(join(projectDir, ".kota", "config.json"), JSON.stringify({ model: "claude-opus-4-6" }));
    const results = await runDoctorChecks(projectDir);
    const cfg = results.find((r) => r.label.startsWith("Config: project"));
    expect(cfg?.status).toBe("pass");
  });

  it("passes workflow check with valid built-in definitions", async () => {
    const results = await runDoctorChecks(projectDir);
    const wf = results.find((r) => r.label.startsWith("Workflows"));
    expect(wf?.status).toBe("pass");
  });

  it("returns results for all check categories", async () => {
    const results = await runDoctorChecks(projectDir);
    const labels = results.map((r) => r.label);
    expect(labels.some((l) => l.startsWith("Daemon"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Config:"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Extensions"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Providers"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Workflows"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Disk:"))).toBe(true);
  });
});
