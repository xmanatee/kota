
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentUsage } from "#core/agent-harness/usage.js";
import { parseAgentUsage } from "#core/agent-harness/usage.js";
import { readImportedSkillRecords } from "#core/modules/imported-skills.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import type { FixtureJsonValue, SkillAblationVariantSpec } from "./fixture.js";
import type { SkillAblationPromptNeedleResult, SkillAblationPromptResolution, SkillAblationResolvedSkill, SkillAblationUsageFacts } from "./fixture-run.js";
import type { WorkflowExecutionOutcome } from "./runner-types.js";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function resolveSkillsPromptEvidence(params: {
  workingDir: string;
  variant: SkillAblationVariantSpec;
}): {
  resolvedPrompt: string;
  resolvedSkills: SkillAblationResolvedSkill[];
} {
  const loader = new ModuleLoader({}, false, { mode: "commands" });
  loader.setCwd(params.workingDir);
  const resolvedPrompt = loader.getSkillsPromptFor(
    [...params.variant.selectedSkills],
    params.variant.agentName,
  );
  const records = readImportedSkillRecords(params.workingDir);
  const recordsByName = new Map(records.map((record) => [record.def.name, record]));
  const resolvedSkills: SkillAblationResolvedSkill[] =
    params.variant.selectedSkills.map((name) => {
      const record = recordsByName.get(name);
      if (record === undefined) {
        return {
          name,
          expectedProvenance: params.variant.skillProvenance,
          resolved: false,
          provenance: "unresolved",
          promptPath: null,
          importedFrom: null,
          resourceSummary: null,
          importedFiles: [],
        };
      }
      return {
        name,
        expectedProvenance: params.variant.skillProvenance,
        resolved: true,
        provenance: "imported",
        promptPath: record.def.promptPath,
        importedFrom: record.provenance ?? null,
        resourceSummary: record.resourceSummary ?? null,
        importedFiles: record.importedFiles ?? [],
      };
    });
  return { resolvedPrompt, resolvedSkills };
}

function readAgentInputArtifact(
  runArtifactPath: string | null,
  agentStepId: string,
): { path: string | null; text: string | null } {
  if (runArtifactPath === null) return { path: null, text: null };
  const path = join(runArtifactPath, "steps", `${agentStepId}.input.md`);
  if (!existsSync(path) || !statSync(path).isFile()) {
    return { path, text: null };
  }
  return { path, text: readFileSync(path, "utf8") };
}

function evaluateRequiredNeedles(
  text: string | null,
  needles: readonly string[] | undefined,
): SkillAblationPromptNeedleResult[] {
  return (needles ?? []).map((needle) => {
    const present = text?.includes(needle) ?? false;
    return { needle, present, passed: present };
  });
}

function evaluateForbiddenNeedles(
  text: string | null,
  needles: readonly string[] | undefined,
): SkillAblationPromptNeedleResult[] {
  return (needles ?? []).map((needle) => {
    const present = text?.includes(needle) ?? false;
    return { needle, present, passed: !present };
  });
}

export function evaluatePromptResolution(params: {
  workingDir: string;
  variant: SkillAblationVariantSpec;
  executionOutcome: WorkflowExecutionOutcome;
}): SkillAblationPromptResolution {
  const { resolvedPrompt, resolvedSkills } = resolveSkillsPromptEvidence({
    workingDir: params.workingDir,
    variant: params.variant,
  });
  const agentInput = readAgentInputArtifact(
    params.executionOutcome.runArtifactPath,
    params.variant.agentStepId,
  );
  const requiredNeedles = evaluateRequiredNeedles(
    agentInput.text,
    params.variant.promptEvidence.requiredNeedles,
  );
  const forbiddenNeedles = evaluateForbiddenNeedles(
    agentInput.text,
    params.variant.promptEvidence.forbiddenNeedles,
  );
  const selectedSkillsResolved =
    params.variant.skillProvenance === "none"
      ? params.variant.selectedSkills.length === 0 && resolvedSkills.length === 0
      : resolvedSkills.length === params.variant.selectedSkills.length &&
        resolvedSkills.every((skill) => skill.resolved && skill.provenance === "imported");
  const needlesPassed =
    requiredNeedles.every((result) => result.passed) &&
    forbiddenNeedles.every((result) => result.passed);
  const passed =
    selectedSkillsResolved &&
    agentInput.text !== null &&
    needlesPassed;
  const detail = passed
    ? `variant "${params.variant.id}" prompt evidence matched selected skill set`
    : `variant "${params.variant.id}" prompt evidence failed: ${
        selectedSkillsResolved ? "" : "selected skills did not resolve; "
      }${agentInput.text === null ? "agent input artifact missing; " : ""}${
        needlesPassed ? "" : "prompt needles did not match"
      }`.trimEnd();
  return {
    agentName: params.variant.agentName,
    agentStepId: params.variant.agentStepId,
    selectedSkills: params.variant.selectedSkills,
    resolutionSource: "ModuleLoader.getSkillsPromptFor",
    resolvedPromptHash: sha256(resolvedPrompt),
    resolvedPromptLength: resolvedPrompt.length,
    agentInputPath: agentInput.path,
    agentInputFound: agentInput.text !== null,
    requiredNeedles,
    forbiddenNeedles,
    resolvedSkills,
    passed,
    detail,
  };
}

type AgentStepUsageFile = {
  usage?: unknown;
  output?: {
    turns?: FixtureJsonValue;
    subtype?: FixtureJsonValue;
  };
};

function nullableNumber(value: FixtureJsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: FixtureJsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function measuredTokens(usage: AgentUsage | undefined): {
  inputTokens: number | null;
  outputTokens: number | null;
} {
  return usage === undefined || usage.tokens.state === "unknown"
    ? { inputTokens: null, outputTokens: null }
    : {
        inputTokens: usage.tokens.inputTokens,
        outputTokens: usage.tokens.outputTokens,
      };
}

export function readAgentStepUsage(
  runArtifactPath: string | null,
  agentStepId: string,
): SkillAblationUsageFacts {
  const empty: SkillAblationUsageFacts = {
    turns: null,
    totalCostUsd: null,
    inputTokens: null,
    outputTokens: null,
    subtype: null,
  };
  if (runArtifactPath === null) return empty;
  const path = join(runArtifactPath, "steps", `${agentStepId}.json`);
  if (!existsSync(path) || !statSync(path).isFile()) return empty;
  let parsed: AgentStepUsageFile;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as AgentStepUsageFile;
  } catch {
    return empty;
  }
  let usage: AgentUsage | undefined;
  if (parsed.usage !== undefined) {
    try {
      usage = parseAgentUsage(parsed.usage, "usage");
    } catch {
      return empty;
    }
  }
  const tokens = measuredTokens(usage);
  return {
    turns: nullableNumber(parsed.output?.turns),
    totalCostUsd:
      usage?.cost.state === "complete" ? usage.cost.usd : null,
    ...tokens,
    subtype: nullableString(parsed.output?.subtype),
  };
}
