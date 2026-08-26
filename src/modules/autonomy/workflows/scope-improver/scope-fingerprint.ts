import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { ResolvedScopePolicy } from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { readScopeImprovementConfigFromStateDir } from "./scope-improvement-state.js";
import {
  SCOPE_IMPROVEMENT_CONFIG_FILE,
  SCOPE_IMPROVEMENT_CONFIG_PATH,
} from "./scope-improvement-types.js";

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".kota",
  ".worktrees",
  "node_modules",
  "data",
  "dist",
  "build",
]);

function listGuidanceFiles(workspaceRoot: string, directory = workspaceRoot): string[] {
  const files: string[] = [];
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      files.push(...listGuidanceFiles(workspaceRoot, path));
      continue;
    }
    if (entry.isFile() && (entry.name === "AGENTS.md" || entry.name === "CLAUDE.md")) {
      files.push(relative(workspaceRoot, path));
    }
  }
  return files;
}

export type ScopeContentFingerprint = {
  fingerprint: string;
  refs: string[];
};

const SCOPE_POLICY_REF_PREFIX = "scope-policy:";

export function scopePolicyEvidenceRef(scopeId: string): string {
  return `${SCOPE_POLICY_REF_PREFIX}${scopeId}`;
}

export function isScopePolicyEvidenceRef(ref: string): boolean {
  return ref.startsWith(SCOPE_POLICY_REF_PREFIX);
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function scopePolicyMaterial(policy: ResolvedScopePolicy) {
  return {
    scopeId: policy.scopeId,
    lineage: [...policy.lineage],
    autonomy: {
      defaultMode: policy.autonomy.defaultMode,
      maxMode: policy.autonomy.maxMode,
    },
    writes: policy.writes.mode === "paths"
      ? { mode: policy.writes.mode, paths: sorted(policy.writes.paths) }
      : { mode: policy.writes.mode },
    channels: {
      mode: policy.channels.mode,
      allowedChannels: sorted(policy.channels.allowedChannels),
      blockedSources: sorted(policy.channels.blockedSources),
      ignoredSources: sorted(policy.channels.ignoredSources),
    },
    setup: { visibility: policy.setup.visibility },
    ownerConfirmation: {
      localWrite: policy.ownerConfirmation.localWrite,
      externalWrite: policy.ownerConfirmation.externalWrite,
      destructive: policy.ownerConfirmation.destructive,
    },
    retention: policy.retention.mode === "retain"
      ? {
          mode: policy.retention.mode,
          redaction: policy.retention.redaction,
        }
      : {
          mode: policy.retention.mode,
          maxAgeDays: policy.retention.maxAgeDays,
          redaction: policy.retention.redaction,
        },
    modules: {
      defaultAvailability: policy.modules.defaultAvailability,
      overrides: [...policy.modules.overrides]
        .sort((a, b) => a.moduleName.localeCompare(b.moduleName))
        .map((entry) => ({
          moduleName: entry.moduleName,
          availability: entry.availability,
        })),
    },
    externalEffects: {
      networkRead: policy.externalEffects.networkRead,
      networkWrite: policy.externalEffects.networkWrite,
      networkDestructive: policy.externalEffects.networkDestructive,
    },
  };
}

/**
 * Fingerprint only durable scope guidance and policy inputs. Product/source
 * commits are deliberately excluded so successful builder traffic cannot
 * become an implicit scope-review trigger.
 */
export function computeScopeContentFingerprint(
  workspaceRoot: string,
  scopePolicy: ResolvedScopePolicy,
  stateDir?: string,
  scopeRoot: string = workspaceRoot,
): ScopeContentFingerprint {
  const canonicalStateDir = stateDir ?? join(workspaceRoot, ".kota");
  const scopeId = deriveDirectoryScopeId(scopeRoot);
  if (scopePolicy.scopeId !== scopeId) {
    throw new Error(
      `resolved scope policy ${scopePolicy.scopeId} does not belong to ${scopeId}`,
    );
  }
  const guidanceRefs = listGuidanceFiles(workspaceRoot)
    .sort((a, b) => a.localeCompare(b));
  const refs = [
    ...guidanceRefs,
    ...(existsSync(join(canonicalStateDir, SCOPE_IMPROVEMENT_CONFIG_FILE))
      ? [SCOPE_IMPROVEMENT_CONFIG_PATH]
      : []),
    scopePolicyEvidenceRef(scopePolicy.scopeId),
  ].sort((a, b) => a.localeCompare(b));
  const hash = createHash("sha256");
  for (const path of guidanceRefs) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(join(workspaceRoot, path)));
    hash.update("\0");
  }
  hash.update("scope-improvement-config\0");
  hash.update(JSON.stringify(readScopeImprovementConfigFromStateDir(canonicalStateDir)));
  hash.update("\0resolved-scope-policy\0");
  hash.update(JSON.stringify(scopePolicyMaterial(scopePolicy)));
  hash.update("\0");
  return {
    fingerprint: `scope-content:${hash.digest("hex")}`,
    refs,
  };
}
