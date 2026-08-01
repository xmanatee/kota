import type { ChannelAdapter } from "#core/channels/channel.js";
import type { ScopeDrainBlocker } from "./scope-drain-inspection.js";
import type { ScopeId } from "./scope-registry.js";

/** Fail-closed projection of channel-owned sessions into scope drain blockers. */
export function inspectChannelScopeDrainBlockers(
  channels: readonly ChannelAdapter[],
  scopeId: ScopeId,
): ScopeDrainBlocker[] {
  const ids = new Set<string>();
  const failures: ScopeDrainBlocker[] = [];
  for (const channel of channels) {
    try {
      for (const id of channel.listScopeSessionIds(scopeId)) ids.add(id);
    } catch (error) {
      failures.push({
        kind: "inspection_failure",
        source: "channel-sessions",
        count: 1,
        ids: [],
        requiredDisposition: "repair-inspection",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (ids.size > 0) {
    failures.unshift({
      kind: "session",
      source: "channel-sessions",
      count: ids.size,
      ids: [...ids],
      requiredDisposition: "close",
      detail: `${ids.size} channel session(s) require close`,
    });
  }
  return failures;
}
