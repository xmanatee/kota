#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nodeOptionsWithoutSourceCondition } from "../dist/core/util/node-options.js";

function handleOutputError(error) {
  if (error?.code === "EPIPE") process.exit(0);
  throw error;
}

process.stdout.on("error", handleOutputError);
process.stderr.on("error", handleOutputError);

const nodeOptionsResult = nodeOptionsWithoutSourceCondition(
  process.env.NODE_OPTIONS,
);

if (nodeOptionsResult.removedSourceCondition) {
  const env = { ...process.env };
  if (nodeOptionsResult.nodeOptions === undefined) {
    delete env.NODE_OPTIONS;
  } else {
    env.NODE_OPTIONS = nodeOptionsResult.nodeOptions;
  }

  const child = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { env, stdio: "inherit" },
  );
  if (child.error !== undefined) {
    throw child.error;
  }
  process.exit(child.status ?? 1);
}

const { recoverPreparationBeforeCliImports } = await import("../dist/core/workflow/repository-preparation-recovery.js");
await recoverPreparationBeforeCliImports(fileURLToPath(new URL("../", import.meta.url)));
await import("../dist/cli.js");
