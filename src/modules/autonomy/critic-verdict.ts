import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCriticReviewScrutinyRecord,
  runIdFromRunDir,
  writeReviewScrutinyRecord,
} from "./review-scrutiny.js";

export type CriticVerdict = {
  verdict: "pass" | "fail" | "pass_with_warnings";
  critical_issues: string[];
  warnings: string[];
  summary: string;
};

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
  verdict: CriticVerdict,
  runDir?: string,
  artifactName = "critic-review.json",
  context?: {
    runId?: string;
    workflow?: string;
    generatedAt?: string;
    taskId?: string;
  },
): string {
  // Always persist the verdict so live-run calibration tracking can read it
  // back later; operators inspecting a run that passed cleanly no longer need
  // to infer the verdict from the step's repair-iteration output. Repeat
  // critic invocations within one run overwrite the file so it reflects the
  // final verdict.
  if (runDir) {
    writeFileSync(
      join(runDir, artifactName),
      JSON.stringify(verdict, null, 2),
    );
    writeReviewScrutinyRecord(
      runDir,
      buildCriticReviewScrutinyRecord({
        runId: context?.runId ?? runIdFromRunDir(runDir),
        workflow: context?.workflow ?? "unknown",
        generatedAt: context?.generatedAt ?? new Date().toISOString(),
        artifact: artifactName,
        taskId: context?.taskId,
        verdict,
      }),
    );
  }

  if (verdict.verdict === "fail" && verdict.critical_issues.length > 0) {
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
