import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { ensureDir } from "#core/workflow/run-io.js";
import type { WorkflowTrialChangedFile } from "../client.js";
import type { FileSnapshot } from "./trial-internal-types.js";

export function safeTrialSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "attempt";
}

const DECLARATIVE_KOTA_PATHS = new Set([
  "config.json",
  "mcp.json",
  "modules",
  "prompts",
  "skills",
  "tools",
]);

function isDeclarativeKotaPath(parts: readonly string[]): boolean {
  return parts[0] !== ".kota"
    || parts.length === 1
    || DECLARATIVE_KOTA_PATHS.has(parts[1] ?? "");
}

function shouldCopyPath(sourceProjectDir: string, path: string): boolean {
  const rel = relative(sourceProjectDir, path);
  if (!rel) return true;
  const parts = rel.split("/");
  if (parts.includes(".git") || parts.includes("node_modules")) return false;
  if (parts[0] === "dist") return false;
  if (!isDeclarativeKotaPath(parts)) return false;
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`Workflow trial copy refuses symbolic link: ${rel}`);
  }
  return true;
}

export function copyProjectForTrial(sourceProjectDir: string, attemptId: string): string {
  const root = join(tmpdir(), `kota-workflow-trial-${safeTrialSegment(attemptId)}-${Date.now()}`);
  const trialProjectDir = join(root, basename(sourceProjectDir));
  try {
    cpSync(sourceProjectDir, trialProjectDir, {
      recursive: true,
      filter: (src) => shouldCopyPath(sourceProjectDir, src),
    });
    ensureDir(join(trialProjectDir, ".kota"));
    return trialProjectDir;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function gitOutput(cwd: string, args: readonly string[]): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: withProtectedGitBareRepositoryEnv(),
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}

export function assertIsolatedTrialProjectRoot(
	sourceProjectDir: string,
	trialProjectDir: string,
): void {
	try {
		const source = realpathSync(sourceProjectDir);
		const trial = realpathSync(trialProjectDir);
		const tempRoot = realpathSync(tmpdir());
		const relativeToTemp = relative(tempRoot, trial);
		const parent = resolve(trial, "..");
		const commonDirValue = gitOutput(trial, ["rev-parse", "--git-common-dir"]);
		const commonDir = realpathSync(
			isAbsolute(commonDirValue)
				? commonDirValue
				: resolve(trial, commonDirValue),
		);
		const valid =
			trial !== source &&
			relativeToTemp !== "" &&
			relativeToTemp !== ".." &&
			!relativeToTemp.startsWith(`..${sep}`) &&
			!isAbsolute(relativeToTemp) &&
			basename(parent).startsWith("kota-workflow-trial-") &&
			basename(trial) === basename(source) &&
			realpathSync(gitOutput(trial, ["rev-parse", "--show-toplevel"])) === trial &&
			commonDir === realpathSync(join(trial, ".git")) &&
			!existsSync(join(trial, ".kota", "daemon-control.json"));
		if (valid) return;
	} catch {
		// Collapse all missing or malformed structural facts into one authority error.
	}
	throw new Error(
		"Workflow isolated trial root proof failed; refusing to construct a standalone runtime host",
	);
}

function shouldSnapshotPath(rel: string): boolean {
  if (!rel) return true;
  const parts = rel.split("/");
  return !parts.includes(".git")
    && !parts.includes("node_modules")
    && parts[0] !== "dist"
    && isDeclarativeKotaPath(parts);
}

export function snapshotTrialFiles(root: string): FileSnapshot {
  const snapshot: FileSnapshot = new Map();
  if (!existsSync(root)) return snapshot;
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const rel = relative(root, path);
      if (!shouldSnapshotPath(rel)) continue;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new Error(`Workflow trial snapshot refuses symbolic link: ${rel}`);
      }
      if (stat.isDirectory()) {
        visit(path);
        continue;
      }
      if (!stat.isFile()) continue;
      const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
      snapshot.set(rel, digest);
    }
  };
  visit(root);
  return snapshot;
}

export function diffTrialSnapshots(
  before: FileSnapshot,
  after: FileSnapshot,
): WorkflowTrialChangedFile[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].sort().flatMap((path): WorkflowTrialChangedFile[] => {
    const beforeHash = before.get(path);
    const afterHash = after.get(path);
    if (beforeHash === undefined && afterHash !== undefined) {
      return [{ path, change: "created" }];
    }
    if (beforeHash !== undefined && afterHash === undefined) {
      return [{ path, change: "deleted" }];
    }
    if (beforeHash !== afterHash) return [{ path, change: "modified" }];
    return [];
  });
}

export function isTrialStoreMutation(file: WorkflowTrialChangedFile): boolean {
  return file.path.startsWith(".kota/") && !file.path.startsWith(".kota/runs/");
}

export function isTrialTaskMutation(file: WorkflowTrialChangedFile): boolean {
  return file.path.startsWith("data/tasks/");
}

export function cloneTrialChangedFile(
  file: WorkflowTrialChangedFile,
): WorkflowTrialChangedFile {
  return { path: file.path, change: file.change };
}
