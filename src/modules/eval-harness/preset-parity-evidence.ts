import { z } from "zod";
import type { Preset } from "#core/model/preset.js";

export const paritySurfaceSchema = z.enum([
  "boot", "single-turn", "tool-turn", "capture", "recall", "answer", "workflow", "autonomy",
]);
export type ParitySurface = z.infer<typeof paritySurfaceSchema>;

// These are observations at the adapter entry, not model names parsed from UI text.
export const parityCallSchema = z.object({
  id: z.number().int().nonnegative(),
  surface: paritySurfaceSchema,
  presetId: z.string(),
  boundary: z.enum(["harness", "model-client"]),
  harness: z.string().optional(),
  model: z.string().nullable(),
  requestedModel: z.string().nullable(),
  runId: z.string().optional(),
  tools: z.array(z.string()),
  status: z.enum(["started", "success", "error"]),
  turns: z.number().optional(),
  text: z.string().optional(),
  error: z.string().optional(),
});
export type ParityCall = z.infer<typeof parityCallSchema>;
export const parityEvidenceSchema = z.object({
  presetId: z.string(),
  calls: z.array(parityCallSchema),
  starts: z.array(z.object({
    runId: z.string(),
    workflow: z.string(),
    presetId: z.string(),
    harness: z.string(),
  })),
});
export type ParityEvidence = z.infer<typeof parityEvidenceSchema>;

/** Sweep every observed call, including failures and incidental model consumers. */
export function assertPresetParityModels(preset: Preset, evidence: ParityEvidence): void {
  if (evidence.presetId !== preset.id) throw new Error(`boot preset mismatch: ${evidence.presetId} != ${preset.id}`);
  if (evidence.calls.length === 0) throw new Error("No adapter calls observed");
  const catalog = new Set([preset.defaultModel, ...Object.values(preset.tiers)]);
  for (const start of evidence.starts) {
    if (start.presetId !== preset.id || start.harness !== preset.harness) {
      throw new Error(`run ${start.runId}: sticky preset/harness mismatch`);
    }
  }
  for (const call of evidence.calls) {
    const label = `${call.surface} call ${call.id}`;
    if (call.presetId !== preset.id) throw new Error(`${label}: preset mismatch`);
    if (call.requestedModel === null || call.model === null || !catalog.has(call.requestedModel) || !catalog.has(call.model)) {
      throw new Error(`${label}: model outside preset ${preset.id}: ${call.requestedModel} -> ${call.model}`);
    }
    // No per-call overrides are set by this scenario. Catalog membership alone
    // would miss a balanced call accidentally routed to the capable tier.
    const expected = (call.surface === "workflow" || call.surface === "single-turn" || call.surface === "tool-turn") ? preset.tiers.balanced
      : call.surface === "autonomy" ? preset.tiers.capable : preset.defaultModel;
    if (call.model !== expected || call.requestedModel !== expected) {
      throw new Error(`${label}: expected ${expected}, observed ${call.requestedModel} -> ${call.model}`);
    }
    if (call.boundary === "harness" && call.harness !== preset.harness) {
      throw new Error(`${label}: harness mismatch: ${call.harness}`);
    }
  }
}
