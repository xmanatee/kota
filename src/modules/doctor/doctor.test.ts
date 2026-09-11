import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "#core/config/config.js";
import { createModelClient, type ModelClient } from "#core/model/model-client.js";
import { runDoctorFixes } from "./doctor-fixes.js";
import { checkProviderConnectivity } from "./doctor-provider-checks.js";

vi.mock("#core/config/config.js", () => ({ loadConfig: vi.fn(() => ({})) }));
vi.mock("#core/model/model-client.js", () => ({ createModelClient: vi.fn() }));
// Credentials are an external port. Keep provider selection and display policy real.
vi.mock("#core/config/secrets.js", () => ({
  getScopeSecretStore: () => ({ get: () => null }),
}));
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kota-doctor-"));
  mkdirSync(join(root, ".kota"));
  vi.mocked(loadConfig).mockReturnValue({
    model: "anthropic/probe", modelProvider: { apiKey: "synthetic-provider-secret" },
  });
  vi.mocked(createModelClient).mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): string {
  const target = join(root, path);
  writeFileSync(target, content);
  return target;
}

describe("doctor repairs", () => {
  it.each([
    ["absent", undefined, "skipped", false],
    ["dead", JSON.stringify({ pid: 99999999 }), "repaired", false],
    ["live", JSON.stringify({ pid: process.pid }), "skipped", true],
    ["malformed", "{ invalid", "manual", true],
  ] as const)("preserves or removes the %s control file according to liveness", (_, content, action, remains) => {
    const path = join(root, ".kota/daemon-control.json");
    if (content !== undefined) writeFileSync(path, content);
    const repairs = runDoctorFixes(root);
    expect(repairs.find((r) => r.item.includes("daemon-control.json"))?.action).toBe(action);
    expect(existsSync(path)).toBe(remains);
    if (remains) expect(readFileSync(path, "utf8")).toBe(content);
  });

  it("creates canonical state directories and repeated repair is inert", () => {
    rmSync(join(root, ".kota"), { recursive: true });
    const repairs = runDoctorFixes(root);
    for (const path of [".kota", ".kota/runs", ".kota/modules"]) {
      expect(existsSync(join(root, path))).toBe(true);
      expect(repairs).toContainEqual(expect.objectContaining({ item: `Directory: ${join(root, path)}`, action: "repaired" }));
    }
    expect(runDoctorFixes(root).every((r) => r.action === "skipped")).toBe(true);
  });

  it("preserves repository paths, historical knowledge and daemon state bytes", () => {
    for (const path of ["runs/old", "kota/runs/old", ".kota/data"]) mkdirSync(join(root, path), { recursive: true });
    const stale = write(".kota/data/stale.md", "---\ntype: run-insight\n---\nOld report\n");
    const note = write(".kota/data/note.md", "---\ntype: note\n---\nKeep this\n");
    const state = write(".kota/daemon-state.json", '{"pid":99999999}');
    const repairs = runDoctorFixes(root);
    expect(repairs.every((repair) => repair.action === "skipped" || repair.item.startsWith("Directory:"))).toBe(true);
    expect(readFileSync(stale, "utf8")).toBe("---\ntype: run-insight\n---\nOld report\n");
    for (const path of [join(root, "runs/old"), join(root, "kota/runs/old")]) expect(existsSync(path)).toBe(true);
    expect(readFileSync(note, "utf8")).toBe("---\ntype: note\n---\nKeep this\n");
    expect(readFileSync(state, "utf8")).toBe('{"pid":99999999}');
    expect(runDoctorFixes(root).every((r) => r.action === "skipped")).toBe(true);
  });
});

describe("doctor provider connectivity", () => {
  it.each([
    [undefined, "pass", "Reachable"],
    ["OpenAI API error 401: Unauthorized", "fail", "Authentication failed"],
    ["OpenAI API error 403: Forbidden", "fail", "Authentication failed"],
    ["ECONNREFUSED", "fail", "Unreachable"],
  ] as const)("reports probe result %s without exposing credentials", async (error, status, detail) => {
    const create = vi.fn<ModelClient["messages"]["create"]>(async () => {
      if (error) throw new Error(error);
      return { id: "probe", type: "message", role: "assistant", model: "probe", content: [], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } };
    });
    vi.mocked(createModelClient).mockReturnValue({
      model: "probe", providerName: "anthropic", client: { messages: { create, stream: () => { throw new Error("unexpected streaming"); } } },
    });
    const results = await checkProviderConnectivity(root);
    expect(results[0]).toMatchObject({ status, detail: expect.stringContaining(detail) });
    const encoded = JSON.stringify(results);
    expect(encoded).not.toContain("synthetic-provider-secret");
    if (error !== "ECONNREFUSED") expect(encoded).toContain("config.modelProvider.apiKey=(set)");
    expect(create).toHaveBeenCalledWith({ model: "probe", max_tokens: 1, messages: [{ role: "user", content: "hi" }] });
  });

  it.each([
    [{ model: "unqualified" }, "No model provider configured"],
    [{ model: "anthropic/probe" }, "API key not set"],
  ])("does not send a probe without a resolved provider and credential: %j", async (config, detail) => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.mocked(loadConfig).mockReturnValue(config);
    expect((await checkProviderConnectivity(root))[0]).toMatchObject({ status: "warn", detail: expect.stringContaining(detail) });
    expect(createModelClient).not.toHaveBeenCalled();
  });

  it("probes a local provider without requiring a credential", async () => {
    vi.mocked(loadConfig).mockReturnValue({ model: "ollama/local" });
    vi.mocked(createModelClient).mockImplementation(() => { throw new Error("ECONNREFUSED local endpoint"); });
    expect((await checkProviderConnectivity(root))[0]).toMatchObject({ status: "fail", detail: expect.stringContaining("Unreachable") });
    expect(createModelClient).toHaveBeenCalledWith(expect.objectContaining({ provider: "ollama", apiKey: "" }));
  });
});
