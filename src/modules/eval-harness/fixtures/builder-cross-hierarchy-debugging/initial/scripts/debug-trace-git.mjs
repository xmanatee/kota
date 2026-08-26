import { spawnSync } from "node:child_process";
import { allowedChangedPaths, forbiddenChangedPaths } from "./debug-trace-contract.mjs";

function runGit(scopeRoot, args) {
  return spawnSync("git", args, {
    cwd: scopeRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function pathsFromNameStatus(stdout) {
  const paths = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const fields = line.split("\t").filter(Boolean);
    if (fields.length >= 3 && fields[0]?.startsWith("R")) {
      paths.push(fields[1], fields[2]);
      continue;
    }
    if (fields.length >= 2) paths.push(fields[1]);
  }
  return paths;
}

function pathsFromPorcelain(stdout) {
  const paths = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const pathPart = line.length > 3 ? line.slice(3) : "";
    if (pathPart.includes(" -> ")) {
      paths.push(...pathPart.split(" -> ").filter(Boolean));
    } else if (pathPart) {
      paths.push(pathPart);
    }
  }
  return paths;
}

export function gitChangedPaths(scopeRoot) {
  const root = runGit(scopeRoot, ["rev-list", "--max-parents=0", "HEAD"]);
  if (root.status !== 0) return [];
  const rootCommit = root.stdout.trim().split("\n").find((line) => line.length > 0);
  if (rootCommit === undefined) return [];

  const committed = runGit(scopeRoot, ["diff", "--name-status", "--find-renames", `${rootCommit}..HEAD`]);
  if (committed.status !== 0) return [];

  const workingTree = runGit(scopeRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (workingTree.status !== 0) return [];

  return [...new Set([...pathsFromNameStatus(committed.stdout), ...pathsFromPorcelain(workingTree.stdout)])]
    .map((path) => path.trim())
    .filter((path) => path.length > 0 && !path.startsWith(".kota/"))
    .sort();
}

export function validateChangedPaths(issues, changedPaths) {
  if (!changedPaths.includes("src/channel-registry.mjs")) {
    issues.push("changed paths must include the upstream root-cause file src/channel-registry.mjs");
  }
  for (const path of changedPaths) {
    if (!allowedChangedPaths.has(path)) {
      issues.push(`changed path ${path} is outside the accepted implementation/task evidence set`);
    }
  }
  for (const path of forbiddenChangedPaths) {
    if (changedPaths.includes(path)) {
      issues.push(`symptom/verifier shortcut changed forbidden path ${path}`);
    }
  }
}
