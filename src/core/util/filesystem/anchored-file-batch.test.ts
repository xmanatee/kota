import childProcess from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readAnchoredTextFiles } from "./anchored-files.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("isolates per-leaf failures and resets directory anchoring between bounded reads", async () => {
  const root = mkdtempSync(join(tmpdir(), "anchored-batch-"));
  roots.push(root);
  for (const directory of ["a", "b"]) mkdirSync(join(root, directory));
  writeFileSync(join(root, "a/value"), "first");
  writeFileSync(join(root, "b/value"), "second");
  writeFileSync(join(root, "outside"), "outside-secret-content");
  symlinkSync(join(root, "outside"), join(root, "a/link"));
  linkSync(join(root, "outside"), join(root, "a/hardlink"));
  symlinkSync(join(root, "b"), join(root, "redirect"));
  writeFileSync(join(root, "oversized"), "larger than six bytes");
  const paths = ["a/value", "a/link", "a/hardlink", "redirect/value", "b/value", "a/missing", "oversized"];
  const files = await readAnchoredTextFiles(paths.map((path) => ({
    rootPath: root, boundaryDir: root, filePath: join(root, path), maxBytes: 6,
  })));
  expect(files).toMatchObject([
    { ok: true, file: { content: "first", snapshot: { size: 5 } } },
    { ok: false }, { ok: false }, { ok: false },
    { ok: true, file: { content: "second", snapshot: { size: 6 } } },
    { ok: true, file: null }, { ok: false },
  ]);
  expect(JSON.stringify(files)).not.toContain("outside-secret-content");
});

it("reaps the helper before an aborted batch rejects", async () => {
  const root = mkdtempSync(join(tmpdir(), "anchored-abort-"));
  roots.push(root);
  writeFileSync(join(root, "value"), "value");
  const abort = new AbortController();
  const spawn = vi.spyOn(childProcess, "spawn");
  syncBuiltinESMExports();
  const reading = readAnchoredTextFiles([{ rootPath: root, boundaryDir: root, filePath: join(root, "value"), maxBytes: 10 }], abort.signal);
  const child = spawn.mock.results[0]!.value as childProcess.ChildProcess;
  spawn.mockRestore();
  syncBuiltinESMExports();
  abort.abort();
  await expect(reading).rejects.toThrow("aborted");
  expect(child.pid).toBeDefined();
  expect(() => process.kill(child.pid!, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
  await expect(readAnchoredTextFiles([{ rootPath: root, boundaryDir: root, filePath: join(root, "value"), maxBytes: 10 }]))
    .resolves.toMatchObject([{ ok: true, file: { content: "value" } }]);
});
