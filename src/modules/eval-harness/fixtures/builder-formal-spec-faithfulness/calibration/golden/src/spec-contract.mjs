const REQUIREMENT_IDS = ["FSF-1", "FSF-2", "FSF-3", "FSF-4", "FSF-5", "FSF-6"];
const EXCLUDED_CATEGORIES = new Set(["gift-card", "perishable", "final-sale"]);
const VALID_CATEGORIES = new Set(["apparel", "gift-card", "perishable", "final-sale"]);
const VALID_CONDITIONS = new Set(["new", "like-new", "damaged"]);
const VALID_TIERS = new Set(["standard", "gold"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidRequestReason(request) {
  if (!isRecord(request)) return "request-not-object";
  if (request.purchaseChannel !== "online" && request.purchaseChannel !== "store") {
    return "invalid-purchase-channel";
  }
  if (!Number.isInteger(request.daysSinceDelivery) || request.daysSinceDelivery < 0) {
    return "invalid-days-since-delivery";
  }
  if (!VALID_CATEGORIES.has(request.itemCategory)) return "invalid-item-category";
  if (!VALID_CONDITIONS.has(request.condition)) return "invalid-condition";
  if (!VALID_TIERS.has(request.memberTier)) return "invalid-member-tier";
  if (typeof request.proofOfPurchase !== "boolean") return "invalid-proof-of-purchase";
  return null;
}

function expectedOutcome(request) {
  const invalidReason = invalidRequestReason(request);
  if (invalidReason !== null) {
    return { kind: "invalid-request", reason: invalidReason, requirementIds: ["FSF-1"] };
  }
  if (request.purchaseChannel === "store") {
    return { kind: "in-store-return-required", reason: "store-purchase", requirementIds: ["FSF-4"] };
  }
  const ids = [request.memberTier === "gold" ? "FSF-3" : "FSF-2"];
  if (
    request.proofOfPurchase !== true ||
    EXCLUDED_CATEGORIES.has(request.itemCategory) ||
    request.condition === "damaged"
  ) {
    return { kind: "label-denied", reason: "excluded-or-no-proof", requirementIds: [...ids, "FSF-5"] };
  }
  const windowDays = request.memberTier === "gold" ? 45 : 30;
  if (request.daysSinceDelivery > windowDays) {
    return { kind: "label-denied", reason: "window-expired", requirementIds: ids };
  }
  return { kind: "label-approved", reason: "within-window", requirementIds: ids };
}

function normalizeDecision(decision) {
  if (!isRecord(decision)) return { kind: "unknown", reason: "decision-not-object" };
  if (
    decision.outcome === "label-approved" &&
    decision.labelRequired === true &&
    decision.feeCents === 0
  ) {
    return { kind: "label-approved", reason: decision.reasonCode ?? "label-approved" };
  }
  if (
    decision.eligible === true &&
    decision.method === "prepaid-label" &&
    decision.chargeCents === 0
  ) {
    return { kind: "label-approved", reason: decision.reasonCode ?? "label-approved" };
  }
  if (decision.outcome === "in-store-return-required" && decision.labelRequired === false) {
    return { kind: "in-store-return-required", reason: decision.reasonCode ?? "store-purchase" };
  }
  if (decision.eligible === false && decision.method === "store-return") {
    return { kind: "in-store-return-required", reason: decision.reasonCode ?? "store-purchase" };
  }
  if (decision.outcome === "invalid-request" && decision.labelRequired === false) {
    return { kind: "invalid-request", reason: decision.reasonCode ?? "invalid-request" };
  }
  if (decision.eligible === false && decision.reasonCode === "invalid-request") {
    return { kind: "invalid-request", reason: "invalid-request" };
  }
  if (decision.outcome === "label-denied" || decision.eligible === false) {
    return { kind: "label-denied", reason: decision.reasonCode ?? "label-denied" };
  }
  return { kind: "unknown", reason: "unrecognized-decision-shape" };
}

function requirementIdsFor(request, expected) {
  return [...new Set(["FSF-1", "FSF-6", ...expected.requirementIds])].sort();
}

export function validateReturnLabelDecision(request, decision) {
  const expected = expectedOutcome(request);
  const observed = normalizeDecision(decision);
  const passed = expected.kind === observed.kind;
  return {
    passed,
    requirementIds: requirementIdsFor(request, expected),
    reasons: passed
      ? []
      : [`expected ${expected.kind} from ${expected.reason}, observed ${observed.kind} from ${observed.reason}`],
    normalizedOutcome: observed.kind,
  };
}
