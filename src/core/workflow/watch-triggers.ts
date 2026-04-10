import { matchesGlob } from "node:path";
import { WatcherManager } from "#root/file-watcher.js";
import type { BusEvents } from "#core/events/event-bus-types.js";
import type { WorkflowDefinition, WorkflowRunTrigger, WorkflowTrigger } from "./types.js";

type FileChangedPayload = BusEvents["file.changed"];

type SubscribeFn = (
  handler: (payload: FileChangedPayload) => void,
) => () => void;

type EnqueueFn = (
  definition: WorkflowDefinition,
  trigger: WorkflowTrigger,
  runTrigger: WorkflowRunTrigger,
) => void;

type WatchEntry = {
  watcherId: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  pendingFiles: Set<string>;
  definition: WorkflowDefinition;
  trigger: WorkflowTrigger;
};

/**
 * Manages file-watch triggers for workflow definitions.
 * Only active when the daemon is running; silently skipped in standalone CLI mode.
 */
export class WatchTriggerManager {
  private readonly watcher = new WatcherManager();
  /** Key: `${workflowName}:${triggerIndex}` */
  private readonly entries = new Map<string, WatchEntry>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly projectDir: string,
    private readonly isStopping: () => boolean,
    private readonly enqueueRun: EnqueueFn,
    private readonly maybeStartNext: () => void,
  ) {}

  /**
   * Register watch triggers from definitions and subscribe to file-changed events.
   * Watcher startup is async and runs in the background.
   */
  setup(definitions: WorkflowDefinition[], subscribe: SubscribeFn): void {
    const watchDefs = this.collectWatchDefs(definitions);
    if (watchDefs.length === 0) return;

    this.unsubscribe = subscribe((payload) => this.handleFileChanged(payload));
    for (const { key, definition, trigger } of watchDefs) {
      void this.startWatch(key, definition, trigger);
    }
  }

  /**
   * Update active watchers to match a new set of definitions.
   */
  reconcile(newDefinitions: WorkflowDefinition[], subscribe: SubscribeFn): void {
    const newKeys = new Set<string>();
    for (const { key } of this.collectWatchDefs(newDefinitions)) {
      newKeys.add(key);
    }

    for (const key of [...this.entries.keys()]) {
      if (!newKeys.has(key)) this.stopWatch(key);
    }

    const hadEntries = this.entries.size > 0;
    for (const definition of newDefinitions) {
      if (!definition.enabled) continue;
      for (let i = 0; i < definition.triggers.length; i++) {
        const trigger = definition.triggers[i];
        if (!trigger.watch || trigger.watch.length === 0) continue;
        const key = `${definition.name}:${i}`;
        if (!this.entries.has(key)) {
          void this.startWatch(key, definition, trigger);
        }
      }
    }

    const hasEntries = this.entries.size > 0;
    if (!hadEntries && hasEntries && !this.unsubscribe) {
      this.unsubscribe = subscribe((payload) => this.handleFileChanged(payload));
    } else if (hasEntries === false) {
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  }

  clearAll(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const key of [...this.entries.keys()]) {
      this.stopWatch(key);
    }
    this.watcher.closeAll();
  }

  private collectWatchDefs(
    definitions: WorkflowDefinition[],
  ): { key: string; definition: WorkflowDefinition; trigger: WorkflowTrigger }[] {
    const result: { key: string; definition: WorkflowDefinition; trigger: WorkflowTrigger }[] = [];
    for (const definition of definitions) {
      if (!definition.enabled) continue;
      for (let i = 0; i < definition.triggers.length; i++) {
        const trigger = definition.triggers[i];
        if (!trigger.watch || trigger.watch.length === 0) continue;
        result.push({ key: `${definition.name}:${i}`, definition, trigger });
      }
    }
    return result;
  }

  private async startWatch(
    key: string,
    definition: WorkflowDefinition,
    trigger: WorkflowTrigger,
  ): Promise<void> {
    const entry: WatchEntry = {
      watcherId: null,
      timer: null,
      pendingFiles: new Set(),
      definition,
      trigger,
    };
    // Register the entry immediately so reconcile knows it's handled.
    this.entries.set(key, entry);
    try {
      const watcherId = await this.watcher.start(this.projectDir, { recursive: true });
      if (!this.entries.has(key)) {
        // Entry was removed while we were starting; clean up.
        this.watcher.stop(watcherId);
        return;
      }
      entry.watcherId = watcherId;
    } catch {
      this.entries.delete(key);
    }
  }

  private stopWatch(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.watcherId !== null) this.watcher.stop(entry.watcherId);
    this.entries.delete(key);
  }

  private handleFileChanged(payload: FileChangedPayload): void {
    if (this.isStopping()) return;
    for (const entry of this.entries.values()) {
      if (entry.watcherId !== payload.watchId) continue;
      const patterns = entry.trigger.watch!;
      const matched = payload.changes.filter((c) =>
        patterns.some((p) => matchesGlob(c.path, p)),
      );
      if (matched.length === 0) continue;
      for (const c of matched) entry.pendingFiles.add(c.path);
      this.scheduleDebounced(entry);
    }
  }

  private scheduleDebounced(entry: WatchEntry): void {
    if (entry.timer) clearTimeout(entry.timer);
    const debounceMs = entry.trigger.debounceMs ?? 500;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (this.isStopping()) return;
      const files = [...entry.pendingFiles];
      entry.pendingFiles.clear();
      this.enqueueRun(entry.definition, entry.trigger, {
        event: "files.changed",
        payload: { files, triggeredAt: new Date().toISOString() },
      });
      this.maybeStartNext();
    }, debounceMs);
  }
}
