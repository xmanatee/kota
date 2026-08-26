import type { DaemonControlAddress, DaemonLiveStatus, DaemonSseStreamEvent } from "#core/daemon/daemon-control.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";
import {
  type DaemonClientHandlers,
  KOTA_CLIENT_NAMESPACES,
  type KotaClientNamespace,
  KotaClientNamespaceHost,
} from "#root/client/kota-client.generated.js";
import * as methods from "./daemon-control-methods.js";
import { type DaemonTransport, daemonTransportFromAddress } from "./daemon-transport.js";
import { normalizeScopeSelectorClientHandlers } from "./scope-selector.js";
import { createScopedKotaClient } from "./scoped-kota-client.js";

// ---------------------------------------------------------------------------
// Core stub: empty after every namespace migrated to its owning module's
// `daemonClient(link)` factory. The function exists so the assembly path
// keeps a single, named integration point — module contributions overlay
// against this empty stub, and `assembleDaemonClientHandlers` validates
// full namespace coverage. If a future capability lands as a core-only
// namespace (no module ownership), it can be added back here.
// ---------------------------------------------------------------------------

/**
 * Build the core-side stub partial `DaemonClientHandlers` map. Every
 * namespace currently migrates through its owning module's
 * `daemonClient(link)` factory; the stub is empty. Missing handlers at
 * assembly time are a load-time error in `assembleDaemonClientHandlers`,
 * not a silent fallback.
 */
export function buildCoreStubDaemonClientHandlers(
  _transport: DaemonTransport,
): Partial<DaemonClientHandlers> {
  return {};
}

/**
 * Assemble a complete `DaemonClientHandlers` map by overlaying contributed
 * module handlers on top of the core stub. Validates full coverage and
 * throws loudly when a namespace lacks a handler — there is no silent
 * fallback. Symmetric to the validation `LocalKotaClient` performs for
 * `LocalClientHandlers`.
 */
export function assembleDaemonClientHandlers(
  transport: DaemonTransport,
  contributed?: Partial<DaemonClientHandlers>,
): DaemonClientHandlers {
  const stub = buildCoreStubDaemonClientHandlers(transport);
  const merged: Partial<DaemonClientHandlers> = { ...stub, ...(contributed ?? {}) };
  const missing: KotaClientNamespace[] = [];
  for (const name of KOTA_CLIENT_NAMESPACES) {
    if (!merged[name]) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `DaemonControlClient is missing daemon handler(s) for: ${missing.join(", ")}. ` +
        `Each KotaClient namespace must be exposed by the core stub or by its owning ` +
        `module's daemonClient(link) factory at module load time.`,
    );
  }
  return normalizeScopeSelectorClientHandlers(merged as DaemonClientHandlers);
}

// ---------------------------------------------------------------------------
// DaemonControlClient — the daemon-online implementor of `KotaClient`.
// Namespace fields are populated from the assembled handlers map. The
// remaining non-namespace methods are server-internal transport primitives
// (session registration, SSE proxy, raw daemon-status proxy) with no
// CLI-facing equivalent; they delegate to standalone functions in
// `daemon-control-methods.ts`.
// ---------------------------------------------------------------------------

export class DaemonControlClient extends KotaClientNamespaceHost {
  private readonly transport: DaemonTransport;
  private readonly baseUrl: string;

  private constructor(transport: DaemonTransport, handlers: DaemonClientHandlers) {
    super(handlers);
    this.transport = transport;
    this.baseUrl = transport.baseUrl;
  }

  forScope(scopeId: string): KotaClient {
    return createScopedKotaClient(this, scopeId);
  }

  /**
   * Build a `DaemonControlClient` from a daemon address. Optional
   * `contributedHandlers` come from modules' `daemonClient(link)`
   * factories; they override the same namespace in the core stub. The
   * selector is the production caller; tests pass an address directly
   * with no contributed handlers and get a fully-stubbed client.
   */
  static fromAddress(
    address: DaemonControlAddress,
    contributedHandlers?: Partial<DaemonClientHandlers>,
  ): DaemonControlClient {
    const transport = daemonTransportFromAddress(address);
    return DaemonControlClient.fromTransport(transport, contributedHandlers);
  }

  /** Build a `DaemonControlClient` from an already-resolved transport. */
  static fromTransport(
    transport: DaemonTransport,
    contributedHandlers?: Partial<DaemonClientHandlers>,
  ): DaemonControlClient {
    const handlers = assembleDaemonClientHandlers(transport, contributedHandlers);
    return new DaemonControlClient(transport, handlers);
  }

  /**
   * Build a `DaemonControlClient` from an address using a factory that
   * derives the contributed handlers from the live transport. The factory
   * is what the module loader provides — its closure captures the loaded
   * modules' `daemonClient(link)` factories, which need a transport to
   * realize their handler maps. Used by long-lived consumers (e.g.
   * `DaemonLink`) that rebuild the client when the daemon identity
   * changes.
   */
  static fromAddressWithFactory(
    address: DaemonControlAddress,
    assembleDaemonHandlers: (
      transport: DaemonTransport,
    ) => Partial<DaemonClientHandlers>,
  ): DaemonControlClient {
    const transport = daemonTransportFromAddress(address);
    return DaemonControlClient.fromTransport(transport, assembleDaemonHandlers(transport));
  }

  // -------------------------------------------------------------------------
  // Non-namespace methods. Server-internal transport primitives only.
  // The `kota serve` HTTP API holds a `DaemonControlClient` (not the raw
  // transport) and uses these to proxy daemon events/status and to register
  // its sessions with the running daemon's session list.
  // -------------------------------------------------------------------------

  getDaemonStatus(): Promise<DaemonLiveStatus | null> {
    return methods.getDaemonStatus(this.transport);
  }
  registerSession(id: string, createdAt: string, autonomyMode: AutonomyMode): Promise<boolean> {
    return methods.registerSession(this.transport, id, createdAt, autonomyMode);
  }
  unregisterSession(id: string): Promise<boolean> {
    return methods.unregisterSession(this.transport, id);
  }
  events(): AsyncGenerator<DaemonSseStreamEvent> {
    return methods.events(this.transport);
  }
}
