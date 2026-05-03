import { type FSWatcher, watch } from "node:fs";
import { join } from "node:path";
import type { DaemonControlAddress } from "#core/daemon/daemon-control.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { DaemonControlClient } from "./daemon-client.js";
import type { DaemonTransport } from "./daemon-transport.js";
import type { DaemonClientHandlers } from "./kota-client.js";

export type DaemonLinkOptions = {
  stateDir: string;
  /**
   * Called whenever the link binds to a new daemon identity — either the
   * initial binding, or a subsequent bind after the previous daemon
   * restarted. The callback is responsible for re-synchronizing the
   * caller's advisory state (e.g. re-registering live sessions).
   */
  onReconnect: (client: DaemonControlClient) => void | Promise<void>;
  /**
   * Module-contributed daemon handler factory. Invoked with the live
   * transport when a new `DaemonControlClient` is built so module-owned
   * namespaces (e.g. `doctor`) are filled in alongside the core stub.
   * Required when the link runs inside a process that has loaded modules
   * contributing namespaces; tests for non-namespace methods can omit it
   * and rely on the core stub covering the remaining namespaces.
   */
  assembleDaemonHandlers?: (
    transport: DaemonTransport,
  ) => Partial<DaemonClientHandlers>;
  /**
   * Fallback polling interval for platforms where fs.watch misses
   * rename-based atomic writes. Default: 5s.
   */
  pollIntervalMs?: number;
};

/**
 * Tracks `.kota/daemon-control.json` and exposes the current
 * {@link DaemonControlClient}. When the daemon restarts, its `startedAt`
 * and `token` change; the link detects the identity change, rebuilds the
 * client, and fires `onReconnect` so the caller can converge advisory
 * state (e.g. re-register live serve sessions with the new daemon).
 *
 * The watcher observes the parent directory so it catches atomic rename
 * replacement of the control file. A fallback interval poll covers
 * platforms where fs.watch is unreliable.
 */
export class DaemonLink {
  private readonly stateDir: string;
  private readonly controlFile: string;
  private readonly onReconnect: DaemonLinkOptions["onReconnect"];
  private readonly assembleDaemonHandlers: DaemonLinkOptions["assembleDaemonHandlers"];
  private watcher: FSWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private client: DaemonControlClient | null = null;
  private lastStartedAt: string | null = null;
  private lastToken: string | null = null;
  private reconcileScheduled = false;
  private inflight: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(opts: DaemonLinkOptions) {
    this.stateDir = opts.stateDir;
    this.controlFile = "daemon-control.json";
    this.onReconnect = opts.onReconnect;
    this.assembleDaemonHandlers = opts.assembleDaemonHandlers;
    this.inflight = this.reconcile();
    try {
      this.watcher = watch(this.stateDir, (_type, filename) => {
        if (filename !== null && filename !== this.controlFile) return;
        this.scheduleReconcile();
      });
      this.watcher.on("error", () => {
        // Swallow errors; the poll timer still drives reconciliation.
      });
    } catch {
      // fs.watch can fail on some platforms or when the directory does not
      // yet exist; rely on polling until the directory is watchable.
    }
    const pollMs = opts.pollIntervalMs ?? 5_000;
    this.pollTimer = setInterval(() => this.scheduleReconcile(), pollMs);
    this.pollTimer.unref?.();
  }

  /** Current daemon client, or null when no daemon is reachable. */
  current(): DaemonControlClient | null {
    return this.client;
  }

  /**
   * Force an immediate reconciliation pass. Useful in tests where waiting
   * on the fallback poll interval would be wasteful.
   */
  async refresh(): Promise<void> {
    await this.inflight;
    this.inflight = this.reconcile();
    await this.inflight;
  }

  close(): void {
    this.closed = true;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private scheduleReconcile(): void {
    if (this.closed || this.reconcileScheduled) return;
    this.reconcileScheduled = true;
    setImmediate(() => {
      this.reconcileScheduled = false;
      this.inflight = this.inflight.then(() => this.reconcile());
    });
  }

  private async reconcile(): Promise<void> {
    if (this.closed) return;
    const address = readOptionalJsonFile<DaemonControlAddress>(
      join(this.stateDir, this.controlFile),
    );
    if (!address || typeof address.port !== "number") {
      this.client = null;
      this.lastStartedAt = null;
      this.lastToken = null;
      return;
    }
    const startedAt = typeof address.startedAt === "string" ? address.startedAt : null;
    const token = typeof address.token === "string" ? address.token : null;
    const sameIdentity =
      this.client !== null &&
      startedAt === this.lastStartedAt &&
      token === this.lastToken;
    if (sameIdentity) return;
    const client = this.assembleDaemonHandlers
      ? DaemonControlClient.fromAddressWithFactory(address, this.assembleDaemonHandlers)
      : DaemonControlClient.fromAddress(address);
    this.client = client;
    this.lastStartedAt = startedAt;
    this.lastToken = token;
    try {
      await this.onReconnect(client);
    } catch {
      // onReconnect failures are best-effort; the next reconcile will
      // retry once the underlying issue resolves (e.g. daemon accepting
      // connections).
    }
  }
}
