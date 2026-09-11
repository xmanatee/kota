import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CRITIC_REVIEW_ARTIFACT = "critic-review.json";

export type CriticVerdict = {
  verdict: "pass" | "fail" | "pass_with_warnings";
  critical_issues: string[];
  warnings: string[];
  summary: string;
};

export function clearCriticOutcomeArtifact(runDir: string): void {
  // A repair loop can invoke the critic more than once. The artifact
  // represents only the final invocation, so clear the prior outcome before
  // starting another judge attempt.
  rmSync(join(runDir, CRITIC_REVIEW_ARTIFACT), { force: true });
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCriticVerdictValue(value: unknown): value is CriticVerdict["verdict"] {
  return value === "pass" || value === "fail" || value === "pass_with_warnings";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every(isString)) {
    throw new Error("Critic issue and warning fields must be string arrays");
  }
  return value;
}

function tryParseJsonObject(text: string): JsonObject | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
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
    const parsedJson: unknown = JSON.parse(stripped);
    parsed = isJsonObject(parsedJson) ? parsedJson : undefined;
  } catch {
    parsed = extractJson(text);
  }
  if (!parsed) {
    throw new Error(
      `Critic returned invalid JSON. Response (first 500 chars): ${stripped.slice(0, 500)}`,
    );
  }

  return decodeCriticVerdict(parsed);
}

/** Shared boundary for live output and persisted review evidence. */
export function decodeCriticVerdict(parsed: unknown): CriticVerdict {
  if (!isJsonObject(parsed)) throw new Error("Invalid critic verdict payload");
  if (!isCriticVerdictValue(parsed.verdict)) {
    throw new Error(`Invalid critic verdict: ${String(parsed.verdict)}`);
  }
  if (typeof parsed.summary !== "string") throw new Error("Critic summary must be a string");
  const criticalIssues = readStringArray(parsed.critical_issues);
  const warnings = readStringArray(parsed.warnings);
  if ((parsed.verdict === "fail") !== (criticalIssues.length > 0)) {
    throw new Error("A failed verdict requires critical issues; an accepted verdict cannot contain them");
  }
  if ((parsed.verdict === "pass" && warnings.length > 0) ||
      (parsed.verdict === "pass_with_warnings" && warnings.length === 0)) {
    throw new Error("Warning disposition must agree with the reported warnings");
  }
  return {
    verdict: parsed.verdict,
    critical_issues: criticalIssues,
    warnings,
    summary: parsed.summary,
  };
}

export function handleVerdict(
  verdict: CriticVerdict & { reviewerPromptHash: string },
  runDir: string,
): string {
  // Keep the final verdict at its existing evidence owner, including a rejected review.
  const artifactPath = join(runDir, CRITIC_REVIEW_ARTIFACT);
  writeFileSync(artifactPath, JSON.stringify({ ...verdict, generatedAt: new Date().toISOString() }, null, 2));
  if (verdict.verdict === "fail") {
    // Reviewer prose remains inspectable without preloading it into a repair prompt.
    throw new Error(
      `Critic found ${verdict.critical_issues.length} critical issue(s). ` +
      `Review ${artifactPath} for the complete actionable evidence.`,
    );
  }
  const parts = [`OK: critic verdict — ${verdict.verdict}`];
  if (verdict.summary) parts.push(verdict.summary);
  if (verdict.warnings.length > 0) {
    parts.push(`(${verdict.warnings.length} warning(s) recorded in ${CRITIC_REVIEW_ARTIFACT})`);
  }
  return parts.join(". ");
}
