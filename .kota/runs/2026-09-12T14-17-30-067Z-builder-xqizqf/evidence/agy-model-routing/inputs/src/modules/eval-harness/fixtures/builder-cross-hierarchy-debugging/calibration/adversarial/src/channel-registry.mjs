const CHANNEL_RULES = new Map([
  [
    "plant-alpha/line-a/press/pump-7",
    {
      queue: "safety-cutoff",
      severity: "critical",
      owner: "pressure-safety",
      ruleKey: "plant-alpha/line-a/press",
    },
  ],
  [
    "plant-alpha/line-b/press/pump-2",
    {
      queue: "safety-cutoff",
      severity: "critical",
      owner: "pressure-safety",
      ruleKey: "plant-alpha/line-b/press",
    },
  ],
  [
    "plant-alpha/line-a/temp/probe-4",
    {
      queue: "thermal-watch",
      severity: "warning",
      owner: "thermal-ops",
      ruleKey: "plant-alpha/line-a/temp",
    },
  ],
  [
    "plant-alpha",
    {
      queue: "ambient-monitor",
      severity: "info",
      owner: "site-ops",
      ruleKey: "plant-alpha",
    },
  ],
]);

export function hierarchyCandidates(path) {
  const root = path.split("/").filter(Boolean).at(0);
  return [path, root].filter(Boolean);
}

export function resolveChannel(path) {
  for (const candidate of hierarchyCandidates(path)) {
    const rule = CHANNEL_RULES.get(candidate);
    if (rule !== undefined) {
      return {
        queue: rule.queue,
        severity: rule.severity,
        owner: rule.owner,
        ruleKey: rule.ruleKey ?? candidate,
      };
    }
  }

  throw new Error(`No channel rule matched ${path}`);
}
