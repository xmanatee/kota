import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === "--input" || key === "--output" || key === "--actor" || key === "--request-id") {
      if (!value) throw new Error(`${key} requires a value`);
      args[key.slice(2)] = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${key}`);
  }
  for (const required of ["input", "output", "actor", "request-id"]) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }
  return args;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function roleSet(actor) {
  return new Set(Array.isArray(actor.roles) ? actor.roles : []);
}

function lineViolations(line) {
  const issues = [];
  if (!Number.isInteger(line.amountCents) || line.amountCents <= 0) {
    issues.push("positive-amount-required");
  }
  if (typeof line.receiptId !== "string" || line.receiptId.trim().length === 0) {
    issues.push("receipt-required");
  }
  return issues;
}

function unique(values) {
  return [...new Set(values)];
}

function formatMoney(cents, policy) {
  return new Intl.NumberFormat(policy.locale, {
    style: "currency",
    currency: policy.currency,
    currencyDisplay: "code",
  }).format(cents / 100).replace(/\s+/g, " ");
}

function sustainabilityCredit(claim, policy) {
  const modes = Array.isArray(policy.sustainabilityCreditModes)
    ? policy.sustainabilityCreditModes
    : [];
  if (!modes.includes(claim.tripMode)) {
    return { total: 0, credits: [] };
  }
  const hasRailLine = Array.isArray(claim.lineItems)
    ? claim.lineItems.some((line) => line.category === "rail")
    : false;
  if (!hasRailLine) {
    return { total: 0, credits: [] };
  }
  return {
    total: policy.sustainabilityCreditCents,
    credits: ["sustainability-rail-credit"],
  };
}

function decisionStatus({ claim, actor, policy, violations, adjustedTotalCents }) {
  const roles = roleSet(actor);
  if (violations.length > 0) {
    return { status: "rejected_invalid", reasons: violations };
  }
  if (actor.id === claim.employeeId) {
    return { status: "denied_unauthorized", reasons: ["self-approval-forbidden"] };
  }
  if (claim.policyException === true && !roles.has(policy.policyExceptionRequiredRole)) {
    return {
      status: "requires_compliance",
      reasons: ["policy-exception-requires-compliance"],
    };
  }
  const canApprove =
    roles.has("finance-manager") || roles.has(policy.policyExceptionRequiredRole);
  if (!canApprove) {
    return { status: "denied_unauthorized", reasons: ["approval-role-required"] };
  }
  if (
    roles.has("finance-manager") &&
    !roles.has(policy.policyExceptionRequiredRole) &&
    adjustedTotalCents > policy.managerApprovalLimitCents
  ) {
    return { status: "requires_compliance", reasons: ["manager-limit-exceeded"] };
  }
  return { status: "approved", reasons: [] };
}

function nextEventForStatus(status) {
  switch (status) {
    case "approved":
      return "approved";
    case "rejected_invalid":
      return "rejected";
    case "requires_compliance":
      return "requires_compliance";
    case "denied_unauthorized":
      return "denied";
    default:
      return "reviewed";
  }
}

function evaluateClaim(claim, actor, policy, requestId) {
  if (!Array.isArray(claim.lineItems)) {
    throw new Error(`claim ${claim.id} lineItems must be an array`);
  }
  const rawTotalCents = claim.lineItems.reduce(
    (sum, line) => sum + (Number.isInteger(line.amountCents) ? line.amountCents : 0),
    0,
  );
  const violations = unique(claim.lineItems.flatMap(lineViolations));
  const credit = violations.length === 0
    ? sustainabilityCredit(claim, policy)
    : { total: 0, credits: [] };
  const adjustedTotalCents = rawTotalCents - credit.total;
  const decision = decisionStatus({
    claim,
    actor,
    policy,
    violations,
    adjustedTotalCents,
  });
  const previousHistory = Array.isArray(claim.history) ? claim.history : [];
  const appended = {
    event: nextEventForStatus(decision.status),
    actorId: actor.id,
    requestId,
    previousStatus: claim.status,
    nextStatus: decision.status,
  };
  const history = [...previousHistory, appended];
  return {
    claimId: claim.id,
    employeeId: claim.employeeId,
    status: decision.status,
    reasons: decision.reasons,
    violations,
    rawTotalCents,
    adjustedTotalCents,
    formattedTotal: formatMoney(adjustedTotalCents, policy),
    appliedCredits: credit.credits,
    audit: {
      previousHistoryCount: previousHistory.length,
      nextHistoryCount: history.length,
    },
    history,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = readJson(args.input);
  if (!isRecord(input.policy)) throw new Error("input.policy must be an object");
  if (!Array.isArray(input.actors)) throw new Error("input.actors must be an array");
  if (!Array.isArray(input.claims)) throw new Error("input.claims must be an array");
  const actor = input.actors.find((candidate) => candidate.id === args.actor);
  if (!isRecord(actor)) throw new Error(`unknown actor ${args.actor}`);
  const decisions = input.claims.map((claim) =>
    evaluateClaim(claim, actor, input.policy, args["request-id"]),
  );
  const output = {
    schemaVersion: 1,
    source: {
      inputPath: args.input,
      actorId: args.actor,
      requestId: args["request-id"],
      runToken: process.env.REQUIREMENTS_RUN_TOKEN ?? null,
      policyVersion: input.policy.policyVersion,
    },
    decisions,
    summary: {
      approved: decisions.filter((decision) => decision.status === "approved").length,
      rejectedInvalid: decisions.filter((decision) => decision.status === "rejected_invalid").length,
      requiresCompliance: decisions.filter((decision) => decision.status === "requires_compliance").length,
      deniedUnauthorized: decisions.filter((decision) => decision.status === "denied_unauthorized").length,
    },
  };
  const outputPath = resolve(args.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
}

main();
