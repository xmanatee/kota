import { randomUUID } from "node:crypto";
import { existsSync, linkSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishPrivateFile } from "./private-files.js";

const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true });
});

it("rejects relocatable roots before collecting private bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "private-file-"));
  cleanup.push(root);
  const target = join(root, "state.json");
  writeFileSync(target, "original");
  const collect = vi.fn(async () => "synthetic credential");
  await expect(publishPrivateFile({ filePath: target, allowedWriteRoots: [root], collect }))
    .rejects.toThrow("persistence is unavailable");
  expect(collect).not.toHaveBeenCalled();
  expect(readFileSync(target, "utf8")).toBe("original");
});

// /tmp itself cannot be renamed by this uid: its parent is administrator-owned.
// Random leaf names avoid relying on (or mutating) any existing host files.
describe.skipIf(process.platform !== "linux" || process.getuid?.() === 0)("Linux private publication", () => {
  function target(directory = "/tmp"): string {
    const path = `${directory}/kota-private-test-${randomUUID()}.json`;
    cleanup.push(path);
    return path;
  }

  it("creates and replaces a private profile with complete bytes", async () => {
    const filePath = target();
    for (const content of ["first synthetic state", "second synthetic state".repeat(8192)]) {
      await publishPrivateFile({ filePath, allowedWriteRoots: ["/tmp"], collect: async () => content });
      expect(readFileSync(filePath, "utf8")).toBe(content);
      expect(lstatSync(filePath).mode & 0o777).toBe(0o600);
      expect(lstatSync(filePath).nlink).toBe(1);
    }
  });

  it("enforces write roots before collection", async () => {
    const filePath = target();
    const collect = vi.fn(async () => "synthetic state");
    await expect(publishPrivateFile({ filePath, allowedWriteRoots: [], collect })).rejects.toThrow("write roots");
    expect(collect).not.toHaveBeenCalled();
    expect(existsSync(filePath)).toBe(false);
  });

  it.each(["symlink", "hardlink", "replacement"] as const)("rejects a %s substituted during collection without modifying either entry", async (kind) => {
    const filePath = target();
    // The symlink crosses the /tmp grant; the hard link must share its filesystem.
    const sentinel = target(kind === "symlink" ? "/dev/shm" : "/tmp");
    writeFileSync(filePath, "original");
    writeFileSync(sentinel, "sentinel");
    await expect(publishPrivateFile({
      filePath,
      allowedWriteRoots: ["/tmp"],
      collect: async () => {
        rmSync(filePath);
        if (kind === "symlink") symlinkSync(sentinel, filePath);
        else if (kind === "hardlink") linkSync(sentinel, filePath);
        else writeFileSync(filePath, "concurrent replacement");
        return "synthetic credential";
      },
    })).rejects.toThrow();
    expect(readFileSync(sentinel, "utf8")).toBe("sentinel");
    expect(readFileSync(filePath, "utf8")).toBe(kind === "replacement" ? "concurrent replacement" : "sentinel");
  });

  it("rejects a writable ancestor even when it is a real directory", async () => {
    const root = mkdtempSync("/tmp/kota-relocatable-");
    cleanup.push(root);
    const filePath = join(root, "state.json");
    writeFileSync(filePath, "sentinel");
    const collect = vi.fn(async () => "synthetic credential");
    await expect(publishPrivateFile({ filePath, allowedWriteRoots: [root], collect })).rejects.toThrow("relocation");
    expect(collect).not.toHaveBeenCalled();
    expect(readFileSync(filePath, "utf8")).toBe("sentinel");
  });
});
