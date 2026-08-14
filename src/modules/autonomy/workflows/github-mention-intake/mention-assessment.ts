import { detectInjection } from "#core/util/injection-detector.js";
import { expectStructuredOutput } from "#core/workflow/step-input-code.js";
import { isGitHubImplementationRequest } from "#modules/autonomy/github-mention-classification.js";
import {
  assessActorIntegrity,
  isNonEmptyString,
  mentionPayloadFromTrigger,
  type NormalizedMentionFields,
  normalizedFields,
  surfaceLabel,
  validateNormalizedMentionFields,
} from "./mention-fields.js";
import {
  buildMentionTaskBody,
  mentionTaskSummary,
  mentionTaskTitle,
} from "./task-content.js";

export type GithubMentionIntakeAssessment =
  | {
      decision: "skip";
      taskEligible: false;
      commentEligible: false;
      skipReason: string;
    }
  | {
      decision: "needs_detail";
      taskEligible: false;
      commentEligible: true;
      detailReason: "vague" | "unsafe";
      fields: NormalizedMentionFields;
      responseBody: string;
    }
  | {
      decision: "create_task";
      taskEligible: true;
      commentEligible: true;
      fields: NormalizedMentionFields;
      taskTitle: string;
      taskSummary: string;
      taskBody: string;
    };

function skip(skipReason: string): GithubMentionIntakeAssessment {
  return {
    decision: "skip",
    taskEligible: false,
    commentEligible: false,
    skipReason,
  };
}

function hasConcreteIssueTitle(title: string): boolean {
  const words = title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const generic = new Set([
    "bug",
    "fix",
    "help",
    "issue",
    "problem",
    "request",
    "assistance",
    "needed",
    "todo",
    "change",
  ]);
  return words.length >= 4 && words.filter((word) => !generic.has(word)).length >= 2;
}

function hasConcreteImplementationTarget(body: string): boolean {
  if (/`[^`]+`/.test(body) || /\b[\w.-]+\/[\w./-]+\b/.test(body)) return true;
  return [
    /\b(implement|add|create|update|remove|delete|refactor|modify)\b\s+(?!this\b|that\b|it\b|the\b|a\b|an\b)([a-z0-9_.#/-]+)/i,
    /\bfix\b\s+(?!this\b|that\b|it\b|the\b|a\b|an\b)([a-z0-9_.#/-]+)/i,
  ].some((pattern) => pattern.test(body));
}

function needsDetailResponse(
  fields: NormalizedMentionFields,
  reason: "vague" | "unsafe",
): string {
  if (reason === "unsafe") {
    return [
      `Thanks for the mention on ${surfaceLabel(fields)}.`,
      "",
      "I can route trusted implementation requests into KOTA's task intake, but this mention includes instruction-like or unsafe text that I cannot safely normalize into a repo task.",
      "",
      "Please restate the repository outcome and acceptance evidence without operational instructions, secrets, or approval-bypass requests.",
    ].join("\n");
  }
  return [
    `Thanks for the mention on ${surfaceLabel(fields)}.`,
    "",
    "I can route trusted implementation requests into KOTA's task intake, but this one needs one more concrete acceptance detail before I create a repo task.",
    "",
    "Please reply with the expected repository outcome and how KOTA should verify it.",
  ].join("\n");
}

export function assessMentionTrigger(trigger: {
  event: string;
  payload: object;
}): GithubMentionIntakeAssessment {
  const payload = mentionPayloadFromTrigger(trigger);
  if (!isNonEmptyString(payload.action) || payload.action !== "created") {
    return skip(`unsupported issue_comment action '${String(payload.action)}'`);
  }
  const actorIntegrityReason = assessActorIntegrity(payload);
  if (actorIntegrityReason) return skip(actorIntegrityReason);
  const fields = normalizedFields(payload);
  if ("skipReason" in fields) return skip(fields.skipReason);
  if (!isGitHubImplementationRequest(fields.commentBody)) {
    return skip("mention is not an implementation request");
  }
  const sourceScreening = detectInjection(
    JSON.stringify({
      issueTitle: fields.issueTitle,
      commentBody: fields.commentBody,
    }),
  );
  if (sourceScreening.suspicious) {
    return {
      decision: "needs_detail",
      taskEligible: false,
      commentEligible: true,
      detailReason: "unsafe",
      fields,
      responseBody: needsDetailResponse(fields, "unsafe"),
    };
  }
  if (
    !hasConcreteIssueTitle(fields.issueTitle) &&
    !hasConcreteImplementationTarget(fields.commentBody)
  ) {
    return {
      decision: "needs_detail",
      taskEligible: false,
      commentEligible: true,
      detailReason: "vague",
      fields,
      responseBody: needsDetailResponse(fields, "vague"),
    };
  }
  return {
    decision: "create_task",
    taskEligible: true,
    commentEligible: true,
    fields,
    taskTitle: mentionTaskTitle(fields),
    taskSummary: mentionTaskSummary(fields),
    taskBody: buildMentionTaskBody(fields, sourceScreening),
  };
}

export function validateAssessment(
  raw: Parameters<typeof expectStructuredOutput<GithubMentionIntakeAssessment>>[0],
): GithubMentionIntakeAssessment {
  const object = expectStructuredOutput<{ decision: string }>(raw, ["decision"]);
  const assessment = raw as GithubMentionIntakeAssessment;
  if (object.decision === "skip") {
    if (assessment.taskEligible !== false || assessment.commentEligible !== false) {
      throw new Error("skip assessment must disable task and comment eligibility");
    }
    if (!isNonEmptyString(assessment.skipReason)) {
      throw new Error("skip assessment missing reason");
    }
    return assessment;
  }
  if (object.decision === "needs_detail") {
    if (assessment.taskEligible !== false || assessment.commentEligible !== true) {
      throw new Error("needs_detail assessment eligibility is invalid");
    }
    validateNormalizedMentionFields(assessment.fields);
    if (!isNonEmptyString(assessment.responseBody)) {
      throw new Error("needs_detail assessment missing response body");
    }
    return assessment;
  }
  if (object.decision === "create_task") {
    if (assessment.taskEligible !== true || assessment.commentEligible !== true) {
      throw new Error("create_task assessment eligibility is invalid");
    }
    validateNormalizedMentionFields(assessment.fields);
    if (
      !isNonEmptyString(assessment.taskTitle) ||
      !isNonEmptyString(assessment.taskSummary) ||
      !isNonEmptyString(assessment.taskBody)
    ) throw new Error("create_task assessment is incomplete");
    return assessment;
  }
  throw new Error(`unexpected mention intake assessment decision: ${object.decision}`);
}
