import type { KotaConfig } from "#core/config/config.js";
import { loadConfig } from "#core/config/config.js";
import type { SessionGuardrailsReloadSummary } from "#core/events/event-bus-types.js";
import { loadModuleMetadata } from "#core/modules/module-metadata.js";
import {
  type GuardrailsConfig,
  getDefaultConfig as getDefaultGuardrails,
} from "#core/tools/guardrails.js";
import { computeModuleConfigDiff } from "./config-reload-diff.js";
import {
  buildDaemonConfigReloadFailureEvent,
  buildDaemonConfigReloadSuccessEvent,
} from "./daemon-config-reload-event.js";
import type { DaemonControlHandle, InteractiveSession } from "./daemon-control-types.js";
import type { DaemonHandleContext } from "./daemon-handle.js";

function resolveInteractiveGuardrailsConfig(config: KotaConfig): GuardrailsConfig {
  return config.guardrails ?? getDefaultGuardrails();
}

function buildSessionGuardrailsReloadSummary(
  daemonSummary: { refreshed: number; unchanged: number },
  sessions: Map<string, InteractiveSession>,
): SessionGuardrailsReloadSummary {
  return {
    refreshed: daemonSummary.refreshed,
    unchanged: daemonSummary.unchanged,
    nonRefreshable: [...sessions.values()]
      .filter((session) => session.source !== "daemon")
      .map((session) => ({
        id: session.id,
        source: "serve" as const,
        reason: "serve-owned-session" as const,
      })),
  };
}

export function buildDaemonConfigReloadHandle(
  ctx: DaemonHandleContext,
): Pick<DaemonControlHandle, "reloadConfig"> {
  const {
    bus,
    config,
    projectDir,
    projectRuntimes,
    refreshLiveSessionGuardrails,
    sessions,
    log,
  } = ctx;
  return {
    reloadConfig: async () => {
      const currentWorkflowCount = (): number => {
        let count = 0;
        for (const runtime of projectRuntimes.list()) {
          count = runtime.workflowRuntime.getDefinitionCount();
        }
        return count;
      };

      try {
        const oldConfig = config.config ?? {};
        const newConfig = loadConfig(projectDir);
        const loader = await loadModuleMetadata(
          newConfig,
          projectDir,
          config.verbose ?? false,
        );
        config.getModuleSummaries = () => loader.getModuleSummaries();
        const allModules = loader.getModuleSummaries().map((summary) => ({
          name: summary.name,
          dependencies: summary.dependencies,
        }));
        const { changedModules, isFullReload } = computeModuleConfigDiff(
          oldConfig,
          newConfig,
          allModules,
        );
        config.config = newConfig;
        const sessionGuardrails = buildSessionGuardrailsReloadSummary(
          refreshLiveSessionGuardrails(resolveInteractiveGuardrailsConfig(newConfig)),
          sessions,
        );
        const inputs = loader.getContributedWorkflows();
        let aggregateCount = 0;
        for (const runtime of projectRuntimes.list()) {
          runtime.workflowRuntime.setWorkflowInputs(inputs);
          aggregateCount = runtime.workflowRuntime.reloadWorkflowDefinitions().count;
        }
        bus.emit("daemon.config.reload", buildDaemonConfigReloadSuccessEvent({
          changedModules,
          isFullReload,
          workflowCount: aggregateCount,
          sessionGuardrails,
        }));
        log(`Config reloaded: ${aggregateCount} workflow definition(s) active`);
        if (isFullReload) {
          log(`  Full reload: all ${changedModules.length} module(s) restarted (global config changed)`);
        } else if (changedModules.length > 0) {
          log(`  Reloaded: ${changedModules.join(", ")}`);
          const skipped = allModules
            .filter((module) => !changedModules.includes(module.name))
            .map((module) => module.name);
          if (skipped.length > 0) log(`  Skipped: ${skipped.join(", ")}`);
        } else {
          log("  No module config changes detected");
        }
        if (
          sessionGuardrails.refreshed > 0
          || sessionGuardrails.unchanged > 0
          || sessionGuardrails.nonRefreshable.length > 0
        ) {
          log(
            `  Session guardrails: ${sessionGuardrails.refreshed} refreshed, `
              + `${sessionGuardrails.unchanged} unchanged, `
              + `${sessionGuardrails.nonRefreshable.length} not refreshable`,
          );
        }
        return { workflows: aggregateCount, changedModules, sessionGuardrails };
      } catch (error) {
        bus.emit("daemon.config.reload", buildDaemonConfigReloadFailureEvent({
          errorClass: error instanceof Error ? error.name : typeof error,
          workflowCount: currentWorkflowCount(),
        }));
        throw error;
      }
    },
  };
}
