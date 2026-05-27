import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

export function isKotaOwnedInheritedEnv(key: string): boolean {
  return (
    key === "KOTA_SESSION_ID" ||
    key === "KOTA_TOOL_USE_ID" ||
    key.startsWith("OTEL_") ||
    key.startsWith("OTLP_")
  );
}

export function buildFilteredInheritedSubprocessEnv(
  inheritedEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(inheritedEnv)) {
    if (value === undefined || isKotaOwnedInheritedEnv(key)) continue;
    env[key] = value;
  }
  return withProtectedGitBareRepositoryEnv(env);
}

const REQUIRED_INHERITED_SUBPROCESS_ENV_KEYS = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "TMPDIR",
  "TMP",
  "TEMP",
] as const;

export function buildRequiredInheritedSubprocessEnv(
  inheritedEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of REQUIRED_INHERITED_SUBPROCESS_ENV_KEYS) {
    const value = inheritedEnv[key];
    if (value !== undefined) env[key] = value;
  }
  return withProtectedGitBareRepositoryEnv(env);
}
