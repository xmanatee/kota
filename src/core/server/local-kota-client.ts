/**
 * LocalKotaClient — the daemon-offline implementor of `KotaClient`.
 *
 * The selector constructs this client when no daemon is reachable. Each
 * namespace's local handler is a typed sub-implementation contributed by
 * the owning module's top-level `localClient(ctx)` factory. The selector
 * validates that every declared namespace has a registered handler and
 * throws loudly otherwise — there is no silent fallback to a partially-
 * wired client.
 *
 * The client itself is a thin pass-through; any policy (filtering,
 * formatting, ordering) belongs in the namespace handler the module
 * supplies.
 */
import {
  KOTA_CLIENT_NAMESPACES,
  type KotaClient,
  type KotaClientNamespace,
  type LocalClientHandlers,
} from "./kota-client.js";

/** Validate `handlers` covers every declared namespace, then assemble. */
export function buildLocalKotaClient(
  handlers: Partial<LocalClientHandlers>,
): LocalKotaClient {
  const missing: KotaClientNamespace[] = [];
  for (const name of KOTA_CLIENT_NAMESPACES) {
    if (!handlers[name]) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `LocalKotaClient is missing local handler(s) for: ${missing.join(", ")}. ` +
        `Each KotaClient namespace must be exposed by its owning module's ` +
        `top-level localClient(ctx) factory at module load time.`,
    );
  }
  return new LocalKotaClient(handlers as LocalClientHandlers);
}

export class LocalKotaClient implements KotaClient {
  readonly workflow: KotaClient["workflow"];
  readonly approvals: KotaClient["approvals"];
  readonly secrets: KotaClient["secrets"];
  readonly tasks: KotaClient["tasks"];
  readonly memory: KotaClient["memory"];
  readonly ownerQuestions: KotaClient["ownerQuestions"];

  constructor(handlers: LocalClientHandlers) {
    this.workflow = handlers.workflow;
    this.approvals = handlers.approvals;
    this.secrets = handlers.secrets;
    this.tasks = handlers.tasks;
    this.memory = handlers.memory;
    this.ownerQuestions = handlers.ownerQuestions;
  }
}
