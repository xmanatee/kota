import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { lstatSync, realpathSync, type Stats } from "node:fs";
import { resolve } from "node:path";
import { SCOPE_ONBOARDING_RUNTIME_DIRECTORY_HELPER_SOURCE } from "./scope-onboarding-runtime-directory-helper-source.js";
import type {
  ScopeOnboardingFileIdentity,
  ScopeOnboardingRuntimeDirectory,
} from "./scope-onboarding-types.js";

const HELPER_MAX_BUFFER = 1024 * 1024;

export type RuntimeDirectoryMutation = {
  operation: "ensure";
  scopeRootPath: string;
  scopeRootIdentity: ScopeOnboardingFileIdentity;
  relativePath: ScopeOnboardingRuntimeDirectory;
  expectMissing: boolean;
};

export type RuntimeDirectoryMutationResult = {
  outcome: "created" | "existing" | "unexpected-existing" | "conflict";
};

type HelperResponse =
  | { ok: true; results: RuntimeDirectoryMutationResult[] }
  | { ok: false; reason: string };

function identity(stats: Stats): ScopeOnboardingFileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function sameIdentity(
  left: ScopeOnboardingFileIdentity,
  right: ScopeOnboardingFileIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export function captureScopeOnboardingRootIdentity(
  directoryRoot: string,
): ScopeOnboardingFileIdentity {
  assertAtomicRuntimeDirectorySupport();
  const logicalRoot = resolve(directoryRoot);
  const logicalStats = lstatSync(logicalRoot);
  if (logicalStats.isSymbolicLink() || !logicalStats.isDirectory()) {
    throw new Error("Scope root must be a real directory");
  }
  const canonicalRoot = realpathSync.native(logicalRoot);
  const canonicalStats = lstatSync(canonicalRoot);
  if (
    canonicalRoot !== logicalRoot ||
    !canonicalStats.isDirectory() ||
    !sameIdentity(identity(logicalStats), identity(canonicalStats))
  ) {
    throw new Error("Scope root identity changed during canonicalization");
  }
  return identity(canonicalStats);
}

export function mutateAnchoredScopeRuntimeDirectories(
  mutations: readonly RuntimeDirectoryMutation[],
): RuntimeDirectoryMutationResult[] {
  if (mutations.length === 0) return [];
  assertAtomicRuntimeDirectorySupport();
  const first = mutations[0]!;
  if (
    mutations.some(
      (mutation) =>
        mutation.scopeRootPath !== first.scopeRootPath ||
        !sameIdentity(mutation.scopeRootIdentity, first.scopeRootIdentity),
    )
  ) {
    throw new Error("Runtime-directory mutations must share one scope root");
  }
  const result: SpawnSyncReturns<string> = spawnSync(
    "/usr/bin/ruby",
    [
      "--disable-gems",
      "-e",
      SCOPE_ONBOARDING_RUNTIME_DIRECTORY_HELPER_SOURCE,
    ],
    {
      encoding: "utf8",
      env: {},
      input: JSON.stringify({
        operation: first.operation,
        scopeRootPath: first.scopeRootPath,
        scopeRootIdentity: first.scopeRootIdentity,
        mutations,
      }),
      maxBuffer: HELPER_MAX_BUFFER,
      windowsHide: true,
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error("Isolated runtime-directory filesystem helper failed");
  }
  let response: HelperResponse;
  try {
    response = JSON.parse(result.stdout) as HelperResponse;
  } catch {
    throw new Error("Isolated runtime-directory filesystem helper returned invalid data");
  }
  if (!response.ok) throw new Error(response.reason);
  if (response.results.length !== mutations.length) {
    throw new Error("Isolated runtime-directory filesystem helper omitted mutation results");
  }
  return response.results;
}

function assertAtomicRuntimeDirectorySupport(): void {
  if (process.platform !== "darwin") {
    throw new Error(
      "Runtime-directory mutations require atomic no-follow beneath-root rename support",
    );
  }
}
