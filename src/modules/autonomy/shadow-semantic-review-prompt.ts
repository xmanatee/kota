import {
  isJsonObject,
  type JsonObject,
  type JsonValue,
  objectArray,
  stringArray,
  stringValue,
} from "./review-scrutiny-types.js";
import type {
  ShadowSemanticReviewerDeclaration,
  ShadowSemanticReviewerResponse,
  ShadowSemanticReviewFinding,
  ShadowSemanticReviewFindingSeverity,
  ShadowSemanticReviewTargetResolution,
} from "./shadow-semantic-review-types.js";

export class ShadowSemanticReviewParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShadowSemanticReviewParseError";
  }
}

function parseJsonObject(text: string): JsonObject {
  const stripped = text
    .replace(/^```(?:json)?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();
  try {
    const parsed = JSON.parse(stripped) as JsonValue;
    if (isJsonObject(parsed)) return parsed;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as JsonValue;
      if (isJsonObject(parsed)) return parsed;
    }
  }
  throw new ShadowSemanticReviewParseError(
    `Shadow semantic reviewer returned invalid JSON. Response (first 500 chars): ${stripped.slice(0, 500)}`,
  );
}

function findingSeverity(
  value: JsonValue | undefined,
): ShadowSemanticReviewFindingSeverity {
  if (value === "info" || value === "warning" || value === "critical") return value;
  throw new ShadowSemanticReviewParseError(`Invalid finding severity: ${String(value)}`);
}

function responseDecision(
  value: JsonValue | undefined,
): ShadowSemanticReviewerResponse["decision"] {
  if (value === "pass" || value === "warn" || value === "fail") return value;
  throw new ShadowSemanticReviewParseError(`Invalid shadow review decision: ${String(value)}`);
}

function parseFinding(value: JsonObject): ShadowSemanticReviewFinding {
  const summary = stringValue(value.summary);
  if (!summary) {
    throw new ShadowSemanticReviewParseError("Shadow review finding missing summary");
  }
  const falsePositive = value.falsePositive === true;
  const falsePositiveReason = stringValue(value.falsePositiveReason) ?? undefined;
  return {
    severity: findingSeverity(value.severity),
    summary,
    citedArtifacts: stringArray(value.citedArtifacts),
    falsePositive,
    ...(falsePositiveReason ? { falsePositiveReason } : {}),
  };
}

export function parseShadowSemanticReviewerResponse(
  text: string,
): ShadowSemanticReviewerResponse {
  const obj = parseJsonObject(text);
  const summary = stringValue(obj.summary);
  if (!summary) {
    throw new ShadowSemanticReviewParseError("Shadow review response missing summary");
  }
  return {
    decision: responseDecision(obj.decision),
    summary,
    findings: objectArray(obj.findings).map(parseFinding),
    citedArtifacts: stringArray(obj.citedArtifacts),
  };
}

export function buildShadowSemanticReviewPrompt(
  declaration: ShadowSemanticReviewerDeclaration,
  resolution: Exclude<ShadowSemanticReviewTargetResolution, { kind: "skip" }>,
): string {
  const target = resolution.target;
  return [
    declaration.reviewer.question,
    "",
    "Review only the declared target artifacts below. Do not infer from hidden reasoning, broad conversation state, or unrelated local files.",
    "",
    "## Target",
    `id: ${target.id}`,
    `kind: ${target.kind}`,
    `summary: ${target.summary}`,
    "",
    "## Artifacts",
    ...target.artifacts.flatMap((artifact) => [
      `### ${artifact.path}`,
      artifact.content,
      "",
    ]),
    "## Output",
    'Return exactly one JSON object: {"decision":"pass|warn|fail","summary":"...","citedArtifacts":["artifact-ref"],"findings":[{"severity":"info|warning|critical","summary":"...","citedArtifacts":["artifact-ref"],"falsePositive":false}]}',
  ].join("\n");
}
