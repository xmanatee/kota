import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentHarness, type AgentHarnessAuthProbe, type AgentHarnessReadiness,
  clearAgentHarnessRegistryForTest, registerAgentHarness,
} from "#core/agent-harness/index.js";
import { loadConfig } from "#core/config/config.js";
import { getPreset, resolvePreset } from "#core/model/preset.js";
import { checkPresetHarnessReadiness, extractPresetReadiness } from "./doctor-preset-readiness.js";

vi.mock("#core/config/config.js", () => ({ loadConfig: vi.fn(() => ({})) }));
const preset = getPreset("codex");
function auth(status: "ready" | "missing" | "unverifiable" | "expiring"): AgentHarnessAuthProbe {
  const base = { kind: "harness-managed-login", required: true, command: "fixture login", detail: "operator@example.com", summary: `fixture login ${status}` } as const;
  return status === "expiring"
    ? { ...base, status, expiresAt: "2026-06-22T00:30:00Z", renewalSummary: "renew fixture login" }
    : { ...base, status };
}
function register(readiness: AgentHarness["readiness"], name = preset.harness) {
  registerAgentHarness({
    name, description: "controlled runtime probe", supportsMultiTurn: true,
    supportedHookKinds: [], askOwnerToolName: null, emitsAgentMessageStream: false,
    toolControl: "native", readiness,
    run: async () => { throw new Error("doctor must not run an agent"); },
  });
}
function ready(probe = auth("ready")): AgentHarnessReadiness {
  return {
    adapterKind: "native-cli", localAuth: probe,
    localRuntime: { kind: "node-package", status: "ready", required: true, packageName: "fixture", version: "1", summary: "fixture@1" },
    optionalRuntimes: [], unsupportedOptions: [{ option: "canUseTool", reason: "owned by native runtime" }],
  };
}
beforeEach(() => {
  clearAgentHarnessRegistryForTest();
  vi.mocked(loadConfig).mockReturnValue({});
  vi.stubEnv("KOTA_PRESET", "");
});
afterEach(() => { clearAgentHarnessRegistryForTest(); vi.unstubAllEnvs(); });

describe("doctor readiness projection", () => {
  it.each([
    ["ready", "pass"], ["missing", "fail"], ["unverifiable", "warn"], ["expiring", "warn"],
  ] as const)("renders %s auth as %s and redacts both metadata projections", (state, status) => {
    register(() => ready(auth(state)));
    vi.stubEnv("OPENAI_API_KEY", "irrelevant-provider-key");
    const rows = checkPresetHarnessReadiness("/project", preset.id);
    for (const label of [`Preset: ${preset.id}`, `Preset auth: ${preset.id}`]) {
      expect(rows.find((r) => r.label === label)).toMatchObject({ status, detail: expect.stringContaining(`fixture login ${state}`) });
    }
    const readiness = extractPresetReadiness(rows);
    expect(readiness?.adapter.localAuth?.detail).toBe("[redacted-email]");
    expect(JSON.stringify({ rows, readiness })).not.toMatch(/operator@example.com|irrelevant-provider-key/);
    if (state === "expiring") expect(rows[0]?.detail).toContain("renew fixture login");
    expect(rows.find((r) => r.label.startsWith("Preset intentional limits:"))).toMatchObject({ status: "info", detail: expect.stringContaining("canUseTool") });
  });

  it("fails the configured model/effort while retaining supported capabilities", () => {
    vi.mocked(loadConfig).mockReturnValue({ modelTiers: { capable: "operator-model" } });
    register((selection) => {
      if (!selection) throw new Error("missing selection");
      return { ...ready(), modelEffort: {
        kind: "model-effort", required: true, status: "unavailable", ...selection,
        adapterModel: `${selection.model}@${selection.effort}`, command: "fixture models",
        summary: `unavailable ${selection.model}@${selection.effort}`, detail: "not in catalog",
      } };
    });
    const rows = checkPresetHarnessReadiness("/project", preset.id);
    expect(rows[0]).toMatchObject({ status: "fail", detail: expect.stringContaining("model/effort") });
    expect(rows.find((r) => r.label.startsWith("Preset model/effort:"))).toMatchObject({ status: "fail", detail: expect.stringContaining(`operator-model@${preset.defaultEffort}`) });
    expect(rows.find((r) => r.label.startsWith("Preset supported capabilities:"))).toMatchObject({ status: "pass", detail: "toolControl=native; multiTurn" });
  });

  it("does not let an auth warning hide a required runtime failure", () => {
    register(() => ({ ...ready(auth("unverifiable")), localRuntime: {
      kind: "node-package", status: "missing", required: true, packageName: "fixture", summary: "runtime missing",
    } }));
    const rows = checkPresetHarnessReadiness("/project", preset.id);
    expect(rows[0]?.status).toBe("fail");
    expect(rows.find((r) => r.label.startsWith("Preset runtime:"))?.status).toBe("fail");
    expect(rows.find((r) => r.label.startsWith("Preset auth:"))?.status).toBe("warn");
  });

  it("reports environment auth failure and an alternate credential's recovery", () => {
    const envPreset = getPreset("gemini");
    register(() => ready(), envPreset.harness);
    for (const name of envPreset.authEnv) vi.stubEnv(name, "");
    expect(checkPresetHarnessReadiness("/project", envPreset.id)[0]?.status).toBe("fail");
    vi.stubEnv(envPreset.authEnv.at(-1)!, "synthetic-env-secret");
    const rows = checkPresetHarnessReadiness("/project", envPreset.id);
    expect(rows[0]?.status).toBe("pass");
    expect(JSON.stringify(rows)).not.toContain("synthetic-env-secret");
  });

  it("projects preset selection precedence without freezing shipped defaults", () => {
    const config = getPreset("gemini"), env = getPreset("claude");
    vi.mocked(loadConfig).mockReturnValue({ defaultPreset: config.id });
    vi.stubEnv("KOTA_PRESET", env.id);
    expect(checkPresetHarnessReadiness("/project", preset.id)[0]?.detail).toContain("source: flag");
    expect(checkPresetHarnessReadiness("/project", undefined)[0]?.label).toBe(`Preset: ${env.id}`);
    vi.stubEnv("KOTA_PRESET", "");
    expect(checkPresetHarnessReadiness("/project", undefined)[0]?.label).toBe(`Preset: ${config.id}`);
    vi.mocked(loadConfig).mockReturnValue({});
    const row = checkPresetHarnessReadiness("/project", undefined)[0];
    expect(row?.label).toBe(`Preset: ${resolvePreset({}).preset.id}`);
    expect(row?.detail).toContain("source: shipped default");
    expect(checkPresetHarnessReadiness("/project", "no-such-preset")).toEqual([
      { label: "Preset", status: "fail", detail: expect.stringContaining("Unknown preset") },
    ]);
  });
});
