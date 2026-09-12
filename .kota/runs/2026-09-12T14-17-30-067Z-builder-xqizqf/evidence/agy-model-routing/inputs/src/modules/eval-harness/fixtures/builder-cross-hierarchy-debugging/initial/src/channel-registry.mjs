const CHANNEL_RULES = new Map([
  [
    "plant-alpha/line-a/press",
    {
      queue: "safety-cutoff",
      severity: "critical",
      owner: "pressure-safety",
    },
  ],
  [
    "plant-alpha/line-b/press",
    {
      queue: "safety-cutoff",
      severity: "critical",
      owner: "pressure-safety",
    },
  ],
  [
    "plant-alpha/line-a/temp",
    {
      queue: "thermal-watch",
      severity: "warning",
      owner: "thermal-ops",
    },
  ],
  [
    "plant-alpha",
    {
      queue: "ambient-monitor",
      severity: "info",
      owner: "site-ops",
    },
  ],
]);

export function hierarchyCandidates(path) {
  const parts = path.split("/").filter(Boolean);
  const leaf = parts.at(-1);
  const root = parts.at(0);
  return [leaf, root].filter(Boolean);
}

export function resolveChannel(path) {
  for (const candidate of hierarchyCandidates(path)) {
    const rule = CHANNEL_RULES.get(candidate);
    if (rule !== undefined) {
      return {
        ...rule,
        ruleKey: candidate,
      };
    }
  }

  throw new Error(`No channel rule matched ${path}`);
}
