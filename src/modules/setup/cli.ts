import { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  ModuleSetupCompleteInput,
  ModuleSetupFormValues,
  ModuleSetupJsonValue,
  ModuleSetupStatusResponse,
} from "#core/modules/setup-requirements.js";
import type {
  ModuleSetupMutationResult,
  ModuleSetupStartResult,
} from "./client.js";

type JsonObject = { [key: string]: ModuleSetupJsonValue };

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

async function readStdinText(label: string): Promise<string> {
  if (process.stdin.isTTY === true) {
    throw new Error(`${label} must be piped on stdin`);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  if (text.length === 0) throw new Error(`${label} is required on stdin`);
  return text;
}

async function parseSecretValuesFromStdin(): Promise<Record<string, string>> {
  const text = await readStdinText("Secret values JSON");
  const obj = parseJsonObject(text, "stdin secret values");
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Secret value for "${key}" must be a non-empty string`);
    }
    values[key] = value;
  }
  return values;
}

function redactSubmittedSecretValues(
  text: string,
  secretValues: Record<string, string> | undefined,
): string {
  if (!secretValues) return text;
  let redacted = text;
  const values = new Set<string>();
  for (const value of Object.values(secretValues)) {
    if (value.length === 0) continue;
    values.add(value);
    values.add(JSON.stringify(value).slice(1, -1));
  }
  const tokens = [...values]
    .filter((value) => value.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const value of tokens) {
    redacted = redacted.split(value).join("<redacted>");
  }
  return redacted;
}

function printResult(
  result: ModuleSetupMutationResult | ModuleSetupStartResult,
  json: boolean,
  secretValues?: Record<string, string>,
): void {
  if (json) {
    console.log(redactSubmittedSecretValues(JSON.stringify(result, null, 2), secretValues));
    return;
  }
  if (!result.ok) {
    console.error(redactSubmittedSecretValues(`Setup failed: ${result.message}`, secretValues));
    process.exit(1);
  }
  if ("action" in result) {
    console.log(
      redactSubmittedSecretValues(
        `${result.status.moduleName}/${result.status.requirementId}: ${result.status.state}`,
        secretValues,
      ),
    );
    console.log(redactSubmittedSecretValues(`Action: ${result.action.actionId}`, secretValues));
    console.log(redactSubmittedSecretValues(`URL: ${result.action.url}`, secretValues));
    return;
  }
  console.log(
    redactSubmittedSecretValues(
      `${result.status.moduleName}/${result.status.requirementId}: ${result.status.state}`,
      secretValues,
    ),
  );
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

export function buildSetupCommand(ctx: ModuleContext): Command {
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
    .option("--secret-values-stdin", "Read JSON object keyed by secret name from stdin")
    .option("--json", "Output JSON")
    .action(async (
      moduleName: string,
      requirementId: string,
      opts: { secretValuesStdin?: boolean; json?: boolean },
    ) => {
      const secretValues = await parseSecretValuesFromStdin();
      printResult(
        await ctx.client.setup.storeSecret(moduleName, requirementId, secretValues),
        opts.json === true,
        secretValues,
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
    .option("--secret-values-stdin", "Read JSON object keyed by secret name from stdin")
    .option("--json", "Output JSON")
    .action(async (
      actionId: string,
      opts: { configValues?: string; secretValuesStdin?: boolean; json?: boolean },
    ) => {
      const secretValues = opts.secretValuesStdin === true
        ? await parseSecretValuesFromStdin()
        : undefined;
      const input: ModuleSetupCompleteInput = {
        ...(opts.configValues !== undefined && { configValues: parseFormValues(opts.configValues) }),
        ...(secretValues !== undefined && { secretValues }),
      };
      printResult(await ctx.client.setup.complete(actionId, input), opts.json === true, secretValues);
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
