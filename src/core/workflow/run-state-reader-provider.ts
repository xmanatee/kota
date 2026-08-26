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
  getProjectIdByRootPath(rootPath: string): string | null;
  readProjectStateValue<T extends DurableEffectValue>(
    projectId: string,
    key: string,
  ): RunStateValueSnapshot<T>;
}>;

export const RUN_STATE_READER_PROVIDER_TYPE: ProviderToken<RunStateReader> =
  defineProviderToken<RunStateReader>("workflow-run-state-reader");

export function createRunStateReader(source: RunStateReader): RunStateReader {
  return Object.freeze({
    getProjectIdByRootPath: (rootPath: string) =>
      source.getProjectIdByRootPath(rootPath),
    readProjectStateValue: <T extends DurableEffectValue>(projectId: string, key: string) =>
      source.readProjectStateValue<T>(projectId, key),
  });
}

export function getRunStateReader(): RunStateReader | null {
  return getProviderRegistry()?.get(RUN_STATE_READER_PROVIDER_TYPE) ?? null;
}
