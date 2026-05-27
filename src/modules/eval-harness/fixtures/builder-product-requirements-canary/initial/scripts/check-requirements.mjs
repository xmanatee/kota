import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const servicePath = "src/reimbursement-service.mjs";
const dataPath = "data/reimbursement-workflow.json";
const resultPath = join(projectRoot, "requirements-result.json");
const workDir = join(projectRoot, ".kota", "requirements-canary");
const requiredCanaryIds = [
  "locale-currency-format",
  "role-specific-authorization",
  "audit-history-preserved",
  "validation-rules-enforced",
  "follow-up-policy-exception",
  "backend-data-driven-holdout",
  "regression-original-requirements-preserved",
];

function parseArgs(argv) {
  const args = { selfTestShortcuts: false };
  for (const arg of argv) {
    if (arg === "--self-test-shortcuts") {
      args.selfTestShortcuts = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runService({ inputPath, outputPath, actorId, requestId, runToken }) {
  rmSync(outputPath, { force: true });
  const result = spawnSync(
    process.execPath,
    [
      servicePath,
      "--input",
      inputPath,
      "--output",
      outputPath,
      "--actor",
      actorId,
      "--request-id",
      requestId,
    ],
    {
      cwd: projectRoot,
      env: { ...process.env, REQUIREMENTS_RUN_TOKEN: runToken },
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr, result.error?.message]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(`service command failed for actor ${actorId}: ${detail}`);
  }
  if (!existsSync(outputPath)) {
    throw new Error(`service did not write ${outputPath}`);
  }
  return readJson(outputPath);
}

function decisionById(output, claimId) {
  const decisions = Array.isArray(output.decisions) ? output.decisions : [];
  return decisions.find((decision) => isRecord(decision) && decision.claimId === claimId);
}

function includesAll(actual, expected) {
  return Array.isArray(actual) && expected.every((entry) => actual.includes(entry));
}

function envelopeIssues(output, expected) {
  const issues = [];
  if (!isRecord(output)) {
    return ["service output must be a JSON object"];
  }
  if (output.schemaVersion !== 1) {
    issues.push("schemaVersion must be 1");
  }
  const source = isRecord(output.source) ? output.source : {};
  if (source.inputPath !== expected.inputPath) {
    issues.push(`source.inputPath must be ${expected.inputPath}`);
  }
  if (source.actorId !== expected.actorId) {
    issues.push(`source.actorId must be ${expected.actorId}`);
  }
  if (source.requestId !== expected.requestId) {
    issues.push(`source.requestId must be ${expected.requestId}`);
  }
  if (source.runToken !== expected.runToken) {
    issues.push("source.runToken must preserve the dynamic scorer token");
  }
  if (!Array.isArray(output.decisions)) {
    issues.push("decisions must be an array");
  }
  return issues;
}

function makeCanary(id, observed, issues) {
  return {
    id,
    pass: issues.length === 0,
    observed,
    issues,
  };
}

function validateLocale(primary) {
  const decision = decisionById(primary, "R-1001");
  const issues = [];
  if (!decision) {
    issues.push("R-1001 decision is missing");
    return makeCanary("locale-currency-format", {}, issues);
  }
  if (decision.adjustedTotalCents !== 126450) {
    issues.push(`R-1001 adjustedTotalCents must be 126450, got ${decision.adjustedTotalCents}`);
  }
  if (decision.formattedTotal !== "1.264,50 EUR") {
    issues.push(`R-1001 formattedTotal must be "1.264,50 EUR", got ${JSON.stringify(decision.formattedTotal)}`);
  }
  if (!includesAll(decision.appliedCredits, ["sustainability-rail-credit"])) {
    issues.push("R-1001 must include the sustainability rail credit");
  }
  return makeCanary(
    "locale-currency-format",
    {
      claimId: "R-1001",
      adjustedTotalCents: decision.adjustedTotalCents,
      formattedTotal: decision.formattedTotal,
      appliedCredits: decision.appliedCredits,
    },
    issues,
  );
}

function validateAuthorization(primary, selfProbe) {
  const managerDecision = decisionById(primary, "R-1001");
  const employeeDecision = decisionById(selfProbe, "R-1001");
  const issues = [];
  if (!managerDecision || managerDecision.status !== "approved") {
    issues.push("finance manager must approve the valid normal claim R-1001");
  }
  if (!employeeDecision || employeeDecision.status !== "denied_unauthorized") {
    issues.push("employee self-approval probe must be denied");
  }
  if (!includesAll(employeeDecision?.reasons, ["self-approval-forbidden"])) {
    issues.push("employee denial must name self-approval-forbidden");
  }
  return makeCanary(
    "role-specific-authorization",
    {
      managerStatus: managerDecision?.status,
      employeeStatus: employeeDecision?.status,
      employeeReasons: employeeDecision?.reasons,
    },
    issues,
  );
}

function validateAudit(primary, requestId) {
  const decision = decisionById(primary, "R-1001");
  const history = Array.isArray(decision?.history) ? decision.history : [];
  const audit = isRecord(decision?.audit) ? decision.audit : {};
  const last = history[history.length - 1];
  const issues = [];
  if (audit.previousHistoryCount !== 1 || audit.nextHistoryCount !== 2) {
    issues.push("R-1001 audit counts must preserve one existing entry and append one decision entry");
  }
  if (!isRecord(history[0]) || history[0].event !== "submitted") {
    issues.push("R-1001 original submitted history entry must remain first");
  }
  if (
    !isRecord(last) ||
    last.event !== "approved" ||
    last.actorId !== "fin-1" ||
    last.requestId !== requestId ||
    last.previousStatus !== "submitted" ||
    last.nextStatus !== "approved"
  ) {
    issues.push("R-1001 appended audit entry must record actor, request id, previous status, and next status");
  }
  return makeCanary(
    "audit-history-preserved",
    {
      previousHistoryCount: audit.previousHistoryCount,
      nextHistoryCount: audit.nextHistoryCount,
      firstEvent: history[0]?.event,
      appended: last,
    },
    issues,
  );
}

function validateRules(primary) {
  const decision = decisionById(primary, "R-1002");
  const issues = [];
  if (!decision || decision.status !== "rejected_invalid") {
    issues.push("R-1002 must be rejected by validation");
  }
  if (!includesAll(decision?.violations, ["receipt-required", "positive-amount-required"])) {
    issues.push("R-1002 must name receipt-required and positive-amount-required violations");
  }
  return makeCanary(
    "validation-rules-enforced",
    {
      status: decision?.status,
      violations: decision?.violations,
    },
    issues,
  );
}

function validateFollowUp(primary, complianceProbe) {
  const managerDecision = decisionById(primary, "R-1003");
  const complianceDecision = decisionById(complianceProbe, "R-1003");
  const issues = [];
  if (!managerDecision || managerDecision.status !== "requires_compliance") {
    issues.push("finance manager alone must not approve policy-exception claim R-1003");
  }
  if (!includesAll(managerDecision?.reasons, ["policy-exception-requires-compliance"])) {
    issues.push("manager decision must name policy-exception-requires-compliance");
  }
  if (!complianceDecision || complianceDecision.status !== "approved") {
    issues.push("compliance reviewer must approve valid policy-exception claim R-1003");
  }
  return makeCanary(
    "follow-up-policy-exception",
    {
      managerStatus: managerDecision?.status,
      managerReasons: managerDecision?.reasons,
      complianceStatus: complianceDecision?.status,
    },
    issues,
  );
}

function validateHoldout(holdoutOutput, holdoutId) {
  const decision = decisionById(holdoutOutput, holdoutId);
  const issues = [];
  if (!decision || decision.status !== "approved") {
    issues.push(`dynamic holdout claim ${holdoutId} must be approved`);
  }
  if (decision?.adjustedTotalCents !== 11095) {
    issues.push(`dynamic holdout adjustedTotalCents must be 11095, got ${decision?.adjustedTotalCents}`);
  }
  if (decision?.formattedTotal !== "110,95 EUR") {
    issues.push(`dynamic holdout formattedTotal must be "110,95 EUR", got ${JSON.stringify(decision?.formattedTotal)}`);
  }
  return makeCanary(
    "backend-data-driven-holdout",
    {
      claimId: holdoutId,
      status: decision?.status,
      adjustedTotalCents: decision?.adjustedTotalCents,
      formattedTotal: decision?.formattedTotal,
    },
    issues,
  );
}

function validateRegression(primary) {
  const normal = decisionById(primary, "R-1001");
  const invalid = decisionById(primary, "R-1002");
  const exception = decisionById(primary, "R-1003");
  const issues = [];
  if (normal?.status !== "approved") {
    issues.push("normal valid claim regressed after follow-up policy change");
  }
  if (invalid?.status !== "rejected_invalid") {
    issues.push("validation requirement regressed after follow-up policy change");
  }
  if (exception?.status !== "requires_compliance") {
    issues.push("follow-up exception gate is not active");
  }
  return makeCanary(
    "regression-original-requirements-preserved",
    {
      normalStatus: normal?.status,
      invalidStatus: invalid?.status,
      exceptionStatus: exception?.status,
    },
    issues,
  );
}

function assertRequiredCanaryShape(artifact) {
  const issues = [];
  if (!isRecord(artifact)) return ["requirements-result.json must be a JSON object"];
  if (artifact.schemaVersion !== 1) issues.push("requirements-result schemaVersion must be 1");
  const ids = Array.isArray(artifact.canaries) ? artifact.canaries.map((entry) => entry.id) : [];
  for (const id of requiredCanaryIds) {
    if (!ids.includes(id)) issues.push(`missing canary id ${id}`);
  }
  for (const canary of Array.isArray(artifact.canaries) ? artifact.canaries : []) {
    if (!isRecord(canary.observed) || Object.keys(canary.observed).length === 0) {
      issues.push(`canary ${canary.id} must include observed evidence`);
    }
    if (canary.pass !== true) {
      issues.push(`canary ${canary.id} did not pass`);
    }
  }
  if (artifact.canaryScore !== 1) {
    issues.push(`canaryScore must be 1, got ${artifact.canaryScore}`);
  }
  return issues;
}

function buildHoldoutInput(token) {
  const source = readJson(join(projectRoot, dataPath));
  const holdoutId = `H-${token.slice(-8)}`;
  source.claims = [
    {
      id: holdoutId,
      employeeId: "emp-1",
      status: "submitted",
      tripMode: "rail",
      policyException: false,
      lineItems: [
        {
          id: `HL-${token.slice(-6)}`,
          category: "rail",
          amountCents: 12345,
          receiptId: `rcpt-${token}`,
        },
      ],
      history: [
        {
          event: "submitted",
          actorId: "emp-1",
          at: "2026-05-04T08:00:00.000Z",
        },
      ],
    },
  ];
  return { holdoutId, input: source };
}

function runMainCheck() {
  rmSync(resultPath, { force: true });
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const runToken = `requirements-${randomUUID()}`;
  const primaryRequestId = `primary-${runToken}`;
  const selfRequestId = `self-${runToken}`;
  const complianceRequestId = `compliance-${runToken}`;
  const holdoutRequestId = `holdout-${runToken}`;
  const primaryPath = join(workDir, "primary-output.json");
  const selfPath = join(workDir, "self-approval-output.json");
  const compliancePath = join(workDir, "compliance-output.json");
  const holdoutInputPath = join(workDir, "holdout-input.json");
  const holdoutOutputPath = join(workDir, "holdout-output.json");

  let primary;
  let selfProbe;
  let complianceProbe;
  let holdoutOutput;
  let holdoutId = "";
  const setupIssues = [];
  try {
    primary = runService({
      inputPath: dataPath,
      outputPath: primaryPath,
      actorId: "fin-1",
      requestId: primaryRequestId,
      runToken,
    });
    selfProbe = runService({
      inputPath: dataPath,
      outputPath: selfPath,
      actorId: "emp-1",
      requestId: selfRequestId,
      runToken,
    });
    complianceProbe = runService({
      inputPath: dataPath,
      outputPath: compliancePath,
      actorId: "cmp-1",
      requestId: complianceRequestId,
      runToken,
    });
    const holdout = buildHoldoutInput(runToken);
    holdoutId = holdout.holdoutId;
    writeJson(holdoutInputPath, holdout.input);
    holdoutOutput = runService({
      inputPath: holdoutInputPath,
      outputPath: holdoutOutputPath,
      actorId: "fin-1",
      requestId: holdoutRequestId,
      runToken,
    });
  } catch (error) {
    setupIssues.push(error instanceof Error ? error.message : String(error));
  }

  const canaries = [];
  if (primary && selfProbe && complianceProbe && holdoutOutput) {
    canaries.push(
      makeCanary(
        "locale-currency-format",
        {},
        envelopeIssues(primary, {
          inputPath: dataPath,
          actorId: "fin-1",
          requestId: primaryRequestId,
          runToken,
        }),
      ),
      makeCanary(
        "role-specific-authorization",
        {},
        envelopeIssues(selfProbe, {
          inputPath: dataPath,
          actorId: "emp-1",
          requestId: selfRequestId,
          runToken,
        }),
      ),
      makeCanary(
        "follow-up-policy-exception",
        {},
        envelopeIssues(complianceProbe, {
          inputPath: dataPath,
          actorId: "cmp-1",
          requestId: complianceRequestId,
          runToken,
        }),
      ),
      makeCanary(
        "backend-data-driven-holdout",
        {},
        envelopeIssues(holdoutOutput, {
          inputPath: holdoutInputPath,
          actorId: "fin-1",
          requestId: holdoutRequestId,
          runToken,
        }),
      ),
      validateLocale(primary),
      validateAuthorization(primary, selfProbe),
      validateAudit(primary, primaryRequestId),
      validateRules(primary),
      validateFollowUp(primary, complianceProbe),
      validateHoldout(holdoutOutput, holdoutId),
      validateRegression(primary),
    );
  }

  if (setupIssues.length > 0) {
    canaries.push(makeCanary("service-execution", {}, setupIssues));
  }

  const mergedById = new Map();
  for (const canary of canaries) {
    const existing = mergedById.get(canary.id);
    if (!existing) {
      mergedById.set(canary.id, canary);
      continue;
    }
    mergedById.set(canary.id, {
      id: canary.id,
      pass: existing.pass && canary.pass,
      observed: { ...existing.observed, ...canary.observed },
      issues: [...existing.issues, ...canary.issues],
    });
  }
  const finalCanaries = [...mergedById.values()].filter((canary) =>
    requiredCanaryIds.includes(canary.id),
  );
  const passCount = finalCanaries.filter((canary) => canary.pass).length;
  const artifact = {
    schemaVersion: 1,
    resultId: "builder-product-requirements-canary",
    runToken,
    canaryScore: finalCanaries.length === 0 ? 0 : passCount / requiredCanaryIds.length,
    canaries: finalCanaries,
    outputPaths: {
      primary: ".kota/requirements-canary/primary-output.json",
      selfApprovalProbe: ".kota/requirements-canary/self-approval-output.json",
      complianceProbe: ".kota/requirements-canary/compliance-output.json",
      holdoutProbe: ".kota/requirements-canary/holdout-output.json",
    },
  };
  const artifactShapeIssues = assertRequiredCanaryShape(artifact);
  if (artifactShapeIssues.length > 0) {
    artifact.canaries.push(makeCanary("artifact-machine-readable", {}, artifactShapeIssues));
  }
  writeJson(resultPath, artifact);

  const allIssues = artifact.canaries.flatMap((canary) =>
    canary.issues.map((issue) => `${canary.id}: ${issue}`),
  );
  console.log(
    JSON.stringify(
      {
        status: allIssues.length === 0 ? "passed" : "failed",
        artifact: "requirements-result.json",
        canariesPassed: passCount,
        canariesTotal: requiredCanaryIds.length,
        canaryScore: artifact.canaryScore,
        issues: allIssues,
      },
      null,
      2,
    ),
  );
  if (allIssues.length > 0) process.exit(1);
}

function expectInvalidShortcut(name, artifact, expectedNeedle) {
  const issues = assertRequiredCanaryShape(artifact);
  const joined = issues.join("\n");
  if (!joined.includes(expectedNeedle)) {
    throw new Error(
      `${name} failed for the wrong reason; expected ${JSON.stringify(expectedNeedle)} in ${JSON.stringify(joined)}`,
    );
  }
}

function runShortcutSelfTest() {
  expectInvalidShortcut(
    "prose-only UI artifact",
    {
      schemaVersion: 1,
      canaryScore: 1,
      canaries: [
        {
          id: "locale-currency-format",
          pass: true,
          observed: {},
          issues: [],
        },
      ],
    },
    "missing canary id role-specific-authorization",
  );
  expectInvalidShortcut(
    "hardcoded sample-only artifact",
    {
      schemaVersion: 1,
      canaryScore: 1,
      canaries: requiredCanaryIds.map((id) => ({
        id,
        pass: true,
        observed: {},
        issues: [],
      })),
    },
    "must include observed evidence",
  );
  expectInvalidShortcut(
    "follow-up regression artifact",
    {
      schemaVersion: 1,
      canaryScore: 6 / 7,
      canaries: requiredCanaryIds.map((id) => ({
        id,
        pass: id !== "follow-up-policy-exception",
        observed: { checked: id },
        issues: id === "follow-up-policy-exception" ? ["manager improperly approved exception"] : [],
      })),
    },
    "canary follow-up-policy-exception did not pass",
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        shortcutGuards: [
          "prose-only-ui-artifact",
          "hardcoded-sample-only-artifact",
          "follow-up-regression-artifact",
        ],
      },
      null,
      2,
    ),
  );
}

const args = parseArgs(process.argv.slice(2));
if (args.selfTestShortcuts) {
  runShortcutSelfTest();
} else {
  runMainCheck();
}
