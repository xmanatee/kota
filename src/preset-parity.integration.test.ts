/** Detect fixture/CLI/module-discovery drift before spending provider calls. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { loadConfigWithDiagnostics } from "#core/config/config.js";
import { registerConfigSlice } from "#core/config/config-slice.js";
import { modelProviderSelectionFromConfig } from "#core/model/model-client.js";
import { getPreset } from "#core/model/preset.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { executeAgentStep } from "#core/workflow/steps/step-executor-agent.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "#core/workflow/validation.js";
import { agent as builderAgent } from "#modules/autonomy/workflows/builder/workflow.js";
import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
import { codexAgentHarness } from "#modules/codex-agent-harness/adapter.js";
import type { ParityCall } from "#modules/eval-harness/preset-parity-evidence.js";
import { createPresetParityModule } from "#modules/eval-harness/preset-parity-module.js";
import { observeParityHarness } from "#modules/eval-harness/preset-parity-observer.js";
import { geminiAgentHarness } from "#modules/gemini-agent-harness/adapter.js";
import { modelProviderConfigSlice } from "#modules/model-clients/config-slice.js";
import { createModelClientImpl } from "#modules/model-clients/factory.js";
import { PresetParityFixture, presetParityScopeConfig } from "./preset-parity-fixture.integration.js";

it("boots the built CLI with the parity observer and registered workflow probes, without inference", async () => {
  const dispose = registerAgentHarness(codexAgentHarness);
  const artifacts = mkdtempSync(join(tmpdir(), "kota-parity-boot-evidence-"));
  const fixture = new PresetParityFixture(getPreset("codex"), resolve(fileURLToPath(import.meta.url), "../.."), artifacts);
  try {
    await fixture.boot();
    const observed = JSON.parse(readFileSync(join(artifacts, "adapter-calls.json"), "utf8"));
    expect(observed.presetId).toBe("codex");
    expect(observed.calls).toEqual([]);
  } finally {
    await fixture.close();
    dispose();
    const logs = readFileSync(join(artifacts, "daemon.log"), "utf8");
    const cleanup = JSON.parse(readFileSync(join(artifacts, "cleanup.json"), "utf8"));
    try { expect(cleanup.controlFileRemoved, logs).toBe(true); }
    finally { rmSync(artifacts, { recursive: true, force: true }); }
  }
}, 60_000);

// This catches incompatible probe declarations before the network-dependent
// journey: production compilation joins the shipped builder and preset tiers.
it.each(["claude", "codex", "gemini"])("compiles the live probes against preset %s and the shipped builder", (id) => {
  const root = mkdtempSync(join(tmpdir(), "kota-parity-contract-"));
  const disposers = [claudeAgentHarness, codexAgentHarness, geminiAgentHarness].map(registerAgentHarness);
  try {
    writeFileSync(join(root, "parity-single-turn.md"), "Reply OK");
    writeFileSync(join(root, "parity-tool-turn.md"), "Read parity-input.txt using file_read");
    writeFileSync(join(root, "parity-workflow.md"), "Reply OK");
    writeFileSync(join(root, "parity-autonomy.md"), "Read the fixture");
    const preset = getPreset(id);
    const inputs = createPresetParityModule().workflows;
    if (!Array.isArray(inputs)) throw new Error("Expected parity workflow contributions");
    const definitions = validateWorkflowDefinitions(inputs.map((input) => registerWorkflowDefinition("parity.ts", input)), root, {
      preset, defaultAgentHarness: preset.harness,
      resolveAgentDef: (name) => name === builderAgent.name ? builderAgent : undefined,
    });
    for (const definition of definitions) {
      expect(definition.steps.find((step) => step.id === "agent")).toMatchObject({
        type: "agent", harness: preset.harness,
        model: definition.name === "preset-parity-autonomy" ? preset.tiers.capable : preset.tiers.balanced,
      });
    }
  } finally {
    for (const dispose of disposers.reverse()) dispose();
    rmSync(root, { recursive: true, force: true });
  }
});

// Regression for the critic's pre-network failure: exercise the exact scope
// setup through config loading and the real factory, with synthetic auth only.
it.each(["claude", "codex", "gemini"])("constructs capture/answer clients from preset %s scope configuration", (id) => {
  const root = mkdtempSync(join(tmpdir(), "kota-parity-provider-"));
  const disposeConfig = registerConfigSlice(modelProviderConfigSlice, "model-clients");
  try {
    mkdirSync(join(root, ".kota"));
    const preset = getPreset(id);
    const setup = presetParityScopeConfig(preset, { GOOGLE_API_KEY: "synthetic" });
    writeFileSync(join(root, ".kota/config.json"), JSON.stringify(setup));
    const globalConfigPath = join(root, "global.json");
    writeFileSync(globalConfigPath, JSON.stringify({ trustedScopes: [root] }));
    const { config } = loadConfigWithDiagnostics(root, undefined, { globalConfigPath });
    expect(() => createModelClientImpl({ model: preset.defaultModel, apiKey: "synthetic" })).toThrow("Model provider is not configured");
    const resolved = createModelClientImpl({
      model: preset.defaultModel, ...modelProviderSelectionFromConfig(config),
      // Synthetic credentials prevent any host secret lookup or network access.
      apiKey: "synthetic",
    });
    expect(resolved.model).toBe(preset.defaultModel);
    expect(resolved.providerName).toBe(id === "claude" ? "anthropic" : id === "codex" ? "openai" : "google");
    expect(typeof resolved.client.messages.create).toBe("function");
    if (id === "gemini") expect(config.modelProvider?.apiKey).toBe("$GOOGLE_API_KEY");
  } finally { disposeConfig(); rmSync(root, { recursive: true, force: true }); }
});

// The prior chat stimulus entered ModelClient and could never satisfy harness
// observations. Drive the compiled probes through the real agent-step executor;
// only the external harness invocation is controlled (no provider or HTTP).
it("executes single/tool probes across the harness boundary with turns and permission observations", async () => {
  const root = mkdtempSync(join(tmpdir(), "kota-parity-execution-"));
  const preset = getPreset("claude");
  const calls: ParityCall[] = [];
  let surface: "single-turn" | "tool-turn" = "single-turn";
  const dispose = registerAgentHarness(observeParityHarness({
    ...claudeAgentHarness,
    async run(options) {
      const text = surface === "single-turn" ? "OK" : "file nonce";
      if (surface === "tool-turn") {
        if (!options.canUseTool) throw new Error("Executor omitted permission callback");
        const decision = await options.canUseTool("Read", { file_path: "parity-input.txt" }, {
          signal: new AbortController().signal, toolUseId: "read-nonce",
        });
        expect(decision.behavior).toBe("allow");
      }
      return { text, streamedText: text, turns: 1, isError: false,
        usage: { tokens: { state: "unknown" }, cost: { state: "unknown" } } };
    },
  }, (model, harness, runId) => {
    const call: ParityCall = { id: calls.length, surface, presetId: preset.id,
      boundary: "harness", harness, runId, model: model ?? null,
      requestedModel: model ?? null, tools: [], status: "started" };
    calls.push(call);
    return call;
  }));
  try {
    for (const name of ["single-turn", "tool-turn", "workflow", "autonomy"]) {
      writeFileSync(join(root, `parity-${name}.md`), "Read parity-input.txt or reply OK.");
    }
    writeFileSync(join(root, "parity-input.txt"), "file nonce");
    const inputs = createPresetParityModule().workflows;
    if (!Array.isArray(inputs)) throw new Error("Expected workflow contributions");
    const definitions = validateWorkflowDefinitions(inputs.map((input) => registerWorkflowDefinition("parity.ts", input)), root, {
      preset, defaultAgentHarness: preset.harness,
      resolveAgentDef: (name) => name === builderAgent.name ? builderAgent : undefined,
    });
    const store = new WorkflowRunStore(root);
    for (const probe of ["single-turn", "tool-turn"] as const) {
      surface = probe;
      const definition = definitions.find((item) => item.name === `preset-parity-${probe}`);
      if (!definition) throw new Error("Missing probe");
      const step = definition.steps.find((item) => item.id === "agent");
      if (step?.type !== "agent") throw new Error("Probe must invoke a workflow agent");
      const trigger = { event: "manual", schemaRef: null, payload: {} };
      const run = store.createRun(definition, trigger);
      const result = await executeAgentStep(definition, step, run.metadata, trigger,
        new AbortController(), () => {}, () => {}, { scopeRoot: root });
      expect(result).toMatchObject({ harness: preset.harness, model: preset.tiers.balanced });
      expect(calls.at(-1)).toMatchObject({ surface: probe, boundary: "harness",
        runId: run.metadata.id, status: "success", turns: 1,
        text: probe === "single-turn" ? "OK" : "file nonce",
        tools: probe === "single-turn" ? [] : ["Read"] });
    }
  } finally { dispose(); rmSync(root, { recursive: true, force: true }); }
});
