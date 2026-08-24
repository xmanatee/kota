export type WorkflowFailureRate = {
  workflow: string;
  total: number;
  failures: number;
  rate: number;
};

export type RepairCheckTally = {
  workflow: string;
  checkId: string;
  count: number;
  recovered: number;
  terminal: number;
};

export type DurationOutlier = {
  runId: string;
  workflow: string;
  durationMs: number;
  medianMs: number;
  commitSubject?: string;
};

export type AgentStepTimeout = {
  runId: string;
  workflow: string;
  stepId: string;
  completedAt: string;
  error: string;
};

export type RunOutcomeAggregation = {
  failureRates24h: WorkflowFailureRate[];
  failureRates7d: WorkflowFailureRate[];
  topRepairFailures24h: RepairCheckTally[];
  topRepairFailures7d: RepairCheckTally[];
  durationOutliers: DurationOutlier[];
  /** Infrastructure timeouts remain visible without triggering improver alone. */
  agentStepTimeouts7d: AgentStepTimeout[];
  /** Latest terminal, non-infrastructure, non-improver failure in the window. */
  latestActionableRunAt: string | null;
};
