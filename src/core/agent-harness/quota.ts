/** Provider-reported account allowance, independent of individual run usage. */
export type WeeklyQuotaSnapshot = {
  usedPercent: number;
  /** Provider reset boundary as Unix seconds. */
  resetsAt: number;
};

export type ReadWeeklyQuota = (signal: AbortSignal) => Promise<WeeklyQuotaSnapshot>;
