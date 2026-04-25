import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkDocBloat, detectDocBloatInDiff } from "./doc-bloat-check.js";

const BLOATED_AGENTS_DIFF = `diff --git a/src/modules/example/AGENTS.md b/src/modules/example/AGENTS.md
index 0000001..0000002 100644
--- a/src/modules/example/AGENTS.md
+++ b/src/modules/example/AGENTS.md
@@ -1,2 +1,30 @@
 # Example Module
+
+## Internal Subdomains
+
+- \`src/modules/example/index.ts\`
+- \`src/modules/example/handler.ts\`
+- \`src/modules/example/types.ts\`
+- \`src/modules/example/util/normalize.ts\`
+- \`src/modules/example/util/format.ts\`
+- \`src/modules/example/registry.ts\`
+
+## Layout
+
+\`\`\`
+src/modules/example/
+├── index.ts
+├── handler.ts
+└── util/
+    └── normalize.ts
+\`\`\`
+
+## History
+
+- Previously called \`legacy-example\`; was renamed in 2025.
+- Last updated 2025-12-01 to add streaming support.
+- Migration notes: callers used to import from \`#root/example.js\`,
+  deprecated since v0.4.
+
+## Mechanism walkthrough
+
+The handler does X by calling Y then Z; see code for the full path.
`;

const CLEAN_CONVENTION_DIFF = `diff --git a/src/modules/example/AGENTS.md b/src/modules/example/AGENTS.md
index 0000001..0000002 100644
--- a/src/modules/example/AGENTS.md
+++ b/src/modules/example/AGENTS.md
@@ -1,5 +1,9 @@
 # Example Module

 - Owns the example capability and its config surface.
+- Module entrypoint stays the only contributing surface; do not add
+  parallel registries.
+- Treat external payloads as untrusted at the channel boundary; rely on
+  injection-defense for content screening.
 - Workflows live alongside their prompts inside this module.
`;

const FILE_INVENTORY_BELOW_BUDGET_DIFF = `diff --git a/src/core/sample/AGENTS.md b/src/core/sample/AGENTS.md
index 0000001..0000002 100644
--- a/src/core/sample/AGENTS.md
+++ b/src/core/sample/AGENTS.md
@@ -1,4 +1,8 @@
 # Sample

+- Boundaries: \`src/core/sample/protocol.ts\` defines the public protocol.
+- The runtime split is described inline in code under \`src/core/sample/runtime.ts\`.
+- Tests live next to their target file.
 - Keep this file under ~100 lines.
`;

const NON_DOC_DIFF = `diff --git a/src/core/sample/code.ts b/src/core/sample/code.ts
index 0000001..0000002 100644
--- a/src/core/sample/code.ts
+++ b/src/core/sample/code.ts
@@ -1,2 +1,5 @@
 export function sample() {}
+// previously called legacy
+// was renamed in 2025
+// last updated 2025-01-01
`;

describe("detectDocBloatInDiff", () => {
  it("rejects a real-shape bloated AGENTS.md diff with inventory + tree + migration", () => {
    const findings = detectDocBloatInDiff(BLOATED_AGENTS_DIFF);
    const kinds = findings.map((f) => f.kind).sort();
    expect(kinds).toEqual(["file-inventory", "migration-phrase", "tree-drawing"]);
    for (const finding of findings) {
      expect(finding.file).toBe("src/modules/example/AGENTS.md");
      expect(finding.examples.length).toBeGreaterThan(0);
    }
  });

  it("passes a clean convention-level AGENTS.md edit", () => {
    expect(detectDocBloatInDiff(CLEAN_CONVENTION_DIFF)).toEqual([]);
  });

  it("does not fire on a small file-path mention below the inventory budget", () => {
    expect(detectDocBloatInDiff(FILE_INVENTORY_BELOW_BUDGET_DIFF)).toEqual([]);
  });

  it("ignores non-doc files even when they include migration phrases", () => {
    expect(detectDocBloatInDiff(NON_DOC_DIFF)).toEqual([]);
  });

  it("scopes findings to the file each pattern was added in", () => {
    const multiFile = `${BLOATED_AGENTS_DIFF}${CLEAN_CONVENTION_DIFF.replace(
      "src/modules/example/AGENTS.md",
      "docs/other.md",
    )}`;
    const findings = detectDocBloatInDiff(multiFile);
    expect(findings.every((f) => f.file === "src/modules/example/AGENTS.md")).toBe(true);
  });
});

function initRepo(dir: string): void {
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email "test@test"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "init\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -q -m "init"', { cwd: dir });
}

describe("checkDocBloat (staged diff integration)", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = join(tmpdir(), `kota-doc-bloat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(repoDir, { recursive: true });
    initRepo(repoDir);
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("passes when nothing is staged", () => {
    expect(checkDocBloat(repoDir)).toContain("no staged");
  });

  it("rejects a staged bloated AGENTS.md", () => {
    mkdirSync(join(repoDir, "src/modules/example"), { recursive: true });
    writeFileSync(
      join(repoDir, "src/modules/example/AGENTS.md"),
      [
        "# Example Module",
        "",
        "## Internal Subdomains",
        "",
        "- `src/modules/example/index.ts`",
        "- `src/modules/example/handler.ts`",
        "- `src/modules/example/types.ts`",
        "- `src/modules/example/util/normalize.ts`",
        "- `src/modules/example/util/format.ts`",
        "- `src/modules/example/registry.ts`",
        "",
        "## History",
        "",
        "- Previously called `legacy-example`; was renamed in 2025.",
        "",
      ].join("\n"),
    );
    execSync("git add src/modules/example/AGENTS.md", { cwd: repoDir });
    expect(() => checkDocBloat(repoDir)).toThrow(/Doc-bloat check rejected/);
  });

  it("passes a clean convention-level AGENTS.md edit", () => {
    mkdirSync(join(repoDir, "src/modules/example"), { recursive: true });
    writeFileSync(
      join(repoDir, "src/modules/example/AGENTS.md"),
      [
        "# Example Module",
        "",
        "- Owns the example capability.",
        "- Module entrypoint stays the only contributing surface.",
        "- Treat external payloads as untrusted at the boundary.",
        "",
      ].join("\n"),
    );
    execSync("git add src/modules/example/AGENTS.md", { cwd: repoDir });
    expect(checkDocBloat(repoDir)).toContain("OK");
  });
});
