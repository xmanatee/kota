import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

export type RuntimeActivation = {
  targetRevision: string;
  status: "draining" | "starting" | "active" | "failed";
  error: string | null;
};

export type DaemonRuntimeRevision = {
  root: string;
  mode: "source" | "built";
  loadedRevision: string | null;
  canonicalRevision: string | null;
  activation: RuntimeActivation | null;
};

const revision = z.string().regex(/^[0-9a-f]{40,64}$/);
export const daemonRuntimeRevisionSchema: z.ZodType<DaemonRuntimeRevision> = z.object({
  root: z.string().min(1),
  mode: z.enum(["source", "built"]),
  loadedRevision: revision.nullable(),
  canonicalRevision: revision.nullable(),
  activation: z.object({
    targetRevision: revision,
    status: z.enum(["draining", "starting", "active", "failed"]),
    error: z.string().nullable(),
  }).nullable(),
});

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

export function canonicalRuntimeRevision(root: string): string | null {
  if (!existsSync(resolve(root, ".git"))) return null;
  return git(root, ["rev-parse", "HEAD"]);
}

/** Match executable inputs, including shipped prompts, but not verification or guidance. */
export function affectsLoadedRuntime(path: string): boolean {
  if (["AGENTS.md", "CLAUDE.md", "README.md", "CHANGELOG.md"].some((name) => path.endsWith(`/${name}`))) return false;
  if (path.includes("/docs/")) return false;
  if (/\.(?:test|integration)\.[cm]?[jt]s$/.test(path)) return false;
  if (path.includes("/testing/") || path.includes("/reference-evidence/")) return false;
  return path.startsWith("src/") || path.startsWith("dist/") || path.startsWith("bin/")
    || ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"].includes(path);
}

export function runtimeRevisionContains(root: string, loaded: string | null, target: string): boolean {
  if (loaded === null) return false;
  if (loaded === target) return true;
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", target, loaded], {
    cwd: root, env: withProtectedGitBareRepositoryEnv(), encoding: "utf8",
  });
  if (ancestor.error) throw ancestor.error;
  if (ancestor.status === 0) return true;
  if (ancestor.status !== 1) throw new Error(ancestor.stderr);
  // A later docs-only commit may change HEAD without changing loaded code.
  return git(root, ["diff", "--name-only", "-z", loaded, target])
    .split("\0").filter(Boolean).every((path) => !affectsLoadedRuntime(path));
}

export function captureLoadedRuntime(): Omit<DaemonRuntimeRevision, "activation" | "canonicalRevision"> {
  const root = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));
  const mode = import.meta.url.endsWith(".ts") ? "source" : "built";
  const loadedRevision = mode === "source"
    ? canonicalRuntimeRevision(root)
    : revision.nullable().parse(JSON.parse(readFileSync(resolve(root, "dist/runtime-revision.json"), "utf8")));
  return { root, mode, loadedRevision };
}

// Capture once when this process imports its runtime, before module loading or daemon startup.
export const LOADED_RUNTIME = captureLoadedRuntime();
