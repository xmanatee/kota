export type AgentUsageTokens =
  | { state: "complete"; inputTokens: number; outputTokens: number }
  | { state: "partial"; inputTokens: number; outputTokens: number }
  | { state: "unknown" };

export type AgentUsageCost =
  | { state: "complete"; usd: number }
  | { state: "unavailable"; reason: "provider-does-not-report" }
  | { state: "unknown" };

export type AgentUsage = {
  tokens: AgentUsageTokens;
  cost: AgentUsageCost;
};

function usageObject(raw: unknown, field: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${field} must be an object`);
  }
  return raw as Record<string, unknown>;
}

function exactUsageFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  field: string,
): void {
  const allowed = new Set(fields);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${field} contains unexpected field${unexpected.length === 1 ? "" : "s"}: ${unexpected.join(", ")}`);
  }
}

function tokenCount(raw: unknown, field: string): number {
  if (!Number.isInteger(raw) || (raw as number) < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return raw as number;
}

function costUsd(raw: unknown, field: string): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw new Error(`${field} must be a non-negative finite number`);
  }
  return raw;
}

/** Decode untrusted persisted data into the canonical usage contract. */
export function parseAgentUsage(raw: unknown, field: string): AgentUsage {
  const usage = usageObject(raw, field);
  exactUsageFields(usage, ["tokens", "cost"], field);
  const rawTokens = usageObject(usage.tokens, `${field}.tokens`);
  const rawCost = usageObject(usage.cost, `${field}.cost`);

  let tokens: AgentUsageTokens;
  if (rawTokens.state === "unknown") {
    exactUsageFields(rawTokens, ["state"], `${field}.tokens`);
    tokens = { state: "unknown" };
  } else if (rawTokens.state === "complete" || rawTokens.state === "partial") {
    exactUsageFields(
      rawTokens,
      ["state", "inputTokens", "outputTokens"],
      `${field}.tokens`,
    );
    tokens = {
      state: rawTokens.state,
      inputTokens: tokenCount(rawTokens.inputTokens, `${field}.tokens.inputTokens`),
      outputTokens: tokenCount(rawTokens.outputTokens, `${field}.tokens.outputTokens`),
    };
  } else {
    throw new Error(`${field}.tokens.state must be complete, partial, or unknown`);
  }

  let cost: AgentUsageCost;
  if (rawCost.state === "complete") {
    exactUsageFields(rawCost, ["state", "usd"], `${field}.cost`);
    cost = { state: "complete", usd: costUsd(rawCost.usd, `${field}.cost.usd`) };
  } else if (rawCost.state === "unavailable") {
    exactUsageFields(rawCost, ["state", "reason"], `${field}.cost`);
    if (rawCost.reason !== "provider-does-not-report") {
      throw new Error(
        `${field}.cost.reason must be provider-does-not-report when cost is unavailable`,
      );
    }
    cost = { state: "unavailable", reason: "provider-does-not-report" };
  } else if (rawCost.state === "unknown") {
    exactUsageFields(rawCost, ["state"], `${field}.cost`);
    cost = { state: "unknown" };
  } else {
    throw new Error(`${field}.cost.state must be complete, unavailable, or unknown`);
  }

  return { tokens, cost };
}

export const UNKNOWN_AGENT_USAGE: AgentUsage = {
  tokens: { state: "unknown" },
  cost: { state: "unknown" },
};

export const ZERO_AGENT_USAGE: AgentUsage = {
  tokens: { state: "complete", inputTokens: 0, outputTokens: 0 },
  cost: { state: "complete", usd: 0 },
};

export function completeAgentCostUsd(
  usage: AgentUsage | undefined,
): number | undefined {
  return usage?.cost.state === "complete" ? usage.cost.usd : undefined;
}

export function unpricedAgentUsage(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): AgentUsage {
  const tokens = measuredTokenUsage(inputTokens, outputTokens);
  return {
    tokens,
    cost: { state: "unavailable", reason: "provider-does-not-report" },
  };
}

export function pricedAgentUsage(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  totalCostUsd: number | undefined,
): AgentUsage {
  const tokens = measuredTokenUsage(inputTokens, outputTokens);
  return {
    tokens,
    cost: totalCostUsd === undefined
      ? { state: "unknown" }
      : { state: "complete", usd: totalCostUsd },
  };
}

function measuredTokenUsage(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): AgentUsageTokens {
  if (inputTokens === undefined && outputTokens === undefined) {
    return { state: "unknown" };
  }
  return {
    state: inputTokens === undefined || outputTokens === undefined
      ? "partial"
      : "complete",
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
  };
}

export class AgentUsageAccumulator {
  private readonly observations: AgentUsage[] = [];

  readonly observe = (usage: AgentUsage): void => {
    this.observations.push(usage);
  };

  snapshot(): AgentUsage {
    if (this.observations.length === 0) return UNKNOWN_AGENT_USAGE;
    let inputTokens = 0;
    let outputTokens = 0;
    let measuredTokenObservations = 0;
    let allTokensComplete = true;
    let totalCostUsd = 0;
    let allCostsComplete = true;
    let costUnavailable = false;

    for (const usage of this.observations) {
      if (usage.tokens.state === "unknown") {
        allTokensComplete = false;
      } else {
        measuredTokenObservations += 1;
        inputTokens += usage.tokens.inputTokens;
        outputTokens += usage.tokens.outputTokens;
        if (usage.tokens.state === "partial") allTokensComplete = false;
      }
      if (usage.cost.state === "unavailable") {
        costUnavailable = true;
        allCostsComplete = false;
      } else if (usage.cost.state === "unknown") {
        allCostsComplete = false;
      } else {
        totalCostUsd += usage.cost.usd;
      }
    }

    return {
      tokens: measuredTokenObservations === 0
        ? { state: "unknown" }
        : allTokensComplete
          ? { state: "complete", inputTokens, outputTokens }
          : { state: "partial", inputTokens, outputTokens },
      cost: costUnavailable
        ? { state: "unavailable", reason: "provider-does-not-report" }
        : allCostsComplete
          ? { state: "complete", usd: totalCostUsd }
          : { state: "unknown" },
    };
  }
}
