import { redactSensitiveValues } from "#core/evidence/policy.js";
import { resolveAgentRunDirFromContext } from "#core/workflow/agent-run-dir.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import { writeJsonArtifact } from "./security-review-candidates.js";

/** Export only decoded, selected domain input. Diagnostic projection also masks
 * security terminology, so use the evidence owner's value redaction here. */
export function writeSecurityReviewAgentInput(
  ctx: WorkflowStepContext,
  filename: string,
  input: object,
  identities: readonly string[],
): { artifactPath: string; redacted: boolean } {
  if (identities.some((value) => redactSensitiveValues(value) !== value)) {
    throw new Error("Security review input identity requires redaction; cannot export a verifiable handoff");
  }
  let redacted = false;
  const content: unknown = JSON.parse(JSON.stringify(input, (_key: string, value: unknown) => {
    if (typeof value !== "string") return value;
    const projected = redactSensitiveValues(value);
    redacted ||= projected !== value;
    return projected;
  }));
  return {
    artifactPath: writeJsonArtifact(resolveAgentRunDirFromContext(ctx), filename, { untrusted: true, redacted, input: content }),
    redacted,
  };
}
