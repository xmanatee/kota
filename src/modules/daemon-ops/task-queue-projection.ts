import { runWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  repoTaskQueueSnapshotOperation,
} from "#modules/repo-tasks/queue-snapshot-operation.js";
import type { RepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";

/** Daemon-hosted cached projection consumed by the foreground renderer. */
export class DaemonTaskQueueProjection {
  private current: RepoTaskQueueSnapshot | undefined;
  private refreshInFlight: Promise<void> | null = null;

  constructor(private readonly repoRoot: string) {}

  getSnapshot(): RepoTaskQueueSnapshot | undefined {
    return this.current;
  }

  refresh(signal: AbortSignal): Promise<void> {
    if (this.refreshInFlight !== null) return this.refreshInFlight;
    const refresh = runWorkflowBlockingOperation(
      repoTaskQueueSnapshotOperation,
      { repoRoot: this.repoRoot },
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
