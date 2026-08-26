export const EXPLORER_STATE_KEY = "autonomy/explorer/cooldown";

export type ExplorerState = {
  lastExplorationAt: string | null;
};

export function decodeExplorerState(value: unknown): ExplorerState {
  if (value === null || value === undefined) return { lastExplorationAt: null };
  const lastExplorationAt = (value as Partial<ExplorerState>)?.lastExplorationAt;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    (lastExplorationAt !== null &&
      (typeof lastExplorationAt !== "string" ||
        Number.isNaN(Date.parse(lastExplorationAt))))
  ) {
    throw new Error("explorer cooldown state is invalid");
  }
  return { lastExplorationAt };
}

export function explorerStateAfterCompletion(exploredAt: string): ExplorerState {
  if (Number.isNaN(Date.parse(exploredAt))) {
    throw new Error("explorer completion timestamp is invalid");
  }
  return { lastExplorationAt: exploredAt };
}
