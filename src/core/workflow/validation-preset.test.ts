import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listShippedPresets } from "#core/model/preset.js";
import { registerWorkflowDefinition, validateWorkflowDefinitions } from "#core/workflow/validation.js";

describe("preset-parity model-id sweep — workflow agent step `tier` validates through the active preset", () => {
  /**
   * The validator's tier→model resolution is the gate the workflow loader runs
   * at definition load time; this asserts the resolved model id ends up in
   * the active preset's tier catalog regardless of which preset is active.
   * No harness has to be registered: the validator's `validateModelId` gate
   * is opt-in per harness and the absence path is the documented behavior
   * for codex/gemini.
   */
  let workflowRoot: string;
  let promptName: string;

  beforeEach(() => {
    workflowRoot = join(
      tmpdir(),
      `preset-parity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workflowRoot, { recursive: true });
    promptName = "probe.md";
    writeFileSync(join(workflowRoot, promptName), "noop\n");
  });

  afterEach(() => {
    rmSync(workflowRoot, { recursive: true, force: true });
  });

  for (const preset of listShippedPresets()) {
    it(`preset=${preset.id}: tier="balanced" resolves to ${preset.tiers.balanced}`, () => {
      const [validated] = validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("preset-parity-balanced.ts", {
            repository: "read",
            name: "preset-parity-balanced",
            moduleRoot: workflowRoot,
            triggers: [{ event: "preset-parity.probe" }],
            defaultAutonomyMode: "autonomous",
            steps: [
              {
                type: "agent",
                id: "probe-balanced-tier",
                harness: preset.harness,
                tier: "balanced",
                effort: preset.defaultEffort,
                autonomyMode: "autonomous",
                promptPath: promptName,
              },
            ],
          }),
        ],
        workflowRoot,
        { preset },
      );
      const step = validated.steps[0];
      if (step.type !== "agent") throw new Error("expected agent step");
      expect(step.model).toBe(preset.tiers.balanced);
      expect(step.tier).toBe("balanced");
    });

    it(`preset=${preset.id}: tier="capable" resolves to ${preset.tiers.capable}`, () => {
      const [validated] = validateWorkflowDefinitions(
        [
          registerWorkflowDefinition("preset-parity-capable.ts", {
            repository: "read",
            name: "preset-parity-capable",
            moduleRoot: workflowRoot,
            triggers: [{ event: "preset-parity.probe" }],
            defaultAutonomyMode: "autonomous",
            steps: [
              {
                type: "agent",
                id: "probe-capable-tier",
                tier: "capable",
                autonomyMode: "autonomous",
                promptPath: promptName,
              },
            ],
          }),
        ],
        workflowRoot,
        { preset, defaultAgentHarness: preset.harness },
      );
      const step = validated.steps[0];
      if (step.type !== "agent") throw new Error("expected agent step");
      expect(step.harness).toBe(preset.harness);
      expect(step.model).toBe(preset.tiers.capable);
      expect(step.effort).toBe(preset.defaultEffort);
    });
  }
});

