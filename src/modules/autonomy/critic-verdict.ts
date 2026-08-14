import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCriticReviewScrutinyRecord,
  runIdFromRunDir,
  writeReviewScrutinyRecord,
} from "./review-scrutiny.js";
import {
  countFileLineCitations,
  normalizeFileLineCitations,
} from "./review-scrutiny-citations.js";
import { REVIEW_SCRUTINY_ARTIFACT } from "./review-scrutiny-types.js";

export type CriticVerdict = {
  verdict: "pass" | "fail" | "pass_with_warnings";
  critical_issues: string[];
  warnings: string[];
  summary: string;
};

export function clearCriticOutcomeArtifacts(runDir: string): void {
  // A repair loop can invoke the critic more than once. These artifacts
  // represent only the final invocation, so clear the prior outcome before
  // starting another judge attempt.
  rmSync(join(runDir, "critic-review.json"), { force: true });
  rmSync(join(runDir, REVIEW_SCRUTINY_ARTIFACT), { force: true });
}

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue | undefined };

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCriticVerdictValue(value: JsonValue | undefined): value is CriticVerdict["verdict"] {
  return value === "pass" || value === "fail" || value === "pass_with_warnings";
}

function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function readStringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.every(isString) ? value : [];
}

function tryParseJsonObject(text: string): JsonObject | undefined {
  try {
    const parsed: JsonValue = JSON.parse(text);
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function extractJson(text: string): JsonObject | undefined {
  const jsonBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (jsonBlockMatch) {
    const parsed = tryParseJsonObject(jsonBlockMatch[1].trim());
    if (parsed) return parsed;
  }
  const braceMatch = text.match(/\{[\s\S]*"verdict"[\s\S]*\}/);
  if (braceMatch) {
    const parsed = tryParseJsonObject(braceMatch[0]);
    if (parsed) return parsed;
  }
  return undefined;
}

function hasAcceptedVerdictScrutinySignal(verdict: CriticVerdict): boolean {
  if (verdict.critical_issues.length > 0 || verdict.warnings.length > 0) return true;
  return (
    countFileLineCitations(
      [verdict.summary, ...verdict.critical_issues, ...verdict.warnings].join("\n"),
    ) > 0
  );
}

function normalizeAcceptedVerdictScrutiny(
  verdict: CriticVerdict,
  fallbackFileLineCitations: readonly string[],
): CriticVerdict {
  if (verdict.verdict !== "pass" && verdict.verdict !== "pass_with_warnings") {
    return verdict;
  }
  if (hasAcceptedVerdictScrutinySignal(verdict)) return verdict;
  const citations = normalizeFileLineCitations(fallbackFileLineCitations);
  const citationText =
    citations.length > 0 ? ` Reviewed diff refs: ${citations.join(", ")}.` : "";
  return {
    ...verdict,
    verdict: "pass_with_warnings",
    warnings: [
      ...verdict.warnings,
      "Accepted reviewer verdict omitted warnings, critical issues, and file-line citations; review-scrutiny recorded this reviewer-evidence gap." +
        citationText,
    ],
  };
}

export function parseVerdict(text: string): CriticVerdict {
  const stripped = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  let parsed: JsonObject | undefined;
  try {
    const parsedJson: JsonValue = JSON.parse(stripped);
    parsed = isJsonObject(parsedJson) ? parsedJson : undefined;
  } catch {
    parsed = extractJson(text);
  }
  if (!parsed) {
    throw new Error(
      `Critic returned invalid JSON. Response (first 500 chars): ${stripped.slice(0, 500)}`,
    );
  }

  if (!isCriticVerdictValue(parsed.verdict)) {
    throw new Error(`Invalid verdict: ${parsed.verdict}`);
  }
  return {
    verdict: parsed.verdict,
    critical_issues: readStringArray(parsed.critical_issues),
    warnings: readStringArray(parsed.warnings),
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
  };
}

export function handleVerdict(
  rawVerdict: CriticVerdict,
  runDir?: string,
  artifactName = "critic-review.json",
  context?: {
    runId?: string;
    workflow?: string;
    generatedAt?: string;
    reviewerPromptHash?: string;
    taskId?: string;
    fallbackFileLineCitations?: readonly string[];
    /** Keep agent-generated reviewer prose discoverable without preloading it into a repair prompt. */
    failureDetailMode?: "inline" | "artifact-reference";
  },
): string {
  const verdict = normalizeAcceptedVerdictScrutiny(
    rawVerdict,
    context?.fallbackFileLineCitations ?? [],
  );
  // Always persist the verdict so live-run calibration tracking can read it
  // back later; operators inspecting a run that passed cleanly no longer need
  // to infer the verdict from the step's repair-iteration output. Repeat
  // critic invocations within one run overwrite the file so it reflects the
  // final verdict.
  if (runDir) {
    const generatedAt = context?.generatedAt ?? new Date().toISOString();
    writeFileSync(
      join(runDir, artifactName),
      JSON.stringify(
        {
          ...verdict,
          generatedAt,
          ...(context?.reviewerPromptHash
            ? { reviewerPromptHash: context.reviewerPromptHash }
            : {}),
        },
        null,
        2,
      ),
    );
    writeReviewScrutinyRecord(
      runDir,
      buildCriticReviewScrutinyRecord({
        runId: context?.runId ?? runIdFromRunDir(runDir),
        workflow: context?.workflow ?? "unknown",
        generatedAt,
        artifact: artifactName,
        reviewerPromptHash: context?.reviewerPromptHash,
        taskId: context?.taskId,
        verdict,
      }),
    );
  }

  if (verdict.verdict === "fail" && verdict.critical_issues.length > 0) {
    if (runDir && context?.failureDetailMode === "artifact-reference") {
      throw new Error(
        `Critic found ${verdict.critical_issues.length} critical issue(s). ` +
          `Review ${join(runDir, artifactName)} for the complete actionable evidence.`,
      );
    }
    throw new Error(
      `Critic found ${verdict.critical_issues.length} critical issue(s):\n` +
        verdict.critical_issues.map((issue, i) => `  ${i + 1}. ${issue}`).join("\n") +
        (verdict.summary ? `\n\nSummary: ${verdict.summary}` : ""),
    );
  }

  const parts = [`OK: critic verdict — ${verdict.verdict}`];
  if (verdict.summary) parts.push(verdict.summary);
  if (verdict.warnings.length > 0) {
    parts.push(`(${verdict.warnings.length} warning(s) recorded in ${artifactName})`);
  }
  return parts.join(". ");
}
