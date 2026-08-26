import { join } from "node:path";
import {
  arrayField,
  artifactRef,
  isJsonObject,
  numberField,
  readJsonObject,
  runArtifactRef,
  stringField,
} from "./control-monitor-coverage-readers.js";
import type {
  ControlCoverageFamilyBuilder,
  ControlCoverageFamilyName,
} from "./control-monitor-coverage-types.js";

type FamilyAccessor = (name: ControlCoverageFamilyName) => ControlCoverageFamilyBuilder;
type AddGap = (
  family: ControlCoverageFamilyName,
  reason: string,
  subject: string,
  refs: string[],
  severity?: "warning" | "error",
) => void;

function addEvidence(family: ControlCoverageFamilyBuilder, ref: string | null): void {
  if (ref) family.evidenceRefs.push(ref);
}

export function inspectTokenBudget(args: {
  scopeRoot: string;
  runDirPath: string;
  stepId: string;
  maxTotalTokens: number | null;
  family: FamilyAccessor;
  addGap: AddGap;
}): void {
  const path = join(args.runDirPath, "steps", `${args.stepId}.token-budget.json`);
  const artifact = readJsonObject(path);
  if (args.maxTotalTokens === null && !artifact) return;

  const tokenBudget = args.family("token-budget");
  tokenBudget.denominator += 1;
  if (!artifact) {
    args.addGap("token-budget", "missing-token-budget-artifact", args.stepId, [
      runArtifactRef(args.scopeRoot, args.runDirPath, "workflow.json"),
    ], "error");
    return;
  }
  const snapshot = isJsonObject(artifact.snapshot) ? artifact.snapshot : null;
  const budget = isJsonObject(snapshot?.budget) ? snapshot.budget : null;
  const recordedMax = numberField(budget?.maxTotalTokens);
  const expectedMax = args.maxTotalTokens ?? recordedMax;
  if (recordedMax === null || expectedMax === null || recordedMax !== expectedMax) {
    args.addGap("token-budget", "token-budget-artifact-mismatch", args.stepId, [
      artifactRef(args.scopeRoot, path),
      runArtifactRef(args.scopeRoot, args.runDirPath, "workflow.json"),
    ], "error");
    return;
  }
  tokenBudget.numerator += 1;
  const ref = artifactRef(args.scopeRoot, path);
  addEvidence(tokenBudget, ref);
  const diagnostics = arrayField(snapshot?.diagnostics).filter(isJsonObject);
  tokenBudget.warned += diagnostics.length;
  for (const diagnostic of diagnostics) {
    const kind = stringField(diagnostic.kind) ?? "diagnostic";
    args.addGap("token-budget", `token-budget-${kind}`, args.stepId, [ref]);
  }
}
