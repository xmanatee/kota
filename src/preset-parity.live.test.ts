/** Live operator journey. Provider failures fail; unavailable auth is an explicit row. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { registerAgentHarness } from "#core/agent-harness/registry.js";
import { getPreset, type Preset } from "#core/model/preset.js";
import { collectPresetHarnessReadiness, isPresetHarnessReadinessReady, type PresetHarnessReadiness } from "#core/model/preset-readiness.js";
import { claudeAgentHarness } from "#modules/claude-agent-harness/adapter.js";
import { codexAgentHarness } from "#modules/codex-agent-harness/adapter.js";
import { geminiAgentHarness } from "#modules/gemini-agent-harness/adapter.js";
import { PresetParityFixture } from "./preset-parity-fixture.integration.js";

for (const harness of [claudeAgentHarness, codexAgentHarness, geminiAgentHarness]) registerAgentHarness(harness);
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const RUN_ID = `${new Date().toISOString().replace(/[:.]/g, "-")}-preset-parity`;
const RUN_ROOT = join(process.env.KOTA_RUN_ARTIFACT_DIR ?? process.env.KOTA_RUN_DIR ?? join(REPO_ROOT, ".kota", "runs", RUN_ID), "preset-parity");
function ensureRunDir(presetId: string): string {
  const dir = join(RUN_ROOT, presetId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
type PreflightArtifact = {
  presetId: string;
  authEnv: readonly string[];
  missing: readonly string[];
  readiness: PresetHarnessReadiness;
  decision: "scenario-runnable" | "preflight-failure";
  message: string;
  capturedAt: string;
};

function formatPreflightMessage(preset: Preset, missing: readonly string[]): string {
  const list = missing.join(" or ");
  return `preset "${preset.id}" requires ${list} — set the env var or run \`kota doctor --preset ${preset.id}\` to diagnose.`;
}

function recordPreflight(preset: Preset): PreflightArtifact {
  const readiness = collectPresetHarnessReadiness(preset);
  const missing = [...readiness.auth.missing,
    ...(preset.id === "codex" && !process.env.OPENAI_API_KEY ? ["OPENAI_API_KEY"] : []),
  ];
  const dir = ensureRunDir(preset.id);
  const decision: PreflightArtifact["decision"] =
    isPresetHarnessReadinessReady(readiness) && missing.length === 0
      ? "scenario-runnable"
      : "preflight-failure";
  let message: string;
  if (decision === "scenario-runnable") {
    message =
      preset.authEnv.length === 0
        ? `preset "${preset.id}" auth ok (harness-managed auth)`
        : `preset "${preset.id}" auth ok (one of ${preset.authEnv.join(", ")} is set)`;
  } else if (missing.length > 0) {
    message = formatPreflightMessage(preset, missing) +
      (preset.id === "codex" ? " Capture/answer require API authentication in addition to native Codex login." : "");
  } else if (!readiness.auth.ready) {
    message =
      `preset "${preset.id}" auth not ready (${readiness.auth.summary}) — ` +
      `run \`kota doctor --preset ${preset.id}\` to diagnose.`;
  } else if (readiness.adapter.localRuntime.status !== "ready") {
    message =
      `preset "${preset.id}" local runtime not ready (${readiness.adapter.localRuntime.summary}) — ` +
      `run \`kota doctor --preset ${preset.id}\` to diagnose.`;
  } else if (
    readiness.adapter.modelEffort !== undefined &&
    readiness.adapter.modelEffort.status !== "ready"
  ) {
    message =
      `preset "${preset.id}" model/effort not ready ` +
      `(${readiness.adapter.modelEffort.summary}) — ` +
      `run \`kota doctor --preset ${preset.id}\` to diagnose.`;
  } else {
    message = `preset "${preset.id}" has an unclassified readiness failure.`;
  }
  const artifact: PreflightArtifact = {
    presetId: preset.id,
    authEnv: preset.authEnv,
    missing,
    readiness,
    decision,
    message,
    capturedAt: new Date().toISOString(),
  };
  writeFileSync(
    join(dir, "preflight.json"),
    `${JSON.stringify(artifact, null, 2)}\n`,
  );
  return artifact;
}


// Primary presets are this gate's scope. OpenRouter and downstream providers
// have separate matrix evaluations, as do native Gemini/AGY rollout canaries.
describe("preset parity — composed daemon scenario", () => {
  for (const preset of ["claude", "codex", "gemini"].map(getPreset)) {
    it(`preset=${preset.id}: boot, response, file tool, capture/recall/answer, workflow, autonomy`, async (context) => {
      const preflight = recordPreflight(preset);
      if (preflight.decision === "preflight-failure") {
        const message = `preset ${preset.id} unexecuted: ${preflight.message}`;
        process.stdout.write(`${message}\n`);
        writeFileSync(join(ensureRunDir(preset.id), "transcript.txt"), `${message}\n`);
        // Only established missing auth may skip. Probe errors, unsupported
        // selections, and broken runtimes must fail visibly.
        const auth = preflight.readiness.auth;
        if ((preflight.missing.length > 0) ||
          (auth.mode === "harness-managed-login" && ["missing", "stale"].includes(auth.probe.status))) {
          context.skip(message);
        }
        throw new Error(message);
      }
      if (!existsSync(join(REPO_ROOT, "dist/cli.js"))) throw new Error("Run pnpm build before pnpm test:preset-parity");
      const fixture = new PresetParityFixture(preset, REPO_ROOT, ensureRunDir(preset.id));
      try { await fixture.boot(); await fixture.scenario(); }
      catch (error) {
        writeFileSync(join(ensureRunDir(preset.id), "failure.txt"), `${error instanceof Error ? error.stack : String(error)}\n`);
        throw error;
      }
      finally { await fixture.close(); }
    }, 1_200_000);
  }
});
