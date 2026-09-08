export const verificationCases = [
  {
    id: "visible-line-a-pressure",
    signal: { id: "sig-visible-a", path: "plant-alpha/line-a/press/pump-7", reading: 96 },
    expected: {
      topic: "queue/safety-cutoff",
      severity: "critical",
      ruleKey: "plant-alpha/line-a/press",
      owner: "pressure-safety",
    },
  },
  {
    id: "hidden-line-b-pressure",
    signal: { id: "sig-hidden-b", path: "plant-alpha/line-b/press/pump-2", reading: 91 },
    expected: {
      topic: "queue/safety-cutoff",
      severity: "critical",
      ruleKey: "plant-alpha/line-b/press",
      owner: "pressure-safety",
    },
  },
  {
    id: "adjacent-temperature-route",
    signal: { id: "sig-temp-a", path: "plant-alpha/line-a/temp/probe-4", reading: 78 },
    expected: {
      topic: "queue/thermal-watch",
      severity: "warning",
      ruleKey: "plant-alpha/line-a/temp",
      owner: "thermal-ops",
    },
  },
  {
    id: "holdout-line-a-pressure-sibling",
    signal: { id: "sig-holdout-a", path: "plant-alpha/line-a/press/pump-19", reading: 97 },
    expected: {
      topic: "queue/safety-cutoff",
      severity: "critical",
      ruleKey: "plant-alpha/line-a/press",
      owner: "pressure-safety",
    },
  },
  {
    id: "holdout-line-b-pressure-sibling",
    signal: { id: "sig-holdout-b", path: "plant-alpha/line-b/press/pump-44", reading: 93 },
    expected: {
      topic: "queue/safety-cutoff",
      severity: "critical",
      ruleKey: "plant-alpha/line-b/press",
      owner: "pressure-safety",
    },
  },
  {
    id: "holdout-temperature-sibling",
    signal: { id: "sig-holdout-temp", path: "plant-alpha/line-a/temp/probe-11", reading: 81 },
    expected: {
      topic: "queue/thermal-watch",
      severity: "warning",
      ruleKey: "plant-alpha/line-a/temp",
      owner: "thermal-ops",
    },
  },
];
