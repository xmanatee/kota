import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MODULE_ROOT = fileURLToPath(new URL("./", import.meta.url));
const DIRECT_BLOCKING_WORKFLOW_CALL =
  /\b(?:cpSync|execFileSync|execSync|loadAllFixtures|mkdirSync|readFileSync|readdirSync|runEvalSet|spawnSync|writeFileSync)\s*\(/;

function workflowDefinitionFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "fixtures") files.push(...workflowDefinitionFiles(path));
      continue;
    }
    if (entry.name.endsWith("-workflow.ts")) files.push(path);
  }
  return files;
}

describe("eval-harness workflow blocking-operation boundary", () => {
  it("keeps fixture, repository, and synchronous filesystem work out of workflow definitions", () => {
    const offenders = workflowDefinitionFiles(MODULE_ROOT)
      .filter((path) => DIRECT_BLOCKING_WORKFLOW_CALL.test(readFileSync(path, "utf8")))
      .map((path) => path.slice(MODULE_ROOT.length))
      .sort();

    expect(offenders).toEqual([]);
  });
});
