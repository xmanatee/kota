import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-registry.js";
import type { ProjectId, ProjectRegistryProjection } from "./project-registry.js";

export type DaemonProjectScopeProvider = {
  getProjectRegistryProjection(): ProjectRegistryProjection;
  getActiveProjectId(): ProjectId | null;
};

export const DAEMON_PROJECT_SCOPE_PROVIDER_TYPE: ProviderToken<DaemonProjectScopeProvider> =
  defineProviderToken<DaemonProjectScopeProvider>("daemon-project-scope");
