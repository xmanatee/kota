import { readJson } from "./validation.mjs";

export const hiddenCases = [
  {
    id: "hidden-valid-alternate-output",
    expected: "accept",
    requirementIds: ["FSF-1", "FSF-3", "FSF-6"],
    request: {
      purchaseChannel: "online",
      daysSinceDelivery: 45,
      itemCategory: "apparel",
      condition: "new",
      memberTier: "gold",
      proofOfPurchase: true,
    },
    decision: {
      eligible: true,
      method: "prepaid-label",
      chargeCents: 0,
      reasonCode: "gold-window",
    },
  },
  {
    id: "hidden-final-sale-approved",
    expected: "reject",
    requirementIds: ["FSF-1", "FSF-5"],
    request: {
      purchaseChannel: "online",
      daysSinceDelivery: 1,
      itemCategory: "final-sale",
      condition: "new",
      memberTier: "gold",
      proofOfPurchase: true,
    },
    decision: {
      outcome: "label-approved",
      labelRequired: true,
      feeCents: 0,
      reasonCode: "gold-window",
    },
  },
];

function normalizeCase(entry, sourceLabel) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${sourceLabel} case must be an object`);
  }
  for (const key of ["id", "expected"]) {
    if (typeof entry[key] !== "string" || entry[key].length === 0) {
      throw new Error(`${sourceLabel} case is missing ${key}`);
    }
  }
  if (entry.expected !== "accept" && entry.expected !== "reject") {
    throw new Error(`${entry.id}: expected must be accept or reject`);
  }
  if (!Array.isArray(entry.requirementIds) || entry.requirementIds.length === 0) {
    throw new Error(`${entry.id}: requirementIds must be a non-empty array`);
  }
  return {
    id: entry.id,
    expected: entry.expected,
    requirementIds: entry.requirementIds,
    request: entry.request,
    decision: entry.decision,
    sourceLabel,
  };
}

export function loadVisibleCases(projectRoot) {
  const official = readJson(`${projectRoot}/data/official-examples.json`);
  const adversarial = readJson(`${projectRoot}/data/adversarial-cases.json`);
  if (official.schemaVersion !== 1 || adversarial.schemaVersion !== 1) {
    throw new Error("case files must use schemaVersion 1");
  }
  return {
    officialCases: official.cases.map((entry) => normalizeCase(entry, "official")),
    adversarialCases: adversarial.cases.map((entry) =>
      normalizeCase(entry, "adversarial"),
    ),
  };
}

export function visibleAcceptedCaseIds(cases) {
  return cases.filter((entry) => entry.expected === "accept").map((entry) => entry.id);
}

export function visibleRejectedAdversarialCaseIds(adversarialCases) {
  return adversarialCases
    .filter((entry) => entry.expected === "reject")
    .map((entry) => entry.id);
}
