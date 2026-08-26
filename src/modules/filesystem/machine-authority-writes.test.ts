import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolRunnerContext } from "#core/tools/index.js";
import { runFileEdit } from "./file-edit.js";
import { runFileWrite } from "./file-write.js";
import { runFindReplace } from "./find-replace.js";
import { runMultiEdit } from "./multi-edit.js";

describe("filesystem machine-authority boundary", () => {
  let root: string;
  let scopeRoot: string;
  let authorityDirectory: string;
  let authorityConfigPath: string;
  let context: ToolRunnerContext;
  const original = '{"trustedScopes":[]}\n';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-filesystem-authority-"));
    scopeRoot = join(root, "malicious-project");
    authorityDirectory = join(root, "operator");
    authorityConfigPath = join(authorityDirectory, "config.json");
    mkdirSync(scopeRoot, { recursive: true });
    mkdirSync(authorityDirectory, { recursive: true });
    writeFileSync(authorityConfigPath, original);
    context = { cwd: scopeRoot, authorityConfigPath };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects file_write against machine authority", async () => {
    const result = await runFileWrite(
      { path: authorityConfigPath, content: '{"trustedScopes":["malicious-project"]}\n' },
      context,
    );

    expectRejectedWithoutMutation(result);
  });

  it("rejects file_edit against machine authority", async () => {
    const result = await runFileEdit(
      {
        path: authorityConfigPath,
        old_string: "[]",
        new_string: '["malicious-project"]',
      },
      context,
    );

    expectRejectedWithoutMutation(result);
  });

  it("rejects multi_edit through a scope-local symlink to machine authority", async () => {
    symlinkSync(authorityDirectory, join(scopeRoot, "operator"), "dir");
    const result = await runMultiEdit(
      {
        edits: [{
          path: "operator/config.json",
          old_string: "[]",
          new_string: '["malicious-project"]',
        }],
      },
      context,
    );

    expectRejectedWithoutMutation(result);
  });

  it("rejects find_replace when its glob resolves to machine authority", async () => {
    const result = await runFindReplace(
      {
        pattern: "[]",
        replacement: '["malicious-project"]',
        files: authorityConfigPath,
      },
      context,
    );

    expectRejectedWithoutMutation(result);
  });

  function expectRejectedWithoutMutation(result: {
    content: string;
    is_error?: boolean;
  }): void {
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("operator-owned machine authority");
    expect(readFileSync(authorityConfigPath, "utf8")).toBe(original);
  }
});
