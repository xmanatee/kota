import * as childProcess from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFileRead } from "./file-read.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFileSync: vi.fn(),
}));

import { MAX_IMAGE_SIZE, MAX_TEXT_SIZE } from "./file-read-formats.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "file-read-")); });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
function file(name: string, content: string | Buffer): string {
  const path = join(root, name);
  writeFileSync(path, content);
  return path;
}

describe("file_read", () => {
  it.each([
    ["default", {}, [1, 2, 3]],
    ["page", { offset: 2, limit: 1 }, [2]],
    ["nonpositive offset", { offset: -5, limit: 1 }, [1]],
    ["zero offset", { offset: 0, limit: 1 }, [1]],
    ["negative limit", { offset: 2, limit: -5 }, [2]],
    ["zero limit", { limit: 0 }, [1, 2, 3]],
    ["last line", { offset: 3 }, [3]],
    ["beyond end", { offset: 4 }, []],
  ])("numbers and bounds text: %s", async (_name, options, selected) => {
    file("text.txt", "alpha\nβeta\n🎉");
    const result = await runFileRead({ path: "text.txt", ...options }, { cwd: root });
    expect(result.is_error).toBeUndefined();
    expect(result.blocks).toBeUndefined();
    const numbered = result.content.split("\n").filter((line) => /^\s*\d+\t/.test(line));
    expect(numbered).toEqual(selected.map((n) => `${String(n).padStart(6)}\t${["alpha", "βeta", "🎉"][n - 1]}`));
    if (selected.length === 0) expect(result.content).toContain("offset 4 is beyond end of file");
    if (selected.length === 1 && selected[0] !== 3) expect(result.content).toContain("showing");
  });

  it.each(["", null, undefined])("rejects absent path %s", async (path) => {
    expect(await runFileRead({ path })).toMatchObject({ is_error: true, content: "Error: path is required" });
  });

  it("reports missing files and directories, including directory aliases", async () => {
    symlinkSync(root, join(root, "alias"));
    for (const path of [root, join(root, "alias")]) {
      expect(await runFileRead({ path })).toMatchObject({ is_error: true, content: expect.stringContaining("is a directory") });
    }
    expect(await runFileRead({ path: join(root, "missing") })).toMatchObject({ is_error: true, content: expect.stringContaining("not found") });
  });

  it.skipIf(process.getuid?.() === 0)("reports an unreadable file", async () => {
    const path = file("unreadable", "content");
    chmodSync(path, 0o000);
    try {
      expect(await runFileRead({ path })).toMatchObject({ is_error: true, content: expect.stringContaining("permission denied") });
    } finally { chmodSync(path, 0o600); }
  });

  it.each([".kota/daemon-control.json", ".KOTA/daemon-control.json", ".kota/secrets.json", ".env", ".env.local"])("rejects protected path %s", async (path) => {
    expect(await runFileRead({ path }, { cwd: root })).toMatchObject({ is_error: true, content: expect.stringContaining("protected scope runtime credential") });
  });

  it("rejects a custom operator credential and its symlink without exposing bytes", async () => {
    const token = "synthetic-private-token";
    const path = file("machine-proof.dat", token);
    const alias = join(root, "notes.json");
    symlinkSync(path, alias);
    vi.stubEnv("KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH", path);
    for (const target of [path, alias]) {
      const result = await runFileRead({ path: target }, { cwd: root, authorityConfigPath: join(root, "config.json") });
      expect(result).toMatchObject({ is_error: true, content: expect.stringContaining("protected scope runtime credential") });
      expect(result.content).not.toContain(token);
    }
  });

  it("returns image bytes and MIME type in model-readable blocks", async () => {
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const result = await runFileRead({ path: file("image.PNG", bytes) });
    expect(result.is_error).toBeUndefined();
    expect(result.blocks).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") } },
      { type: "text", text: result.content },
    ]);
    expect(result.content).toContain(`(${bytes.length}B)`);
  });

  it.each([
    ["image.png", MAX_IMAGE_SIZE, "Image too large"],
    ["text.txt", MAX_TEXT_SIZE, "File too large"],
  ])("rejects an actual oversized %s", async (name, limit, message) => {
    // Nonzero first block reaches text-size admission instead of binary detection.
    const path = file(name, "x".repeat(512));
    truncateSync(path, limit + 1);
    expect(await runFileRead({ path })).toMatchObject({ is_error: true, content: expect.stringContaining(message) });
  });

  it.each(["empty.png", "empty.PDF"])("rejects empty media %s", async (name) => {
    expect(await runFileRead({ path: file(name, "") })).toMatchObject({ is_error: true, content: expect.stringContaining("empty") });
  });

  it.each([
    ["text.svg", "<svg>日本語</svg>", "<svg>日本語</svg>"],
    ["empty.txt", "", "     1\t"],
    ["binary.bin", "a\0b", "Binary file"],
    ["sheet.xlsx", "PK\0", "Excel spreadsheet"],
    ["backup.tar.gz", "\0", "Compressed archive"],
  ])("routes %s by format and returns useful content", async (name, bytes, expected) => {
    const result = await runFileRead({ path: file(name, bytes) });
    expect(result.is_error).toBeUndefined();
    expect(result.blocks).toBeUndefined();
    expect(result.content).toContain(expected);
  });

  it("paginates extracted PDF text", async () => {
    vi.spyOn(childProcess, "execFileSync").mockReturnValue(Buffer.from("first\nsecond\nthird"));
    const result = await runFileRead({ path: file("document.PDF", "%PDF-1.4"), offset: 2, limit: 1 });
    expect(result.is_error).toBeUndefined();
    expect(result.content).toContain("[PDF:");
    expect(result.content).toContain("     2\tsecond");
    expect(result.content).toContain("Showing lines 2-2 of 3");
    expect(result.content).not.toContain("first");
  });

  it.each([
    ["scanned", "   ", undefined, "no extractable text", undefined],
    ["missing converter", "", "ENOENT", "pdftotext not installed", true],
    ["converter failure", "", "EIO", "Error reading PDF", true],
  ])("reports PDF extraction outcome: %s", async (_name, output, code, message, error) => {
    vi.spyOn(childProcess, "execFileSync").mockImplementation(() => {
      if (code) throw Object.assign(new Error("converter failed"), { code });
      return Buffer.from(output);
    });
    const result = await runFileRead({ path: file("document.pdf", "%PDF-1.4") });
    expect(result.is_error).toBe(error);
    expect(result.content).toContain(message);
  });
});
