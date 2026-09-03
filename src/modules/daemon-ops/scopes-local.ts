/**
 * Local-side `scopes` namespace handler.
 *
 * The daemon owns the scope registry plus the operator-selected active
 * scope; both are runtime state held by a live daemon. With no daemon
 * reachable (the selector chose `LocalKotaClient`), there is no registry
 * to read and no selection to mutate, so both methods surface
 * `daemon_required`.
 */
import { ScopeOnboardingInspectionError } from "#core/daemon/scope-onboarding.js";
import { DAEMON_SCOPE_PROVIDER_TYPE } from "#core/daemon/scope-provider.js";
import { directoryScopesFromProjection } from "#core/daemon/scope-registry.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { ScopesClient } from "./client.js";

export function scopesLocalClient(ctx?: Pick<ModuleContext, "getProvider">): ScopesClient {
  const operator = () => ctx?.getProvider(DAEMON_SCOPE_PROVIDER_TYPE)?.operator;
  return {
    async list() {
      const service = ctx?.getProvider(DAEMON_SCOPE_PROVIDER_TYPE);
      if (!service) return { ok: false, reason: "daemon_required" };
      const projection = service.getScopeRegistryProjection();
      return {
        ok: true,
        scopes: directoryScopesFromProjection(projection),
        defaultScopeId: projection.defaultScopeId,
        activeScopeId: service.getActiveScopeId(),
      };
    },
    async use(scopeId) {
      const service = ctx?.getProvider(DAEMON_SCOPE_PROVIDER_TYPE);
      return service?.setActiveScopeId
        ? service.setActiveScopeId(scopeId)
        : { ok: false, reason: "daemon_required" };
    },
    async inspectAuthority() {
      return { ok: false, reason: "daemon_required" };
    },
    async validateAuthority() {
      return { ok: false, reason: "daemon_required" };
    },
    async applyAuthority() {
      return { ok: false, reason: "daemon_required" };
    },
    async inspectOnboarding(directoryRoot) {
      const service = operator();
      if (!service) return { ok: false, reason: "daemon_required" };
      try {
        return { ok: true, inspection: await service.inspectOnboarding(directoryRoot) };
      } catch (error) {
        if (error instanceof ScopeOnboardingInspectionError) {
          return { ok: false, reason: "invalid_directory", message: error.message };
        }
        throw error;
      }
    },
    async planOnboarding(directoryRoot, choices) {
      const service = operator();
      return service
        ? service.planOnboarding(directoryRoot, choices)
        : { ok: false, reason: "daemon_required" };
    },
    async applyOnboarding(plan, operatorAction) {
      const service = operator();
      return service
        ? service.applyOnboarding(plan, operatorAction)
        : { ok: false, reason: "daemon_required" };
    },
    async getOnboardingStatus(operationId) {
      const service = operator();
      if (!service) return { ok: false, reason: "daemon_required" };
      const operation = await service.getOnboardingStatus(operationId);
      return operation
        ? { ok: true, operation }
        : { ok: false, reason: "not_found", message: "Onboarding operation not found" };
    },
    async retryOnboarding(operationId, _scopeId, operatorAction) {
      const service = operator();
      return service
        ? service.retryOnboarding(operationId, operatorAction)
        : { ok: false, reason: "daemon_required" };
    },
    async cancelOnboarding(operationId) {
      const service = operator();
      return service
        ? service.cancelOnboarding(operationId)
        : { ok: false, reason: "daemon_required" };
    },
    async drain(scopeId) {
      const service = operator();
      return service
        ? service.drain(scopeId)
        : { ok: false, reason: "daemon_required" };
    },
    async remove(scopeId) {
      const service = operator();
      return service
        ? service.remove(scopeId)
        : { ok: false, reason: "daemon_required" };
    },
  };
}
