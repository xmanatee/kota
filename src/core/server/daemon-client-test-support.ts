import type {
  DaemonClientHandlers,
  KotaClient,
  LocalClientHandlers,
} from "#root/client/kota-client.generated.js";
import { KOTA_CLIENT_NAMESPACES } from "#root/client/kota-client.generated.js";

export type DeclaredKotaClientHandlers = {
  [K in keyof DaemonClientHandlers]?: Partial<DaemonClientHandlers[K]>;
};

function unavailableNamespace(namespace: string, declared: object = {}): object {
  return new Proxy(declared, {
    get: (target, property, receiver) => {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return async () => {
        throw new Error(
          `Test invoked undeclared KotaClient behavior: ${namespace}.${String(property)}`,
        );
      };
    },
  });
}

const ROUTINE_NAMESPACES = new Set<string>([
  "agents",
  "skills",
  "recall",
  "capture",
  "retract",
  "resourceDiscovery",
  "doctor",
  "audit",
  "webhook",
  "modules",
  "modulesAdmin",
  "inboundSignals",
  "answer",
]);

/**
 * Complete an aggregate daemon-handler map without copying every namespace's
 * implementation contract into a fixture. Tests override only the namespace
 * whose composition they exercise; routine namespaces are provided by generated
 * bindings over transport, and undeclared exception namespaces fail if invoked.
 */
export function completeDaemonClientHandlers(
  declared: DeclaredKotaClientHandlers = {},
): DaemonClientHandlers {
  const handlers: Record<string, unknown> = {};
  for (const namespace of KOTA_CLIENT_NAMESPACES) {
    if (declared[namespace] !== undefined) {
      handlers[namespace] = unavailableNamespace(namespace, declared[namespace] as object);
    } else if (!ROUTINE_NAMESPACES.has(namespace)) {
      handlers[namespace] = unavailableNamespace(namespace);
    }
  }
  return handlers as DaemonClientHandlers;
}

/**
 * Complete an aggregate local-handler map without copying every namespace's
 * implementation contract into a fixture.
 */
export function completeLocalClientHandlers(
  declared: DeclaredKotaClientHandlers = {},
): LocalClientHandlers {
  const handlers: Record<string, unknown> = {};
  for (const namespace of KOTA_CLIENT_NAMESPACES) {
    handlers[namespace] = unavailableNamespace(
      namespace,
      (declared[namespace] ?? {}) as object,
    );
  }
  return handlers as LocalClientHandlers;
}

/** Build a strict aggregate client only where aggregate composition is the subject. */
export function createKotaClientTestDouble(
  declared: DeclaredKotaClientHandlers = {},
  forScope?: (scopeId: string) => KotaClient,
): KotaClient {
  const handlers: Record<string, unknown> = {};
  for (const namespace of KOTA_CLIENT_NAMESPACES) {
    handlers[namespace] = unavailableNamespace(
      namespace,
      (declared[namespace] ?? {}) as object,
    );
  }
  let client: KotaClient | undefined;
  client = {
    forScope: forScope ?? (() => client!),
    ...(handlers as DaemonClientHandlers),
  };
  return client;
}
