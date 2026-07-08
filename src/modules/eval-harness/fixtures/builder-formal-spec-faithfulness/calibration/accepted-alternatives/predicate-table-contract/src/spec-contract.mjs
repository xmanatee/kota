const EVERY_REQUIREMENT = ["FSF-1", "FSF-2", "FSF-3", "FSF-4", "FSF-5", "FSF-6"];
const EXCLUDED = new Set(["gift-card", "perishable", "final-sale"]);

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const validators = [
  ["purchaseChannel", (v) => v === "online" || v === "store"],
  ["daysSinceDelivery", (v) => Number.isInteger(v) && v >= 0],
  ["itemCategory", (v) => ["apparel", "gift-card", "perishable", "final-sale"].includes(v)],
  ["condition", (v) => ["new", "like-new", "damaged"].includes(v)],
  ["memberTier", (v) => ["standard", "gold"].includes(v)],
  ["proofOfPurchase", (v) => typeof v === "boolean"],
];

function requestIsValid(request) {
  return record(request) && validators.every(([field, valid]) => valid(request[field]));
}

function intendedKind(request) {
  if (!requestIsValid(request)) return ["invalid-request", ["FSF-1"]];
  if (request.purchaseChannel === "store") return ["in-store-return-required", ["FSF-4"]];
  const windowDays = request.memberTier === "gold" ? 45 : 30;
  const windowId = request.memberTier === "gold" ? "FSF-3" : "FSF-2";
  if (
    request.proofOfPurchase !== true ||
    request.condition === "damaged" ||
    EXCLUDED.has(request.itemCategory) ||
    request.daysSinceDelivery > windowDays
  ) {
    return ["label-denied", [windowId, "FSF-5"]];
  }
  return ["label-approved", [windowId]];
}

const decisionPredicates = [
  [
    "label-approved",
    (d) =>
      record(d) &&
      ((d.outcome === "label-approved" && d.labelRequired === true && d.feeCents === 0) ||
        (d.eligible === true && d.method === "prepaid-label" && d.chargeCents === 0)),
  ],
  [
    "in-store-return-required",
    (d) =>
      record(d) &&
      ((d.outcome === "in-store-return-required" && d.labelRequired === false) ||
        (d.eligible === false && d.method === "store-return")),
  ],
  [
    "invalid-request",
    (d) =>
      record(d) &&
      ((d.outcome === "invalid-request" && d.labelRequired === false) ||
        (d.eligible === false && d.reasonCode === "invalid-request")),
  ],
  [
    "label-denied",
    (d) => record(d) && (d.outcome === "label-denied" || d.eligible === false),
  ],
];

function observedKind(decision) {
  return decisionPredicates.find(([, predicate]) => predicate(decision))?.[0] ?? "unknown";
}

export function validateReturnLabelDecision(request, decision) {
  const [expected, ids] = intendedKind(request);
  const observed = observedKind(decision);
  return {
    passed: expected === observed,
    requirementIds: [...new Set(["FSF-1", "FSF-6", ...ids])].sort(),
    reasons: expected === observed ? [] : [`expected ${expected}; observed ${observed}`],
    normalizedOutcome: observed,
  };
}
