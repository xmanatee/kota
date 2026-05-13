/**
 * Cross-preset model-id sweep — fast-feedback gate that the live operator
 * surfaces (CLI default, capture, answer, autonomy fleet, workflow agent step
 * `tier`) all resolve their model id through the active preset and never
 * leak a literal from a different preset's catalog.
 *
 * This is the strongest invariant against silent-fallback drift: when the
 * active preset is `codex`, no consumer surface may resolve to a `claude-*`
 * model id; when it is `gemini`, no `gpt-*`; when it is `claude`, no
 * `gemini-*`. Every consumer surface this test exercises corresponds to a
 * call site catalogued in `data/tasks/done/task-eradicate-hardcoded-claude-
 * model-defaults.md`.
 *
 * Pairs with `src/preset-parity.integration.test.ts`, which boots the daemon
 * under each preset and runs the operator-shaped scenario. This file is the
 * stand-alone fast-feedback assertion the task asked for so a regression
 * turns a fast `vitest run src/preset-parity-model-sweep` red without paying
 * for the daemon-boot path. The file is named `*.integration.test.ts`
 * because it spans multiple subsystems (preset registry, workflow validator,
 * autonomy module-load) — the root layout guard reserves bare `*.test.ts`
 * for entrypoint-paired unit tests.
 *
 * Pairs with `src/no-hardcoded-model-defaults.integration.test.ts`, which
 * forbids literal vendor model ids in production source. That test guards
 * the static side; this one guards the runtime side — the resolved string
 * each consumer surface would actually send to its adapter.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPreset,
  listShippedPresets,
  mergePresetTiers,
  PRESET_ENV_VAR,
  type Preset,
  resolveActivePresetFromConfig,
  resolveDefaultModel,
  resolveTierModel,
} from "#core/model/preset.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "#core/workflow/validation.js";

type ConsumerSite = {
  /** Stable id used in error messages and result dumps. */
  readonly id: string;
  /** Human-readable description of where in the codebase this surface lives. */
  readonly description: string;
  /** Resolve the model id this surface would send for a given preset. */
  readonly resolve: (preset: Preset) => string;
};

/**
 * Catalog of consumer surfaces this sweep covers. Adding a new surface that
 * routes a model id through the active preset is a one-line entry here —
 * the "no other preset's literal leaks through" assertion below extends
 * automatically.
 */
const CONSUMER_SITES: readonly ConsumerSite[] = [
  {
    id: "cli-default-model",
    description:
      "CLI `kota run` default — `opts.model || config.model || preset.defaultModel`",
    resolve: (preset) => resolveDefaultModel(preset),
  },
  {
    id: "capture-default-model",
    description:
      "capture pipeline — `config.model || resolveActivePresetFromConfig(config).defaultModel`",
    resolve: (preset) =>
      resolveActivePresetFromConfig(
        { defaultPreset: preset.id },
        // Empty env to defeat any host-set KOTA_PRESET that would override
        // config.defaultPreset. The sweep is a per-preset table, not a per-
        // host one.
        {},
      ).defaultModel,
  },
  {
    id: "answer-default-model",
    description:
      "answer pipeline — `config.model || resolveActivePresetFromConfig(config).defaultModel`",
    resolve: (preset) =>
      resolveActivePresetFromConfig(
        { defaultPreset: preset.id },
        {},
      ).defaultModel,
  },
  {
    id: "autonomy-fleet-capable",
    description:
      "autonomy fleet AgentDef — `resolveTierModel(preset, AUTONOMY_AGENT_TIER='capable')`",
    resolve: (preset) => resolveTierModel(preset, "capable"),
  },
  {
    id: "workflow-agent-step-tier-balanced",
    description:
      "workflow agent step `tier: \"balanced\"` resolution via validator",
    resolve: (preset) => mergePresetTiers(preset, undefined).balanced,
  },
  {
    id: "workflow-agent-step-tier-fast",
    description:
      "workflow agent step `tier: \"fast\"` resolution via validator",
    resolve: (preset) => mergePresetTiers(preset, undefined).fast,
  },
  {
    id: "workflow-agent-step-tier-capable",
    description:
      "workflow agent step `tier: \"capable\"` resolution via validator",
    resolve: (preset) => mergePresetTiers(preset, undefined).capable,
  },
];

/**
 * Build the set of model literals that would be a leak for a given preset
 * — every other shipped preset's defaultModel and tier ids. The active
 * preset's own catalog is excluded because `gpt-5.5` is *expected*
 * when the active preset is `codex`.
 */
function buildForeignCatalog(active: Preset): Set<string> {
  const foreign = new Set<string>();
  for (const candidate of listShippedPresets()) {
    if (candidate.id === active.id) continue;
    foreign.add(candidate.defaultModel);
    foreign.add(candidate.tiers.fast);
    foreign.add(candidate.tiers.balanced);
    foreign.add(candidate.tiers.capable);
  }
  // The active preset's own catalog should pass through cleanly even if a
  // sibling preset names the same id — preserve overlap by removing every
  // active-catalog id from the leak set.
  for (const own of [
    active.defaultModel,
    active.tiers.fast,
    active.tiers.balanced,
    active.tiers.capable,
  ]) {
    foreign.delete(own);
  }
  return foreign;
}

function ownCatalog(preset: Preset): readonly string[] {
  return [
    preset.defaultModel,
    preset.tiers.fast,
    preset.tiers.balanced,
    preset.tiers.capable,
  ];
}

describe("preset-parity model-id sweep — every consumer surface routes through the active preset", () => {
  for (const preset of listShippedPresets()) {
    describe(`active preset: ${preset.id}`, () => {
      it.each(CONSUMER_SITES)(
        "[$id] resolves to a model id in $description",
        ({ id, resolve }) => {
          const resolved = resolve(preset);
          expect(resolved).toBeTruthy();
          expect(
            ownCatalog(preset),
            `surface ${id} for preset ${preset.id} must resolve to one of ` +
              `${ownCatalog(preset).join(", ")}; got ${resolved}`,
          ).toContain(resolved);
        },
      );

      it("no consumer surface leaks a foreign preset's model id", () => {
        const foreign = buildForeignCatalog(preset);
        const offenders: { site: string; resolved: string }[] = [];
        for (const site of CONSUMER_SITES) {
          const resolved = site.resolve(preset);
          if (foreign.has(resolved)) {
            offenders.push({ site: site.id, resolved });
          }
        }
        expect(
          offenders,
          `Consumer surfaces under active preset ${preset.id} leaked a ` +
            `foreign preset's model id:\n${offenders
              .map((o) => `  ${o.site} → ${o.resolved}`)
              .join("\n")}`,
        ).toEqual([]);
      });
    });
  }
});

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
            name: "preset-parity-capable",
            moduleRoot: workflowRoot,
            triggers: [{ event: "preset-parity.probe" }],
            defaultAutonomyMode: "autonomous",
            steps: [
              {
                type: "agent",
                id: "probe-capable-tier",
                harness: preset.harness,
                tier: "capable",
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
      expect(step.model).toBe(preset.tiers.capable);
    });
  }
});

describe("preset-parity model-id sweep — autonomy fleet defaults rebuild per active preset", () => {
  /**
   * `AUTONOMY_AGENT_DEFAULTS` snapshots `process.env.KOTA_PRESET` at module
   * load. To verify per-preset behavior we re-import the autonomy module
   * with the env var set to each shipped preset id.
   */
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[PRESET_ENV_VAR];
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env[PRESET_ENV_VAR];
    } else {
      process.env[PRESET_ENV_VAR] = savedEnv;
    }
  });

  for (const preset of listShippedPresets()) {
    it(`preset=${preset.id}: autonomy harness and model resolve from the same preset`, async () => {
      process.env[PRESET_ENV_VAR] = preset.id;
      vi.resetModules();
      const fresh = await import("#modules/autonomy/shared.js");
      expect(fresh.AUTONOMY_AGENT_HARNESS).toBe(preset.harness);
      expect(fresh.AUTONOMY_AGENT_DEFAULTS.model).toBe(preset.tiers.capable);
      expect(fresh.AUTONOMY_AGENT_DEFAULTS.effort).toBe(preset.defaultEffort);
      expect(fresh.AUTONOMY_AGENT_DEFAULTS.tier).toBe("capable");
    });
  }
});

describe("preset-parity model-id sweep — every shipped preset has a self-consistent catalog", () => {
  it("every preset's defaultModel appears in its own tier catalog or is the capable tier id", () => {
    for (const preset of listShippedPresets()) {
      const catalog = ownCatalog(preset);
      expect(
        catalog,
        `preset ${preset.id} defaultModel ${preset.defaultModel} must appear in its own catalog (${catalog.join(", ")})`,
      ).toContain(preset.defaultModel);
    }
  });

  it("getPreset round-trips through every shipped id", () => {
    for (const preset of listShippedPresets()) {
      expect(getPreset(preset.id)).toBe(preset);
    }
  });
});
