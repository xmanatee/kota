import { isAbsolute, relative, resolve } from "node:path";
import type { AgentCanUseTool } from "#core/agent-harness/index.js";
import {
  findModuleManifestToolEffect,
  type ModuleManifestEffectLookup,
  simulationBlockReasonFromEffect,
} from "#core/modules/module-manifest.js";
import { executeTool, getToolEffect } from "#core/tools/index.js";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { WorkflowTrialBlockedSideEffect } from "../client.js";
import type { TrialResolvedToolEffect } from "./trial-internal-types.js";

type TrialToolInput = Parameters<WorkflowStepContext["runTool"]>[1];
type TrialToolScopeResult =
  | { ok: true; input: TrialToolInput }
  | { ok: false; message: string };
type TrialPathResult =
  | { ok: true; path: string }
  | { ok: false; message: string };

const TRIAL_SCOPED_LOCAL_TOOLS = new Set([
  "file_read",
  "file_write",
  "file_edit",
  "multi_edit",
  "find_replace",
  "glob",
  "grep",
  "file_watch",
  "files_overview",
  "repo_map",
  "view_image",
  "sqlite",
  "notebook",
]);

function pathIsWithinRoot(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function scopeTrialPath(
  trialProjectDir: string,
  rawPath: string,
  label: string,
): TrialPathResult {
  const scoped = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(trialProjectDir, rawPath);
  if (!pathIsWithinRoot(trialProjectDir, scoped)) {
    return {
      ok: false,
      message: `${label} resolves outside the isolated trial project: ${rawPath}`,
    };
  }
  return { ok: true, path: scoped };
}

function scopePathField(
  input: TrialToolInput,
  field: string,
  trialProjectDir: string,
  fallback?: string,
): TrialToolScopeResult {
  const raw = input[field] ?? fallback;
  if (raw === undefined || typeof raw !== "string") return { ok: true, input };
  const scoped = scopeTrialPath(trialProjectDir, raw, field);
  if (!scoped.ok) return { ok: false, message: scoped.message };
  return { ok: true, input: { ...input, [field]: scoped.path } };
}

function scopeMultiEditInput(
  input: TrialToolInput,
  trialProjectDir: string,
): TrialToolScopeResult {
  const edits = input.edits;
  if (!Array.isArray(edits)) return { ok: true, input };
  const scopedEdits = [];
  for (const edit of edits) {
    if (typeof edit !== "object" || edit === null || Array.isArray(edit)) {
      scopedEdits.push(edit);
      continue;
    }
    const path = "path" in edit ? edit.path : undefined;
    if (typeof path !== "string") {
      scopedEdits.push(edit);
      continue;
    }
    const scoped = scopeTrialPath(trialProjectDir, path, "edits[].path");
    if (!scoped.ok) return { ok: false, message: scoped.message };
    scopedEdits.push({ ...edit, path: scoped.path });
  }
  return { ok: true, input: { ...input, edits: scopedEdits } };
}

function scopeTrialToolInput(
  tool: string,
  input: TrialToolInput,
  trialProjectDir: string,
): TrialToolScopeResult {
  switch (tool) {
    case "file_read":
    case "file_write":
    case "file_edit":
    case "file_watch":
    case "view_image":
    case "notebook":
      return scopePathField(input, "path", trialProjectDir);
    case "multi_edit":
      return scopeMultiEditInput(input, trialProjectDir);
    case "find_replace":
      return scopePathField(input, "files", trialProjectDir);
    case "glob":
    case "grep":
    case "files_overview":
      return scopePathField(input, "path", trialProjectDir, ".");
    case "repo_map":
      return scopePathField(input, "directory", trialProjectDir, ".");
    case "sqlite":
      return scopePathField(input, "database", trialProjectDir);
    case "shell":
      return scopePathField(input, "cwd", trialProjectDir, ".");
    default:
      return { ok: true, input };
  }
}

function buildBlockedSideEffect(
  stepId: string,
  tool: string,
  reason: string,
  resolvedEffect: TrialResolvedToolEffect,
): WorkflowTrialBlockedSideEffect {
  return {
    stepId,
    tool,
    reason,
    effect: {
      kind: resolvedEffect.effect.kind,
      scope: resolvedEffect.effect.scope,
      openWorld: resolvedEffect.effect.openWorld,
    },
    ...(resolvedEffect.manifest ? { manifest: resolvedEffect.manifest } : {}),
  };
}

function resolvedManifestToolEffect(
  manifestEffect: ModuleManifestEffectLookup,
): TrialResolvedToolEffect {
  return {
    effect: manifestEffect.effect,
    manifest: {
      moduleName: manifestEffect.moduleName,
      effectId: manifestEffect.id,
      categories: manifestEffect.categories,
      capabilityIds: manifestEffect.capabilityIds,
    },
  };
}

function resolveTrialToolEffect(tool: string): TrialResolvedToolEffect | undefined {
  const manifestEffect = findModuleManifestToolEffect(tool);
  if (manifestEffect) return resolvedManifestToolEffect(manifestEffect);
  const effect = getToolEffect(tool);
  return effect ? { effect } : undefined;
}

export async function runTrialTool(
  args: {
    trialProjectDir: string;
    stepId: string;
    blockedExternalSideEffects: WorkflowTrialBlockedSideEffect[];
  },
  name: string,
  input: TrialToolInput,
): Promise<Awaited<ReturnType<WorkflowStepContext["runTool"]>>> {
  const resolvedEffect = resolveTrialToolEffect(name);
  if (resolvedEffect) {
    const reason = simulationBlockReasonFromEffect(name, resolvedEffect.effect, {
      canScopeLocalFs: TRIAL_SCOPED_LOCAL_TOOLS.has(name),
    });
    if (reason) {
      args.blockedExternalSideEffects.push(
        buildBlockedSideEffect(args.stepId, name, reason, resolvedEffect),
      );
      throw new Error(`Blocked in workflow trial mode: ${reason}`);
    }
  }
  const scoped = scopeTrialToolInput(name, input, args.trialProjectDir);
  if (!scoped.ok) {
    if (resolvedEffect && resolvedEffect.effect.kind !== "read") {
      args.blockedExternalSideEffects.push(
        buildBlockedSideEffect(args.stepId, name, scoped.message, resolvedEffect),
      );
    }
    throw new Error(`Blocked in workflow trial mode: ${scoped.message}`);
  }
  const result = await executeTool(name, scoped.input);
  if (result.is_error) throw new Error(result.content);
  return result;
}

export function createTrialAgentToolGuard(args: {
  trialProjectDir: string;
  stepId: string;
  blockedExternalSideEffects: WorkflowTrialBlockedSideEffect[];
}): AgentCanUseTool {
  return async (name, input) => {
    const resolvedEffect = resolveTrialToolEffect(name);
    if (resolvedEffect) {
      const reason = simulationBlockReasonFromEffect(name, resolvedEffect.effect, {
        canScopeLocalFs: TRIAL_SCOPED_LOCAL_TOOLS.has(name),
      });
      if (reason) {
        args.blockedExternalSideEffects.push(
          buildBlockedSideEffect(args.stepId, name, reason, resolvedEffect),
        );
        return {
          behavior: "deny",
          message: `Blocked in workflow trial mode: ${reason}`,
          decisionAttribution: "operator-deny",
        };
      }
    }
    const scoped = scopeTrialToolInput(name, input, args.trialProjectDir);
    if (!scoped.ok) {
      if (resolvedEffect && resolvedEffect.effect.kind !== "read") {
        args.blockedExternalSideEffects.push(
          buildBlockedSideEffect(args.stepId, name, scoped.message, resolvedEffect),
        );
      }
      return {
        behavior: "deny",
        message: `Blocked in workflow trial mode: ${scoped.message}`,
        decisionAttribution: "operator-deny",
      };
    }
    return { behavior: "allow", updatedInput: scoped.input };
  };
}
