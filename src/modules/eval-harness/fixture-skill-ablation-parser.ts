
import type { FixtureJsonValue } from "./fixture-common-types.js";
import {
  isJsonObject,
  isStringArray,
  parseJsonPayload,
  parseRequiredString,
  parseSkillAblationVariantId,
} from "./fixture-parse-utils.js";
import { parsePredicates, parsePreRunExpectations } from "./fixture-predicate-parser.js";
import { parseSkillAblationSetup } from "./fixture-skill-ablation-setup.js";
import type {
  SkillAblationExpectedDirection,
  SkillAblationExpectedOutcome,
  SkillAblationPromptEvidenceSpec,
  SkillAblationSkillProvenance,
  SkillAblationVariantSpec,
} from "./fixture-spec-types.js";

function parseSkillAblationPromptEvidence(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  variantId: string,
): SkillAblationPromptEvidenceSpec {
  if (!isJsonObject(raw)) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" must declare promptEvidence as an object.`,
    );
  }
  const requiredNeedles =
    raw.requiredNeedles === undefined
      ? undefined
      : isStringArray(raw.requiredNeedles)
        ? raw.requiredNeedles
        : null;
  const forbiddenNeedles =
    raw.forbiddenNeedles === undefined
      ? undefined
      : isStringArray(raw.forbiddenNeedles)
        ? raw.forbiddenNeedles
        : null;
  if (requiredNeedles === null || forbiddenNeedles === null) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" promptEvidence needles must be string arrays.`,
    );
  }
  if (
    (requiredNeedles === undefined || requiredNeedles.length === 0) &&
    (forbiddenNeedles === undefined || forbiddenNeedles.length === 0)
  ) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" promptEvidence must declare at least one requiredNeedles or forbiddenNeedles entry.`,
    );
  }
  return {
    ...(requiredNeedles !== undefined && { requiredNeedles }),
    ...(forbiddenNeedles !== undefined && { forbiddenNeedles }),
  };
}

function parseSkillAblationExpectedOutcome(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  variantId: string,
): SkillAblationExpectedOutcome {
  if (raw === "pass" || raw === "fail") return raw;
  throw new Error(
    `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" expectedOutcome must be "pass" or "fail".`,
  );
}

function parseSkillAblationSkillProvenance(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  variantId: string,
): SkillAblationSkillProvenance {
  if (raw === "none" || raw === "imported") return raw;
  throw new Error(
    `Fixture at "${fixtureDir}" skill-ablation variant "${variantId}" skillProvenance must be "none" or "imported".`,
  );
}

function parseSkillAblationVariant(
  raw: FixtureJsonValue,
  fixtureDir: string,
  index: number,
): SkillAblationVariantSpec {
  if (!isJsonObject(raw)) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variants[${index}] must be an object.`,
    );
  }
  const id = parseSkillAblationVariantId(raw, fixtureDir, index);
  const selectedSkills = isStringArray(raw.selectedSkills)
    ? raw.selectedSkills
    : null;
  if (selectedSkills === null) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variant "${id}" selectedSkills must be an array of strings.`,
    );
  }
  const skillProvenance = parseSkillAblationSkillProvenance(
    raw.skillProvenance,
    fixtureDir,
    id,
  );
  if (skillProvenance === "none" && selectedSkills.length > 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variant "${id}" uses skillProvenance "none" but selectedSkills is non-empty.`,
    );
  }
  if (skillProvenance === "imported" && selectedSkills.length === 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" skill-ablation variant "${id}" uses skillProvenance "imported" but selectedSkills is empty.`,
    );
  }
  const setup = parseSkillAblationSetup(raw.setup, fixtureDir, id);
  const triggerPayload = parseJsonPayload(
    raw.triggerPayload,
    fixtureDir,
    `skill-ablation variant "${id}" triggerPayload`,
  );
  return {
    id,
    workflowName: parseRequiredString(raw, "workflowName", fixtureDir),
    agentName: parseRequiredString(raw, "agentName", fixtureDir),
    agentStepId: parseRequiredString(raw, "agentStepId", fixtureDir),
    selectedSkills,
    skillProvenance,
    expectedOutcome: parseSkillAblationExpectedOutcome(
      raw.expectedOutcome,
      fixtureDir,
      id,
    ),
    ...(setup !== undefined && { setup }),
    ...(triggerPayload !== undefined && { triggerPayload }),
    preRunExpectations: parsePreRunExpectations(
      raw.preRunExpectations,
      fixtureDir,
      `skill-ablation variant "${id}" preRunExpectations`,
    ),
    predicates: parsePredicates(
      raw.predicates,
      fixtureDir,
      `skill-ablation variant "${id}" predicate`,
    ),
    promptEvidence: parseSkillAblationPromptEvidence(
      raw.promptEvidence,
      fixtureDir,
      id,
    ),
  };
}

export function parseSkillAblationVariants(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
): SkillAblationVariantSpec[] {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error(
      `Fixture at "${fixtureDir}" mode "skill-ablation" must declare at least two variants.`,
    );
  }
  const variants = raw.map((variant, index) =>
    parseSkillAblationVariant(variant, fixtureDir, index),
  );
  const seen = new Set<string>();
  for (const variant of variants) {
    if (seen.has(variant.id)) {
      throw new Error(
        `Fixture at "${fixtureDir}" declares duplicate skill-ablation variant id "${variant.id}".`,
      );
    }
    seen.add(variant.id);
  }
  if (!variants.some((variant) => variant.selectedSkills.length === 0)) {
    throw new Error(
      `Fixture at "${fixtureDir}" mode "skill-ablation" must include a no-skill control variant.`,
    );
  }
  if (!variants.some((variant) => variant.selectedSkills.length > 0)) {
    throw new Error(
      `Fixture at "${fixtureDir}" mode "skill-ablation" must include at least one explicit-skill treatment variant.`,
    );
  }
  return variants;
}

export function parseSkillAblationExpectedDirection(
  raw: FixtureJsonValue | undefined,
  fixtureDir: string,
  variants: readonly SkillAblationVariantSpec[],
): SkillAblationExpectedDirection {
  if (!isJsonObject(raw)) {
    throw new Error(
      `Fixture at "${fixtureDir}" mode "skill-ablation" must declare expectedDirection as an object.`,
    );
  }
  if (raw.kind !== "treatment-passes-control-fails") {
    throw new Error(
      `Fixture at "${fixtureDir}" expectedDirection.kind must be "treatment-passes-control-fails".`,
    );
  }
  const controlVariantId = parseRequiredString(
    raw,
    "controlVariantId",
    fixtureDir,
  );
  const treatmentVariantId = parseRequiredString(
    raw,
    "treatmentVariantId",
    fixtureDir,
  );
  const noisyVariantId =
    raw.noisyVariantId === undefined
      ? undefined
      : parseRequiredString(raw, "noisyVariantId", fixtureDir);
  const summary = parseRequiredString(raw, "summary", fixtureDir);
  const ids = new Set(variants.map((variant) => variant.id));
  for (const id of [controlVariantId, treatmentVariantId, noisyVariantId]) {
    if (id === undefined || ids.has(id)) continue;
    throw new Error(
      `Fixture at "${fixtureDir}" expectedDirection references unknown skill-ablation variant "${id}".`,
    );
  }
  const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
  if (controlVariantId === treatmentVariantId) {
    throw new Error(
      `Fixture at "${fixtureDir}" expectedDirection must use distinct controlVariantId and treatmentVariantId values.`,
    );
  }
  const control = variantsById.get(controlVariantId);
  if (control === undefined || control.selectedSkills.length !== 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" expectedDirection.controlVariantId must reference a no-skill control variant.`,
    );
  }
  const treatment = variantsById.get(treatmentVariantId);
  if (treatment === undefined || treatment.selectedSkills.length === 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" expectedDirection.treatmentVariantId must reference an explicit-skill treatment variant.`,
    );
  }
  if (noisyVariantId !== undefined) {
    if (noisyVariantId === controlVariantId || noisyVariantId === treatmentVariantId) {
      throw new Error(
        `Fixture at "${fixtureDir}" expectedDirection.noisyVariantId must be distinct from controlVariantId and treatmentVariantId.`,
      );
    }
    const noisy = variantsById.get(noisyVariantId);
    if (noisy === undefined || noisy.selectedSkills.length === 0) {
      throw new Error(
        `Fixture at "${fixtureDir}" expectedDirection.noisyVariantId must reference an explicit-skill noisy variant.`,
      );
    }
  }
  return {
    kind: "treatment-passes-control-fails",
    controlVariantId,
    treatmentVariantId,
    ...(noisyVariantId !== undefined && { noisyVariantId }),
    summary,
  };
}
