import { getProviderRegistry } from "#core/modules/provider-registry.js";
import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-token.js";
import type {
  DurableEffectValue,
  RunStateValueSnapshot,
} from "./run-context.js";

/** Read-only projection of the daemon-owned durable run-state authority. */
export type RunStateReader = Readonly<{
  getScopeIdByRootPath(rootPath: string): string | null;
  readScopeStateValue<T extends DurableEffectValue>(
    scopeId: string,
    key: string,
  ): RunStateValueSnapshot<T>;
}>;

export const RUN_STATE_READER_PROVIDER_TYPE: ProviderToken<RunStateReader> =
  defineProviderToken<RunStateReader>("workflow-run-state-reader");

export function createRunStateReader(source: RunStateReader): RunStateReader {
  return Object.freeze({
    getScopeIdByRootPath: (rootPath: string) =>
      source.getScopeIdByRootPath(rootPath),
    readScopeStateValue: <T extends DurableEffectValue>(scopeId: string, key: string) =>
      source.readScopeStateValue<T>(scopeId, key),
  });
}

export function getRunStateReader(): RunStateReader | null {
  return getProviderRegistry()?.get(RUN_STATE_READER_PROVIDER_TYPE) ?? null;
}
