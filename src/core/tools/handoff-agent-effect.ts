import { findModuleManifestToolEffect } from "#core/modules/module-manifest.js";
import {
  localDestructiveEffect,
  localWriteEffect,
  networkDestructiveEffect,
  networkReadEffect,
  networkWriteEffect,
  type ToolEffect,
} from "./effect.js";
import {
  getRegisteredToolEffectMetadata,
  type ToolEffectResolver,
} from "./tool-effect-registry.js";

type HandoffToolInput = Parameters<ToolEffectResolver>[0];

const LOCAL_READ_ALIASES = new Set([
  "file_read",
  "glob",
  "grep",
  "read",
  "repo_map",
]);
const LOCAL_WRITE_ALIASES = new Set([
  "edit",
  "file_edit",
  "file_write",
  "find_replace",
  "multi_edit",
  "write",
]);
const NETWORK_READ_ALIASES = new Set([
  "web_fetch",
  "web_search",
  "webfetch",
  "websearch",
]);
const OPEN_EXECUTION_ALIASES = new Set([
  "bash",
  "code_exec",
  "delegate",
  "handoff_agent",
  "http_request",
  "process",
  "shell",
]);

function stringSet(value: HandoffToolInput[string]): Set<string> | null {
  if (!Array.isArray(value)) return null;
  if (value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    return null;
  }
  return new Set(value.map((entry) => entry.trim()));
}

function aliasEffect(name: string): ToolEffect | undefined {
  const normalized = name.toLowerCase();
  if (LOCAL_READ_ALIASES.has(normalized)) {
    return {
      kind: "read",
      scope: "local-fs",
      idempotent: true,
      openWorld: false,
    };
  }
  if (LOCAL_WRITE_ALIASES.has(normalized)) return localWriteEffect();
  if (NETWORK_READ_ALIASES.has(normalized)) return networkReadEffect();
  if (OPEN_EXECUTION_ALIASES.has(normalized)) return networkDestructiveEffect();
  return undefined;
}

function declaredCapabilityEffect(name: string): ToolEffect | undefined {
  // Opaque execution tools can escalate per invocation, but a handoff only
  // declares the tool name. Classify their whole capability envelope before
  // consulting the necessarily narrower static registration/manifest effect.
  const executionAlias = OPEN_EXECUTION_ALIASES.has(name.toLowerCase())
    ? aliasEffect(name)
    : undefined;
  if (executionAlias) return executionAlias;

  const registered = getRegisteredToolEffectMetadata(name);
  // Invocation resolvers have no declared upper-bound effect. A handoff only
  // knows the child capability name, not its future inputs, so classify that
  // unbounded envelope at the strongest representable posture.
  if (registered?.resolveEffect) return networkDestructiveEffect();

  return findModuleManifestToolEffect(name)?.effect
    ?? registered?.effect
    ?? aliasEffect(name);
}

/**
 * Conservatively classifies the entire child capability envelope. A handoff
 * can always mutate its workspace, so invocation resolution never lowers the
 * static local-write baseline. Unbounded or opaque capabilities resolve to an
 * external destructive effect instead of hiding behind that baseline.
 */
export function resolveHandoffAgentEffect(
  input: HandoffToolInput,
): ToolEffect {
  if (input.allowed_tools === undefined) return networkDestructiveEffect();
  const allowed = stringSet(input.allowed_tools);
  const disallowed = input.disallowed_tools === undefined
    ? new Set<string>()
    : stringSet(input.disallowed_tools);
  if (allowed === null || allowed.size === 0 || disallowed === null) {
    return networkDestructiveEffect();
  }

  const effects: ToolEffect[] = [localWriteEffect()];
  for (const name of allowed) {
    if (disallowed.has(name)) continue;
    const effect = declaredCapabilityEffect(name);
    if (effect === undefined) return networkDestructiveEffect();
    effects.push(effect);
  }

  const reachesExternalState = effects.some(
    (effect) => effect.scope === "external-network" || effect.scope === "process-env",
  );
  const canDestroy = effects.some((effect) => effect.kind === "destructive");
  if (reachesExternalState) {
    return canDestroy ? networkDestructiveEffect() : networkWriteEffect();
  }
  return canDestroy ? localDestructiveEffect() : localWriteEffect();
}
