import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const WORKFLOWS_DIR = import.meta.dirname;

const durableBoilerplatePatterns = [
  /read\s+(?:and follow\s+)?(?:the\s+)?root\s+`AGENTS\.md`/i,
  /local\s+`AGENTS\.md`\s+files/i,
  /follow\s+the\s+finish\s+protocol/i,
  /write\s+`<run-directory>\/commit-message\.txt`/i,
];

function listPromptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...listPromptFiles(path));
    } else if (entry === "prompt.md") {
      files.push(path);
    }
  }
  return files;
}

describe("workflow prompt hygiene", () => {
  it("keeps durable repo and finish policy in scoped AGENTS files", () => {
    const violations: string[] = [];
    for (const file of listPromptFiles(WORKFLOWS_DIR)) {
      const content = readFileSync(file, "utf8");
      for (const pattern of durableBoilerplatePatterns) {
        if (pattern.test(content)) {
          violations.push(relative(REPO_ROOT, file));
          break;
        }
      }
    }

    expect(violations.sort()).toEqual([]);
  });
});
