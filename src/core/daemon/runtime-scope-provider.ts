import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-registry.js";
import type { ProjectRuntime } from "./project-runtime.js";
import type { ProjectId } from "./scope-registry.js";

export type DaemonRuntimeScope = Pick<
  ProjectRuntime,
  "project" | "deadLetterQueue" | "runStore" | "ownerQuestionQueue"
>;

export type DaemonRuntimeScopeResolution =
  | { ok: true; runtime: DaemonRuntimeScope }
  | { ok: false; projectId: string };

export type DaemonRuntimeScopeProvider = {
  resolve(projectId: ProjectId): DaemonRuntimeScopeResolution;
};

export const DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE: ProviderToken<DaemonRuntimeScopeProvider> =
  defineProviderToken<DaemonRuntimeScopeProvider>("daemon-runtime-scope");
