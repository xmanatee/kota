import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverRepoAiChecks } from "./discovery.js";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "kota-repo-ai-checks-"));
}

function writeCheck(
  projectDir: string,
  relativePath: string,
  frontmatter: string,
  body = "Review the pull request against this policy.",
): void {
  const filePath = join(projectDir, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `---\n${frontmatter}---\n\n${body}\n`, "utf8");
}

describe("repo AI check discovery", () => {
  it("loads valid root-level .agents and .continue checks with provenance", () => {
    const projectDir = tempProject();
    writeCheck(projectDir, ".agents/checks/security.md", "name: Security\n" +
      "description: Review security-sensitive changes\n");
    writeCheck(projectDir, ".continue/checks/style.md", "name: Style\n" +
      "description: Review code style\n");

    const result = discoverRepoAiChecks(projectDir);

    expect(result.checks.map((check) => check.name)).toEqual(["Security", "Style"]);
    expect(result.checks[0]).toMatchObject({
      id: "security",
      description: "Review security-sensitive changes",
      provenance: {
        source: "agents",
        root: ".agents/checks",
        relativePath: ".agents/checks/security.md",
      },
    });
    expect(result.checks[1].provenance).toMatchObject({
      source: "continue",
      relativePath: ".continue/checks/style.md",
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("fails loudly on malformed frontmatter", () => {
    const projectDir = tempProject();
    mkdirSync(join(projectDir, ".agents/checks"), { recursive: true });
    writeFileSync(
      join(projectDir, ".agents/checks/broken.md"),
      "---\nname Security\n---\nBody\n",
      "utf8",
    );

    expect(() => discoverRepoAiChecks(projectDir)).toThrow(
      ".agents/checks/broken.md: malformed frontmatter line 1",
    );
  });

  it("fails when required frontmatter or body content is empty", () => {
    const missingDescription = tempProject();
    writeCheck(missingDescription, ".agents/checks/no-description.md", "name: Missing description\n");

    expect(() => discoverRepoAiChecks(missingDescription)).toThrow(
      'frontmatter "description" must be a non-empty string',
    );

    const emptyBody = tempProject();
    writeCheck(
      emptyBody,
      ".agents/checks/empty.md",
      "name: Empty\n" +
        "description: Empty body\n",
      "   ",
    );

    expect(() => discoverRepoAiChecks(emptyBody)).toThrow("check body must be non-empty");
  });

  it("uses deterministic duplicate-name precedence and reports diagnostics", () => {
    const projectDir = tempProject();
    writeCheck(projectDir, ".continue/checks/security.md", "name: Security\n" +
      "description: Continue copy\n", "Continue body");
    writeCheck(projectDir, ".agents/checks/security.md", "name: Security\n" +
      "description: Agents copy\n", "Agents body");

    const result = discoverRepoAiChecks(projectDir);

    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({
      name: "Security",
      description: "Agents copy",
      body: "Agents body",
      provenance: { relativePath: ".agents/checks/security.md" },
    });
    expect(result.diagnostics).toEqual([
      {
        type: "duplicate-name",
        name: "Security",
        winnerPath: ".agents/checks/security.md",
        ignoredPath: ".continue/checks/security.md",
        reason: ".agents/checks takes precedence over .continue/checks; ties use path order",
      },
    ]);
  });

  it("ignores nested markdown files with deterministic diagnostics", () => {
    const projectDir = tempProject();
    writeCheck(projectDir, ".agents/checks/root.md", "name: Root\n" +
      "description: Root check\n");
    writeCheck(projectDir, ".agents/checks/nested/ignored.md", "name: Nested\n" +
      "description: Nested check\n");
    writeCheck(projectDir, ".continue/checks/deeper/nested.md", "name: Deeper\n" +
      "description: Deeper check\n");

    const result = discoverRepoAiChecks(projectDir);

    expect(result.checks.map((check) => check.name)).toEqual(["Root"]);
    expect(result.diagnostics).toEqual([
      {
        type: "ignored-nested-file",
        path: ".agents/checks/nested/ignored.md",
        reason: "repo AI checks only load root-level markdown files",
      },
      {
        type: "ignored-nested-file",
        path: ".continue/checks/deeper/nested.md",
        reason: "repo AI checks only load root-level markdown files",
      },
    ]);
  });
});
