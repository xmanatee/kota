import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-registry.js";
import type { UnknownProjectError } from "./daemon-control-types.js";
import type { ProjectRuntime } from "./project-runtime.js";
import type { ProjectId, ProjectRegistryProjection } from "./scope-registry.js";

export type DaemonProjectRuntimeScope = Pick<
  ProjectRuntime,
  "project" | "approvalQueue" | "ownerQuestionQueue"
>;

export type DaemonProjectRuntimeResolution =
  | { ok: true; runtime: DaemonProjectRuntimeScope }
  | { ok: false; error: UnknownProjectError };

export type DaemonProjectScopeProvider = {
  getProjectRegistryProjection(): ProjectRegistryProjection;
  getActiveProjectId(): ProjectId | null;
  resolveProjectRuntime(
    projectId?: string | null,
  ): DaemonProjectRuntimeResolution;
};

export const DAEMON_PROJECT_SCOPE_PROVIDER_TYPE: ProviderToken<DaemonProjectScopeProvider> =
  defineProviderToken<DaemonProjectScopeProvider>("daemon-project-scope");
