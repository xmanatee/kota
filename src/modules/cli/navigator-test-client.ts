import {
  createKotaClientTestDouble,
  type DeclaredKotaClientHandlers,
} from "#core/server/daemon-client-test-support.js";
import type { KotaClient } from "#root/client/kota-client.generated.js";

/** Strict navigator fixture: only explicitly declared client behavior is callable. */
export function emptyClient(
  declared: DeclaredKotaClientHandlers = {},
): KotaClient {
  return createKotaClientTestDouble(declared);
}
