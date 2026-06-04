import { Command } from "commander";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import {
  type ModuleSetupCompleteInput,
  type ModuleSetupFormValues,
  type ModuleSetupJsonValue,
  type ModuleSetupRequirementContribution,
  ModuleSetupService,
  type ModuleSetupStatusResponse,
} from "#core/modules/setup-requirements.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  ModuleSetupMutationResult,
  ModuleSetupStartResult,
  SetupClient,
} from "./client.js";

type JsonObject = { [key: string]: ModuleSetupJsonValue };

function setupRequirementsFromSummaries(
  ctx: ModuleContext,
): ModuleSetupRequirementContribution[] {
  return ctx.getModuleSummaries().flatMap((summary) =>
    (summary.setupRequirements ?? []).map((requirement) => ({
      moduleName: summary.name,
      requirement,
    })),
  );
}

function buildLocalSetupClient(ctx: ModuleContext): SetupClient {
  const service = new ModuleSetupService({
    projectDir: ctx.cwd,
    getRequirements: () => setupRequirementsFromSummaries(ctx),
    probeCapabilities: async () => [],
  });
  return {
    list: () => service.list(),
    submitForm: (moduleName, requirementId, values) =>
      service.submitForm(moduleName, requirementId, values),
    storeSecret: (moduleName, requirementId, secretValues) =>
      service.storeSecret(moduleName, requirementId, secretValues),
    start: (moduleName, requirementId) => service.start(moduleName, requirementId),
    complete: (actionId, input) => service.complete(actionId, input),
    refresh: (moduleName, requirementId) => service.refresh(moduleName, requirementId),
    revoke: (moduleName, requirementId) => service.revoke(moduleName, requirementId),
  };
}

async function requestSetup<T>(
  link: DaemonTransport,
  method: string,
  path: string,
  body?: JsonObject,
): Promise<T> {
  const res = await link.fetchRaw(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await res.json()) as T;
}

function buildDaemonSetupClient(link: DaemonTransport): SetupClient {
  return {
    list: () =>
      link.requestStrict<ModuleSetupStatusResponse>("GET", "/setup/requirements"),
    submitForm: (moduleName, requirementId, values) =>
      requestSetup<ModuleSetupMutationResult>(
        link,
        "POST",
        `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}/form`,
        { values },
      ),
    storeSecret: (moduleName, requirementId, secretValues) =>
      requestSetup<ModuleSetupMutationResult>(
        link,
        "POST",
        `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}/secret`,
        { secretValues },
      ),
    start: (moduleName, requirementId) =>
      requestSetup<ModuleSetupStartResult>(
        link,
        "POST",
        `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}/start`,
      ),
    complete: (actionId, input) =>
      requestSetup<ModuleSetupMutationResult>(
        link,
        "POST",
        `/setup/actions/${encodeURIComponent(actionId)}/complete`,
        input as JsonObject,
      ),
    refresh: (moduleName, requirementId) =>
      requestSetup<ModuleSetupMutationResult>(
        link,
        "POST",
        `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}/refresh`,
      ),
    revoke: (moduleName, requirementId) =>
      requestSetup<ModuleSetupMutationResult>(
        link,
        "DELETE",
        `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}`,
      ),
  };
}

function parseJsonObject(text: string, label: string): JsonObject {
  const parsed = JSON.parse(text) as ModuleSetupJsonValue;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function parseFormValues(text: string): ModuleSetupFormValues {
  const obj = parseJsonObject(text, "--values");
  const values: ModuleSetupFormValues = {};
  for (const [key, value] of Object.entries(obj)) {
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new Error(`Value for "${key}" must be string, number, or boolean`);
    }
    values[key] = value;
  }
  return values;
}

function parseSecretValues(text: string): Record<string, string> {
  const obj = parseJsonObject(text, "--secret-values");
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Secret value for "${key}" must be a non-empty string`);
    }
    values[key] = value;
  }
  return values;
}

function printResult(result: ModuleSetupMutationResult | ModuleSetupStartResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.ok) {
    console.error(`Setup failed: ${result.message}`);
    process.exit(1);
  }
  if ("action" in result) {
    console.log(`${result.status.moduleName}/${result.status.requirementId}: ${result.status.state}`);
    console.log(`Action: ${result.action.actionId}`);
    console.log(`URL: ${result.action.url}`);
    return;
  }
  console.log(`${result.status.moduleName}/${result.status.requirementId}: ${result.status.state}`);
}

function printList(result: ModuleSetupStatusResponse, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.requirements.length === 0) {
    console.log("No setup requirements declared.");
    return;
  }
  for (const req of result.requirements) {
    console.log(`${req.moduleName}/${req.requirementId}  ${req.state}  ${req.title}`);
    console.log(`  ${req.message}`);
    if (req.secretRefs) {
      for (const ref of req.secretRefs) {
        console.log(`  secret ${ref.name}: ${ref.present ? "present" : "missing"}`);
      }
    }
    if (req.configFields) {
      for (const field of req.configFields) {
        console.log(`  config ${field.configPath}: ${field.present ? "present" : "missing"}`);
      }
    }
    if (req.pendingAction) {
      console.log(`  action ${req.pendingAction.actionId}: ${req.pendingAction.status}`);
    }
  }
}

function buildSetupCommand(ctx: ModuleContext): Command {
  const cmd = new Command("setup").description("Inspect and satisfy module setup requirements");

  cmd
    .command("list")
    .description("List setup requirement status")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      printList(await ctx.client.setup.list(), opts.json === true);
    });

  cmd
    .command("submit <module> <requirement>")
    .description("Submit non-sensitive form setup values")
    .requiredOption("--values <json>", "JSON object of form field values")
    .option("--json", "Output JSON")
    .action(async (moduleName: string, requirementId: string, opts: { values: string; json?: boolean }) => {
      printResult(
        await ctx.client.setup.submitForm(moduleName, requirementId, parseFormValues(opts.values)),
        opts.json === true,
      );
    });

  cmd
    .command("secret <module> <requirement>")
    .description("Store sensitive setup values through the secret path")
    .requiredOption("--secret-values <json>", "JSON object keyed by secret name")
    .option("--json", "Output JSON")
    .action(async (
      moduleName: string,
      requirementId: string,
      opts: { secretValues: string; json?: boolean },
    ) => {
      printResult(
        await ctx.client.setup.storeSecret(
          moduleName,
          requirementId,
          parseSecretValues(opts.secretValues),
        ),
        opts.json === true,
      );
    });

  cmd
    .command("start <module> <requirement>")
    .description("Start URL/OAuth setup")
    .option("--json", "Output JSON")
    .action(async (moduleName: string, requirementId: string, opts: { json?: boolean }) => {
      printResult(await ctx.client.setup.start(moduleName, requirementId), opts.json === true);
    });

  cmd
    .command("complete <action-id>")
    .description("Mark a URL/OAuth setup action complete")
    .option("--config-values <json>", "JSON object of non-sensitive values")
    .option("--secret-values <json>", "JSON object keyed by secret name")
    .option("--json", "Output JSON")
    .action(async (
      actionId: string,
      opts: { configValues?: string; secretValues?: string; json?: boolean },
    ) => {
      const input: ModuleSetupCompleteInput = {
        ...(opts.configValues !== undefined && { configValues: parseFormValues(opts.configValues) }),
        ...(opts.secretValues !== undefined && { secretValues: parseSecretValues(opts.secretValues) }),
      };
      printResult(await ctx.client.setup.complete(actionId, input), opts.json === true);
    });

  cmd
    .command("refresh <module> <requirement>")
    .description("Refresh setup health status")
    .option("--json", "Output JSON")
    .action(async (moduleName: string, requirementId: string, opts: { json?: boolean }) => {
      printResult(await ctx.client.setup.refresh(moduleName, requirementId), opts.json === true);
    });

  cmd
    .command("revoke <module> <requirement>")
    .description("Revoke or remove credentials for a requirement")
    .option("--json", "Output JSON")
    .action(async (moduleName: string, requirementId: string, opts: { json?: boolean }) => {
      printResult(await ctx.client.setup.revoke(moduleName, requirementId), opts.json === true);
    });

  return cmd;
}

const setupModule: KotaModule = {
  name: "setup",
  version: "1.0.0",
  description: "Module setup/auth requirement client namespace and CLI",
  commands: (ctx) => [buildSetupCommand(ctx)],
  localClient: (ctx) => ({ setup: buildLocalSetupClient(ctx) }),
  daemonClient: (link) => ({ setup: buildDaemonSetupClient(link) }),
};

export default setupModule;
