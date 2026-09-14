// Used before package imports during installation recovery as well as normal config loading.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getGlobalConfigPath } from "#core/config/config-paths.js";
import type { CoreKotaConfig } from "./config-types.js";

type Preparation = NonNullable<NonNullable<CoreKotaConfig["workflow"]>["preparation"]>;
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function decodePreparation(value: unknown): Preparation {
  if (!isPlainObject(value)) throw new Error("workflow.preparation must be an object");
  for (const field of ["checkCommand", "command", "inputs", "outputs"] as const) {
    const parts = value[field];
    if (!Array.isArray(parts) || parts.length === 0 || parts.some((part) => typeof part !== "string" || part.trim() === "")) {
      throw new Error(`workflow.preparation.${field} must be a non-empty string array`);
    }
  }
  const outputs = value.outputs as [string, ...string[]];
  const inputs = value.inputs as [string, ...string[]];
  if (inputs.some((path) => path.split("/").some((part) => !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part)))) {
    throw new Error("workflow.preparation.inputs must name repository-relative files");
  }
  if (outputs.some((path) => !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(path)) || new Set(outputs).size !== outputs.length) {
    throw new Error("workflow.preparation.outputs must name unique top-level output directories");
  }
  if (value.allowedEgressHosts !== undefined && (!Array.isArray(value.allowedEgressHosts) || value.allowedEgressHosts.some((host) => typeof host !== "string" || host.trim() === ""))) {
    throw new Error("workflow.preparation.allowedEgressHosts must be a string array");
  }
  return {
    command: value.command as [string, ...string[]],
    checkCommand: value.checkCommand as [string, ...string[]],
    outputs,
    inputs,
    ...(value.allowedEgressHosts === undefined ? {} : { allowedEgressHosts: value.allowedEgressHosts as string[] }),
  };
}

/** The executing installation is the self scope, trusted by the config owner.
 * No selected project, journal field, or CLI argument may supply these paths.
 * Preparation replaces the global preparation object as in normal workflow merging.
 */
export function loadInstallationPreparation(installation: string): Preparation | undefined {
  let preparation: Preparation | undefined;
  for (const path of [getGlobalConfigPath(), join(installation, ".kota", "config.json")]) {
    if (!existsSync(path)) continue;
    if (lstatSync(path).isSymbolicLink()) throw new Error("Unsafe dependency recovery configuration");
    const config: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isPlainObject(config)) throw new Error("Malformed dependency recovery configuration");
    if (isPlainObject(config.workflow) && config.workflow.preparation !== undefined) {
      preparation = decodePreparation(config.workflow.preparation);
    }
  }
  return preparation;
}
