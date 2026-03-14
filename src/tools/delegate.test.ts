import { describe, it, expect } from "vitest";
import { extractModifiedFiles } from "./delegate.js";

describe("extractModifiedFiles", () => {
  it("extracts path from file_edit", () => {
    expect(extractModifiedFiles("file_edit", { path: "src/foo.ts" })).toEqual([
      "src/foo.ts",
    ]);
  });

  it("extracts path from file_write", () => {
    expect(
      extractModifiedFiles("file_write", { path: "src/bar.ts" }),
    ).toEqual(["src/bar.ts"]);
  });

  it("returns empty for file_edit without path", () => {
    expect(extractModifiedFiles("file_edit", {})).toEqual([]);
  });

  it("extracts paths from multi_edit", () => {
    const input = {
      edits: [
        { path: "src/a.ts", old_string: "x", new_string: "y" },
        { path: "src/b.ts", old_string: "a", new_string: "b" },
      ],
    };
    expect(extractModifiedFiles("multi_edit", input)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("handles multi_edit with file_path field", () => {
    const input = {
      edits: [{ file_path: "src/c.ts", old_string: "x", new_string: "y" }],
    };
    expect(extractModifiedFiles("multi_edit", input)).toEqual(["src/c.ts"]);
  });

  it("filters empty paths from multi_edit", () => {
    const input = {
      edits: [
        { path: "src/a.ts", old_string: "x", new_string: "y" },
        { old_string: "a", new_string: "b" },
      ],
    };
    expect(extractModifiedFiles("multi_edit", input)).toEqual(["src/a.ts"]);
  });

  it("returns empty for multi_edit without edits", () => {
    expect(extractModifiedFiles("multi_edit", {})).toEqual([]);
  });

  it("returns empty for read-only tools", () => {
    expect(extractModifiedFiles("file_read", { path: "src/x.ts" })).toEqual(
      [],
    );
    expect(extractModifiedFiles("grep", { pattern: "foo" })).toEqual([]);
    expect(extractModifiedFiles("glob", { pattern: "*.ts" })).toEqual([]);
    expect(extractModifiedFiles("shell", { command: "ls" })).toEqual([]);
  });
});
