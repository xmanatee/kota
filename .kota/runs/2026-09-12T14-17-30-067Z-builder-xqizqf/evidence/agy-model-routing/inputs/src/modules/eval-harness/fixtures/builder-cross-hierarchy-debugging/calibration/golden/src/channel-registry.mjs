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
  const candidates = [];
  for (let length = parts.length; length > 0; length -= 1) {
    candidates.push(parts.slice(0, length).join("/"));
  }
  return candidates;
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
