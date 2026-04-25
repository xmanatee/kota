/**
 * Module-level holder for the resolved active KotaClient.
 *
 * The CLI startup runs the selector once, picks either the daemon-side
 * or local-side implementor, and stores it here. CLI subcommand factories
 * read `ModuleContext.client`, which delegates to this holder. Storing
 * the resolved instance in module state — instead of threading it
 * through every API surface — keeps the integration with the existing
 * ModuleLoader/ModuleContext shape minimal.
 */
import type { KotaClient } from "./kota-client.js";

let activeClient: KotaClient | null = null;

export function setActiveKotaClient(client: KotaClient | null): void {
  activeClient = client;
}

export function getActiveKotaClient(): KotaClient {
  if (!activeClient) {
    throw new Error(
      "No active KotaClient resolved. CLI startup must call resolveKotaClient() " +
        "before any module command runs.",
    );
  }
  return activeClient;
}

export function hasActiveKotaClient(): boolean {
  return activeClient !== null;
}

export function resetActiveKotaClient(): void {
  activeClient = null;
}
