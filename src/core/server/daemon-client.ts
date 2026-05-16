import type { DaemonControlAddress, DaemonLiveStatus, DaemonSseStreamEvent } from "#core/daemon/daemon-control.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import * as methods from "./daemon-control-methods.js";
import { type DaemonTransport, daemonTransportFromAddress } from "./daemon-transport.js";
import type { KotaClient } from "./kota-client.js";
import {
  type DaemonClientHandlers,
  KOTA_CLIENT_NAMESPACES,
  type KotaClientNamespace,
} from "./kota-client.js";
import { createProjectScopedKotaClient } from "./project-scoped-kota-client.js";

/**
 * The OS-managed daemon flag is filesystem-scoped (it checks for a
 * launchd plist or systemd unit on the operator host). The daemon
 * cannot answer that for the calling host, so the daemon-up branch
 * always reports `false`; the local handler is the one that probes
 * the operator filesystem. Exported because the daemon-ops module's
 * `daemonClient(link)` factory consumes the same stub when it composes
 * the `daemonOps.status()` arm.
 */
export async function daemonManagedHttp(): Promise<boolean> {
  return false;
}

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
  return merged as DaemonClientHandlers;
}

// ---------------------------------------------------------------------------
// DaemonControlClient — the daemon-online implementor of `KotaClient`.
// Namespace fields are populated from the assembled handlers map. The
// remaining non-namespace methods are server-internal transport primitives
// (session registration, SSE proxy, raw daemon-status proxy) with no
// CLI-facing equivalent; they delegate to standalone functions in
// `daemon-control-methods.ts`.
// ---------------------------------------------------------------------------

export class DaemonControlClient implements KotaClient {
  readonly workflow: KotaClient["workflow"];
  readonly approvals: KotaClient["approvals"];
  readonly secrets: KotaClient["secrets"];
  readonly tasks: KotaClient["tasks"];
  readonly memory: KotaClient["memory"];
  readonly ownerQuestions: KotaClient["ownerQuestions"];
  readonly history: KotaClient["history"];
  readonly knowledge: KotaClient["knowledge"];
  readonly sessions: KotaClient["sessions"];
  readonly modules: KotaClient["modules"];
  readonly agents: KotaClient["agents"];
  readonly skills: KotaClient["skills"];
  readonly harnessParity: KotaClient["harnessParity"];
  readonly webhook: KotaClient["webhook"];
  readonly voice: KotaClient["voice"];
  readonly web: KotaClient["web"];
  readonly mcpServer: KotaClient["mcpServer"];
  readonly audit: KotaClient["audit"];
  readonly config: KotaClient["config"];
  readonly modulesAdmin: KotaClient["modulesAdmin"];
  readonly daemonOps: KotaClient["daemonOps"];
  readonly projects: KotaClient["projects"];
  readonly doctor: KotaClient["doctor"];
  readonly evalHarness: KotaClient["evalHarness"];
  readonly recall: KotaClient["recall"];
  readonly answer: KotaClient["answer"];
  readonly capture: KotaClient["capture"];
  readonly retract: KotaClient["retract"];

  private readonly transport: DaemonTransport;
  private readonly baseUrl: string;

  private constructor(transport: DaemonTransport, handlers: DaemonClientHandlers) {
    this.transport = transport;
    this.baseUrl = transport.baseUrl;
    this.workflow = handlers.workflow;
    this.approvals = handlers.approvals;
    this.secrets = handlers.secrets;
    this.tasks = handlers.tasks;
    this.memory = handlers.memory;
    this.ownerQuestions = handlers.ownerQuestions;
    this.history = handlers.history;
    this.knowledge = handlers.knowledge;
    this.sessions = handlers.sessions;
    this.modules = handlers.modules;
    this.agents = handlers.agents;
    this.skills = handlers.skills;
    this.harnessParity = handlers.harnessParity;
    this.webhook = handlers.webhook;
    this.voice = handlers.voice;
    this.web = handlers.web;
    this.mcpServer = handlers.mcpServer;
    this.audit = handlers.audit;
    this.config = handlers.config;
    this.modulesAdmin = handlers.modulesAdmin;
    this.daemonOps = handlers.daemonOps;
    this.projects = handlers.projects;
    this.doctor = handlers.doctor;
    this.evalHarness = handlers.evalHarness;
    this.recall = handlers.recall;
    this.answer = handlers.answer;
    this.capture = handlers.capture;
    this.retract = handlers.retract;
  }

  forProject(projectId: string): KotaClient {
    return createProjectScopedKotaClient(this, projectId);
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
