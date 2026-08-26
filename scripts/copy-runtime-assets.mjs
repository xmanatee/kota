import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const sourceModules = join(projectRoot, "src", "modules");
const assetRoot = join(projectRoot, "dist", "assets");

function copySourcePath(sourcePath) {
  const destination = join(assetRoot, relative(projectRoot, sourcePath));
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
