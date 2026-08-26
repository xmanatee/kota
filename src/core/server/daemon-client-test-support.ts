import type {
  DaemonClientHandlers,
  KotaClient,
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

/**
 * Complete an aggregate daemon-handler map without copying every namespace's
 * implementation contract into a fixture. Tests override only the namespace
 * whose composition they exercise; accidental use of anything else fails.
 */
export function completeDaemonClientHandlers(
  declared: DeclaredKotaClientHandlers = {},
): DaemonClientHandlers {
  const handlers: Record<string, unknown> = {};
  for (const namespace of KOTA_CLIENT_NAMESPACES) {
    handlers[namespace] = unavailableNamespace(namespace, declared[namespace] ?? {});
  }
  return handlers as DaemonClientHandlers;
}

/** Build a strict aggregate client only where aggregate composition is the subject. */
export function createKotaClientTestDouble(
  declared: DeclaredKotaClientHandlers = {},
  forScope?: (scopeId: string) => KotaClient,
): KotaClient {
  const handlers = completeDaemonClientHandlers(declared);
  let client: KotaClient | undefined;
  client = {
    forScope: forScope ?? (() => client!),
    ...handlers,
  };
  return client;
}
