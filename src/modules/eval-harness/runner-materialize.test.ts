import {
  existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync,readFileSync, 
  rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyRoundTaskInput } from "./runner-materialize.js";

describe("round input filesystem containment", () => {
  let root: string;
  let workspace: string;
  let outside: string;
  const contents = Buffer.from([0, 255, 10, 42]);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kota-round-input-test-"));
    workspace = join(root, "workspace");
    outside = join(root, "outside");
    mkdirSync(workspace);
    mkdirSync(outside);
    writeFileSync(join(root, "input"), contents);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function copy(targetPath: string): void {
    applyRoundTaskInput({
      kind: "copy-fixture-file", sourcePath: "input", targetPath,
    }, root, workspace);
  }

  it.each(["existing", "new", "nested/new"])(
    "rejects an external ancestor without overwriting or creating %s",
    (suffix) => {
      writeFileSync(join(outside, "existing"), "untouched");
      symlinkSync(outside, join(workspace, "data"));
      expect(() => copy(`data/${suffix}`)).toThrow(/Round input copy refused/);
      expect(readFileSync(join(outside, "existing"), "utf8")).toBe("untouched");
      expect(readdirSync(outside)).toEqual(["existing"]);
    },
  );

  it("rejects a symlink at the workspace root", () => {
    rmSync(workspace, { recursive: true });
    symlinkSync(outside, workspace);
    expect(() => copy("new")).toThrow(/Round input copy refused/);
    expect(readdirSync(outside)).toEqual([]);
  });

  it.each([false, true])("rejects a leaf symlink (dangling: %s)", (dangling) => {
    const victim = join(outside, "victim");
    if (!dangling) writeFileSync(victim, "untouched");
    symlinkSync(victim, join(workspace, "input"));
    expect(() => copy("input")).toThrow(/Round input copy refused/);
    if (dangling) expect(existsSync(victim)).toBe(false);
    else expect(readFileSync(victim, "utf8")).toBe("untouched");
  });

  it("replaces hard-linked leaves without modifying the linked file", () => {
    const victim = join(outside, "victim");
    writeFileSync(victim, "untouched");
    linkSync(victim, join(workspace, "input"));
    copy("input");
    expect(readFileSync(victim, "utf8")).toBe("untouched");
    expect(readFileSync(join(workspace, "input"))).toEqual(contents);
  });

  it("creates nested directories and replaces existing inputs preserving bytes", () => {
    copy("data/tasks/input");
    expect(readFileSync(join(workspace, "data/tasks/input"))).toEqual(contents);
    writeFileSync(join(root, "input"), "replacement");
    copy("data/tasks/input");
    expect(readFileSync(join(workspace, "data/tasks/input"), "utf8")).toBe("replacement");
    expect(readdirSync(join(workspace, "data/tasks"))).toEqual(["input"]);
  });
});
