import { join } from "node:path";
import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  type RepoWorkSupply,
  repoWorkSupplyOperation,
  resolveRepoWorkSupplyInput,
} from "#modules/repo-tasks/work-supply.js";

/** Daemon-hosted cached projection consumed by the foreground renderer. */
export class DaemonTaskQueueProjection {
  private current: RepoWorkSupply | undefined;
  private refreshInFlight: Promise<void> | null = null;

  constructor(private readonly repoRoot: string) {}

  getSnapshot(): RepoWorkSupply | undefined {
    return this.current;
  }

  refresh(signal: AbortSignal): Promise<void> {
    if (this.refreshInFlight !== null) return this.refreshInFlight;
    const refresh = runWorkflowBlockingOperation(
      repoWorkSupplyOperation,
      resolveRepoWorkSupplyInput({
        workspaceRoot: this.repoRoot,
        scopeRoot: this.repoRoot,
        stateDir: join(this.repoRoot, ".kota"),
      }),
      { signal },
    ).then((snapshot) => {
      this.current = snapshot;
    });
    const trackedRefresh = refresh.finally(() => {
      if (this.refreshInFlight === trackedRefresh) this.refreshInFlight = null;
    });
    this.refreshInFlight = trackedRefresh;
    return this.refreshInFlight;
  }
}
