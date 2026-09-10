import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sourceModules = join(repositoryRoot, "src", "modules");
const assetRoot = join(repositoryRoot, "dist", "assets");

function copySourcePath(sourcePath) {
  const destination = join(assetRoot, relative(repositoryRoot, sourcePath));
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(sourcePath, destination, { recursive: true });
}

function copyRuntimeMarkdown(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const sourcePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (sourcePath === join(sourceModules, "eval-harness", "fixtures")) continue;
      if (sourcePath === join(sourceModules, "harness-parity", "scenarios")) continue;
      copyRuntimeMarkdown(sourcePath);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "AGENTS.md") {
      copySourcePath(sourcePath);
    }
  }
}

copyRuntimeMarkdown(sourceModules);
copySourcePath(join(sourceModules, "eval-harness", "fixtures"));
copySourcePath(join(sourceModules, "harness-parity", "scenarios"));
// Built processes report the build's revision rather than the checkout's later HEAD.
const builtRevision = existsSync(join(repositoryRoot, ".git"))
  ? execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim()
  : null;
writeFileSync(join(repositoryRoot, "dist", "runtime-revision.json"), `${JSON.stringify(builtRevision)}\n`);
