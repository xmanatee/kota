import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  SCOPE_IMPROVEMENT_CONFIG_PATH,
  SCOPE_IMPROVEMENT_DEFAULT_MAX_ACTIONS_PER_RUN,
  SCOPE_IMPROVEMENT_DEFAULT_MIN_MINUTES_BETWEEN_RUNS,
  SCOPE_IMPROVEMENT_MAX_SIGNATURES,
  SCOPE_IMPROVEMENT_STATE_PATH,
  type ScopeImprovementAppliedAction,
  type ScopeImprovementConfig,
  type ScopeImprovementInputs,
  type ScopeImprovementState,
} from "./scope-improvement-types.js";

type ConfigFile = Partial<ScopeImprovementConfig>;
type StateFile = Partial<ScopeImprovementState>;

function defaultConfig(): ScopeImprovementConfig {
  return {
    enabled: true,
    minMinutesBetweenRuns: SCOPE_IMPROVEMENT_DEFAULT_MIN_MINUTES_BETWEEN_RUNS,
    maxActionsPerRun: SCOPE_IMPROVEMENT_DEFAULT_MAX_ACTIONS_PER_RUN,
    allowAutonomousEdits: false,
    writePaths: [],
  };
}

export function readScopeImprovementConfig(projectDir: string): ScopeImprovementConfig {
  const raw = readOptionalJsonFile<ConfigFile>(
    join(projectDir, SCOPE_IMPROVEMENT_CONFIG_PATH),
  );
  const base = defaultConfig();
  if (!raw) return base;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    minMinutesBetweenRuns:
      typeof raw.minMinutesBetweenRuns === "number" && raw.minMinutesBetweenRuns >= 0
        ? Math.floor(raw.minMinutesBetweenRuns)
        : base.minMinutesBetweenRuns,
    maxActionsPerRun:
      typeof raw.maxActionsPerRun === "number" && raw.maxActionsPerRun > 0
        ? Math.floor(raw.maxActionsPerRun)
        : base.maxActionsPerRun,
    allowAutonomousEdits:
      typeof raw.allowAutonomousEdits === "boolean"
        ? raw.allowAutonomousEdits
        : base.allowAutonomousEdits,
    writePaths:
      Array.isArray(raw.writePaths) &&
      raw.writePaths.every((entry) => typeof entry === "string")
        ? raw.writePaths
        : base.writePaths,
  };
}

export function readScopeImprovementState(
  projectDir: string,
  scopeId: string,
): ScopeImprovementState {
  const raw = readOptionalJsonFile<StateFile>(
    join(projectDir, SCOPE_IMPROVEMENT_STATE_PATH),
  );
  if (!raw) return { scopeId, lastRunAt: null, recentSignatures: [] };
  return {
    scopeId: typeof raw.scopeId === "string" ? raw.scopeId : scopeId,
    lastRunAt: typeof raw.lastRunAt === "string" ? raw.lastRunAt : null,
    recentSignatures: Array.isArray(raw.recentSignatures)
      ? raw.recentSignatures.filter(
          (entry): entry is ScopeImprovementState["recentSignatures"][number] =>
            typeof entry.signature === "string" &&
            typeof entry.action === "string" &&
            typeof entry.lastSeenAt === "string",
        )
      : [],
  };
}

export function stageBestEffort(projectDir: string, path: string): void {
  try {
    execFileSync("git", ["add", path], {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: "ignore",
    });
  } catch {
    // The terminal commit step stages the final tracked diff.
  }
}

export function isScopeImprovementWriteAllowed(
  config: ScopeImprovementConfig,
  targetPath: string,
): boolean {
  if (!config.allowAutonomousEdits) return false;
  return config.writePaths.some((allowed) => {
    const prefix = allowed.replace(/\/$/, "");
    return targetPath === allowed || targetPath.startsWith(`${prefix}/`);
  });
}

export function writeScopeImprovementState(args: {
  projectDir: string;
  inputs: ScopeImprovementInputs;
  actions: readonly ScopeImprovementAppliedAction[];
}): void {
  const now = args.inputs.generatedAt;
  const recorded = args.actions
    .filter((action) => action.kind !== "skipped")
    .map((action) => ({
      signature: action.signature,
      action: action.kind,
      lastSeenAt: now,
    }));
  const recentSignatures = [
    ...recorded,
    ...args.inputs.state.recentSignatures.filter(
      (entry) => !recorded.some((item) => item.signature === entry.signature),
    ),
  ].slice(0, SCOPE_IMPROVEMENT_MAX_SIGNATURES);
  writeJsonFileAtomic(join(args.projectDir, SCOPE_IMPROVEMENT_STATE_PATH), {
    scopeId: args.inputs.scope.scopeId,
    lastRunAt: now,
    recentSignatures,
  } satisfies ScopeImprovementState);
}
