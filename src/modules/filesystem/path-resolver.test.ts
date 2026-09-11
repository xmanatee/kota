import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { fileNotFoundError, suggestAlternatives } from "./path-resolver.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "path-resolver-"));
  for (const dir of ["src", "node_modules"]) mkdirSync(join(root, dir));
  for (const name of ["helper.ts", "helpers.ts", "file-write.ts", "file-edit.ts"]) writeFileSync(join(root, "src", name), "");
  writeFileSync(join(root, "node_modules", "helper.ts"), "");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it("suggests an exact basename from the selected scope without dependencies", () => {
  expect(fileNotFoundError("wrong/helper.ts", root)).toBe("Error: file not found: wrong/helper.ts\n\nDid you mean: src/helper.ts");
});

it("ranks fuzzy names and bounds an actually populated candidate set", () => {
  const all = suggestAlternatives("wrong/helpe.ts", 5, root);
  expect(all[0]).toBe("src/helper.ts");
  expect(all.length).toBeGreaterThan(1);
  expect(suggestAlternatives("wrong/helpe.ts", 1, root)).toEqual(["src/helper.ts"]);
  expect(fileNotFoundError("wrong/helpe.ts", root)).toContain("Similar files found:");
});

it.each(["", "zzz-unrelated.xyz", "no_extension"])("returns no suggestions for %s", (path) => {
  expect(suggestAlternatives(path, 5, root)).toEqual([]);
  expect(fileNotFoundError(path, root)).toBe(`Error: file not found: ${path}`);
});
