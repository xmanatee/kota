import childProcess from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readAnchoredTextFile, readAnchoredTextFiles } from "./anchored-files.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it.each(["single", "batch"])("preserves valid UTF-8 bytes and rejects malformed bytes in %s reads", async (mode) => {
  const root = mkdtempSync(join(tmpdir(), "anchored-utf8-"));
  roots.push(root);
  const filePath = join(root, "source");
  const access = { rootPath: root, boundaryDir: root, filePath };
  const read = async () => {
    if (mode === "single") return readAnchoredTextFile(access)?.content;
    const [entry] = await readAnchoredTextFiles([{ ...access, maxBytes: 128 }]);
    if (!entry?.ok) throw new Error(entry?.reason);
    return entry.file?.content;
  };
  // Preserve the BOM and a literal replacement character, not just ASCII.
  const valid = "\ufeffcafé \ufffd 🐙";
  writeFileSync(filePath, valid);
  expect(await read()).toBe(valid);
  for (const bytes of [[0xc3], [0xc0, 0xaf], [0x80]]) {
    writeFileSync(filePath, Buffer.from(bytes));
    await expect(read()).rejects.toThrow("UTF-8");
  }
});

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
