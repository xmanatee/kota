import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAgentHarnessRegistryForTest, registerAgentHarness } from "#core/agent-harness/index.js";
import { loadConfig } from "#core/config/config.js";
import { detectStrandedDaemonProcess } from "#core/daemon/stranded-daemon.js";
import { discoverBundledModules } from "#core/modules/bundled-module-discovery.js";
import type { KotaModule } from "#core/modules/module-types.js";
import { type DaemonTransport, getDaemonTransport } from "#core/server/daemon-transport.js";
import { runDoctorReport } from "#modules/doctor/doctor-checks.js";

// Composition oracle: doctor must report real module/agent validation failures.
// Control filesystem discovery and host I/O; retain metadata loading and validation.
const host = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (original) => ({ ...await original<typeof import("node:os")>(), homedir: () => host.home }));
vi.mock("#core/config/config.js", async (original) => ({ ...await original<typeof import("#core/config/config.js")>(), loadConfig: vi.fn(() => ({})) }));
vi.mock("#core/modules/bundled-module-discovery.js", () => ({ discoverBundledModules: vi.fn() }));
vi.mock("#core/server/daemon-transport.js", () => ({ getDaemonTransport: vi.fn(() => null) }));
vi.mock("#core/daemon/stranded-daemon.js", () => ({ detectStrandedDaemonProcess: vi.fn(() => ({ kind: "none" })) }));
let root: string;
let mod: KotaModule;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kota-doctor-report-"));
  host.home = root;
  mkdirSync(join(root, ".kota"));
  writeFileSync(join(root, "prompt.md"), "Inspect the project.\n");
  vi.stubEnv("KOTA_PRESET", "");
  vi.mocked(loadConfig).mockReturnValue({ defaultAgentHarness: "doctor-fixture" });
  vi.mocked(getDaemonTransport).mockReturnValue(null);
  vi.mocked(detectStrandedDaemonProcess).mockReturnValue({ kind: "none" });
  clearAgentHarnessRegistryForTest();
  registerAgentHarness({
    name: "doctor-fixture", description: "validation fixture", supportsMultiTurn: true,
    supportedHookKinds: [], askOwnerToolName: null, emitsAgentMessageStream: false,
    toolControl: "kota", run: async () => { throw new Error("unexpected agent run"); },
  });
  mod = {
    name: "doctor-fixture",
    agents: [{ name: "reviewer", role: "Review", promptPath: "prompt.md", model: "fixture-model", effort: "low", writeScope: "deny-all" }],
    workflows: [{ name: "review", repository: "read", triggers: [{ event: "manual" }], steps: [{ id: "review", type: "agent", agentName: "reviewer", autonomyMode: "autonomous" }] }],
  };
  vi.mocked(discoverBundledModules).mockImplementation(async () => [mod]);
});
afterEach(() => { clearAgentHarnessRegistryForTest(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
const report = () => runDoctorReport(root, { skipConnectivity: true });

describe("doctor report composition", () => {
  it("reports contributed-agent validation and then its unresolved reference", async () => {
    const valid = await report();
    expect(valid.checks.find((r) => r.label.startsWith("Workflows:"))).toEqual({ label: "Workflows: discoverable definitions", status: "pass", detail: "1 valid" });
    expect(valid.checks).toContainEqual({ label: "Modules: loaded", status: "pass", detail: "1 module(s)" });
    mod = { ...mod, agents: [] };
    const invalid = await report();
    expect(invalid.checks.find((r) => r.label.startsWith("Workflows:"))).toMatchObject({ status: "fail", detail: expect.stringContaining("reviewer") });
    expect(invalid.checks.find((r) => r.label === "Provider connectivity")).toMatchObject({ status: "warn", detail: expect.stringContaining("Skipped") });
  });

  it("reports discovery failure instead of claiming valid modules or workflows", async () => {
    vi.mocked(discoverBundledModules).mockRejectedValue(new Error("fixture import rejected"));
    const result = await report();
    for (const label of ["Modules: loaded", "Workflows: discoverable definitions"]) {
      expect(result.checks.find((r) => r.label === label)).toMatchObject({ status: "fail", detail: expect.stringContaining("fixture import rejected") });
    }
  });

  it.each([
    [undefined, "warn"], ["{ invalid", "fail"], ["[]", "fail"], ['{"model":"example"}', "pass"],
  ] as const)("reports project configuration %s", async (content, status) => {
    if (content !== undefined) writeFileSync(join(root, ".kota/config.json"), content);
    expect((await report()).checks.find((r) => r.label.startsWith("Config: project"))?.status).toBe(status);
  });

  it("observes writable state, stale data and absent state without trusting historical PID", async () => {
    writeFileSync(join(root, ".kota/daemon-state.json"), '{"pid":99999999}');
    for (const path of [".kota/extensions", ".kota/data", "runs", "kota"]) mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, ".kota/data/stale.md"), "---\ntype: run-insight\n---\nReport\n");
    writeFileSync(join(root, ".kota/data/note.md"), "---\ntype: note\n---\nKeep\n");
    const checks = (await report()).checks;
    expect(checks.find((r) => r.label === "Daemon")).toMatchObject({ status: "warn", detail: expect.stringContaining("not running") });
    expect(checks.find((r) => r.label === "Disk: .kota/ writable")?.status).toBe("pass");
    for (const label of ["Disk: stray .kota/extensions/", "Disk: stray runs/", "Disk: stray kota/"]) expect(checks.find((r) => r.label === label)?.status).toBe("warn");
    expect(checks.find((r) => r.label === "Disk: stale run-insight data")?.detail).toContain("1 file");
    rmSync(join(root, ".kota"), { recursive: true });
    expect((await report()).checks.find((r) => r.label === "Disk: .kota/ directory")?.status).toBe("fail");
  });

  it("reports a stranded live daemon as failed", async () => {
    vi.mocked(detectStrandedDaemonProcess).mockReturnValue({ kind: "stranded", pid: 4242, command: "fixture daemon" });
    expect((await report()).checks.find((r) => r.label === "Daemon")).toMatchObject({ status: "fail", detail: expect.stringContaining("pid 4242") });
  });

  it("projects remote health and capability severity and missing workflow response", async () => {
    const responses: Record<string, unknown> = {
      "/status": { pid: 42, startedAt: "2026-01-01T00:00:00Z" },
      "/health": { components: { moduleHealthChecks: {
        healthy: { status: "healthy", message: "available" }, degraded: { status: "degraded", message: "slow" }, failed: { status: "unhealthy", message: "broken" },
      } } },
      "/capabilities": { capabilities: [
        { id: "ready", status: "ready", message: "ready text" },
        { id: "unavailable", status: "unavailable", message: "enable provider" },
        { id: "failed", status: "init_failed", message: "probe failed" },
      ] },
      "/workflow/definitions": { definitions: [{ name: "review" }] },
    };
    const link: DaemonTransport = {
      baseUrl: "http://fixture.invalid", authHeaders: () => ({}),
      request: async <T,>(_method: string, path: string) => (responses[path] ?? null) as T | null,
      requestStrict: async () => { throw new Error("unexpected strict request"); },
      fetchRaw: async () => { throw new Error("unexpected fetch"); }, events: async function* () {},
    };
    vi.mocked(getDaemonTransport).mockReturnValue(link);
    const checks = (await report()).checks;
    for (const [label, status, detail] of [
      ["Daemon", "pass", "pid 42"], ["Module health: healthy", "pass", "available"],
      ["Module health: degraded", "warn", "slow"], ["Module health: failed", "fail", "broken"],
      ["Capability: ready", "pass", "ready text"], ["Capability: unavailable", "warn", "enable provider"],
      ["Capability: failed", "fail", "probe failed"], ["Workflows", "pass", "1 definition"],
    ]) expect(checks.find((r) => r.label === label)).toMatchObject({ status, detail: expect.stringContaining(detail) });
    delete responses["/workflow/definitions"];
    expect((await report()).checks.find((r) => r.label === "Workflows")?.status).toBe("warn");
  });
});
