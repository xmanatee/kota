/**
 * Jira module — TaskProvider backed by Jira Cloud Issues.
 *
 * When `modules.jira.taskProvider.enabled` is true, this module registers
 * a JiraTaskProvider so KOTA's builder can pull tasks directly from a Jira
 * Cloud project without maintaining a parallel file queue.
 *
 * Config (under modules.jira):
 *   apiToken:      Jira API token or "$ENV_VAR" reference. Required.
 *   userEmail:     Jira account email or "$ENV_VAR" reference. Required.
 *   baseUrl:       Jira Cloud base URL (e.g. "https://myorg.atlassian.net") or "$ENV_VAR". Required.
 *   taskProvider:
 *     enabled:              Must be true to activate. Default: false.
 *     projectKey:           Jira project key (e.g. "ENG"). Required.
 *     jqlFilter:            Extra JQL appended to the base query. Default: none.
 *     inProgressTransition: Transition name for "in progress". Default: "In Progress".
 *     doneTransition:       Transition name for "done". Default: "Done".
 *     claimOnStart:         Assign to authenticated user on claim. Default: true.
 *
 * Uses Jira REST API v3 with basic auth; no npm dependencies.
 * Credentials are never logged.
 */

import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import { TASK_PROVIDER_TOKEN } from "#core/modules/provider-registry.js";
import type { JiraTaskProviderConfig } from "./task-provider.js";
import { JiraTaskProvider } from "./task-provider.js";

// ─── Config ──────────────────────────────────────────────────────────────────

type JiraConfig = {
  /** Jira API token or "$ENV_VAR" reference. Required. */
  apiToken: string;
  /** Jira account email or "$ENV_VAR" reference. Required. */
  userEmail: string;
  /** Jira Cloud base URL (e.g. "https://myorg.atlassian.net") or "$ENV_VAR". Required. */
  baseUrl: string;
  /** Optional Jira Issues task provider configuration. */
  taskProvider?: JiraTaskProviderConfig;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveSecret(raw: string): string {
  if (raw.startsWith("$")) {
    return process.env[raw.slice(1)] ?? "";
  }
  return raw;
}

function makeJiraFetch(
  baseUrl: string,
  apiToken: string,
  userEmail: string,
): (path: string, options?: { method?: string; body?: unknown }) => Promise<unknown> {
  const credentials = Buffer.from(`${userEmail}:${apiToken}`).toString("base64");
  return async (path, options = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text().catch(() => "");
      throw new Error(`Jira API ${options.method ?? "GET"} ${path} failed (${res.status}): ${text}`);
    }
    if (res.status === 204 || res.headers.get("content-length") === "0") return {};
    return res.json() as Promise<unknown>;
  };
}

// ─── Module ──────────────────────────────────────────────────────────────────

const jiraModule: KotaModule = {
  name: "jira",
  tools: [],

  async onLoad(ctx: ModuleRuntimeContext): Promise<void> {
    const config = ctx.getModuleConfig<JiraConfig>();
    if (!config?.taskProvider?.enabled) return;

    const missing: string[] = [];
    if (!config.apiToken) missing.push("modules.jira.apiToken");
    if (!config.userEmail) missing.push("modules.jira.userEmail");
    if (!config.baseUrl) missing.push("modules.jira.baseUrl");

    if (missing.length > 0) {
      ctx.log.warn(
        `Jira task provider: ${missing.join(", ")} required but missing — provider inactive`,
      );
      return;
    }

    const apiToken = resolveSecret(config.apiToken);
    const userEmail = resolveSecret(config.userEmail);
    const baseUrl = resolveSecret(config.baseUrl).replace(/\/$/, "");

    if (!apiToken || !userEmail || !baseUrl) {
      ctx.log.warn("Jira task provider: one or more credentials env vars are not set — provider inactive");
      return;
    }

    if (!config.taskProvider.projectKey) {
      ctx.log.warn(
        "Jira task provider: modules.jira.taskProvider.projectKey is required — provider inactive",
      );
      return;
    }

    const jiraFetch = makeJiraFetch(baseUrl, apiToken, userEmail);
    const provider = new JiraTaskProvider(config.taskProvider, jiraFetch);
    try {
      await provider.init();
      ctx.registerProvider(TASK_PROVIDER_TOKEN, provider);
      ctx.log.info("Jira Cloud task provider registered");
    } catch (err) {
      ctx.log.warn(
        `Jira task provider: init failed — ${(err as Error).message}`,
      );
    }
  },
};

export default jiraModule;
