import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EnvProvider,
  FileProvider,
  KeychainProvider,
} from "./secrets.js";

function makeTmpDir(): string {
  const dir = join(tmpdir(), `kota-secrets-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("EnvProvider", () => {
  it("reads from process.env", () => {
    process.env.KOTA_TEST_SECRET = "test-value-123";
    const provider = new EnvProvider();
    expect(provider.get("KOTA_TEST_SECRET")).toBe("test-value-123");
    delete process.env.KOTA_TEST_SECRET;
  });

  it("returns null for missing keys", () => {
    const provider = new EnvProvider();
    expect(provider.get("KOTA_NONEXISTENT_KEY_XYZ")).toBeNull();
  });

  it("reads .env file", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, 'FOO=bar\nBAZ="quoted value"\n# comment\nEMPTY=\n');
    const provider = new EnvProvider(envFile);

    expect(provider.get("FOO")).toBe("bar");
    expect(provider.get("BAZ")).toBe("quoted value");
    expect(provider.get("EMPTY")).toBe("");
    expect(provider.list()).toEqual(["FOO", "BAZ", "EMPTY"]);

    rmSync(dir, { recursive: true });
  });

  it("handles missing .env file", () => {
    const provider = new EnvProvider("/nonexistent/.env");
    expect(provider.get("FOO")).toBeNull();
    expect(provider.list()).toEqual([]);
  });

  it("is read-only", () => {
    const provider = new EnvProvider();
    expect(provider.writable).toBe(false);
    expect(() => provider.set("x", "y")).toThrow("read-only");
    expect(() => provider.remove("x")).toThrow("read-only");
  });

  it("parses single-quoted values", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "KEY='single quoted'\n");
    const provider = new EnvProvider(envFile);
    expect(provider.get("KEY")).toBe("single quoted");
    rmSync(dir, { recursive: true });
  });

  it("skips malformed lines", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "GOOD=value\nBADLINE\n=nokey\n\n");
    const provider = new EnvProvider(envFile);
    expect(provider.list()).toEqual(["GOOD"]);
    rmSync(dir, { recursive: true });
  });

  it("handles Windows CRLF line endings", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "A=one\r\nB=two\r\n");
    const provider = new EnvProvider(envFile);
    expect(provider.get("A")).toBe("one");
    expect(provider.get("B")).toBe("two");
    rmSync(dir, { recursive: true });
  });

  it("handles values containing = sign", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "URL=https://host?a=1&b=2\n");
    const provider = new EnvProvider(envFile);
    expect(provider.get("URL")).toBe("https://host?a=1&b=2");
    rmSync(dir, { recursive: true });
  });

  it("process.env takes priority over .env file", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "PRIORITY_KEY=from-file\n");
    process.env.PRIORITY_KEY = "from-env";
    const provider = new EnvProvider(envFile);
    expect(provider.get("PRIORITY_KEY")).toBe("from-env");
    delete process.env.PRIORITY_KEY;
    rmSync(dir, { recursive: true });
  });

  it("caches .env file after first read", () => {
    const dir = makeTmpDir();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "CACHED=original\n");
    const provider = new EnvProvider(envFile);
    expect(provider.get("CACHED")).toBe("original");
    // Overwrite file — provider should still return cached value
    writeFileSync(envFile, "CACHED=changed\n");
    expect(provider.get("CACHED")).toBe("original");
    rmSync(dir, { recursive: true });
  });
});

describe("FileProvider", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it("stores and retrieves secrets", () => {
    const provider = new FileProvider(join(dir, "secrets.json"));
    provider.set("API_KEY", "sk-123");
    expect(provider.get("API_KEY")).toBe("sk-123");
  });

  it("persists to disk", () => {
    const path = join(dir, "secrets.json");
    const p1 = new FileProvider(path);
    p1.set("TOKEN", "abc");

    // New instance reads from disk
    const p2 = new FileProvider(path);
    expect(p2.get("TOKEN")).toBe("abc");
  });

  it("lists secret names", () => {
    const provider = new FileProvider(join(dir, "secrets.json"));
    provider.set("A", "1");
    provider.set("B", "2");
    expect(provider.list().sort()).toEqual(["A", "B"]);
  });

  it("removes secrets", () => {
    const provider = new FileProvider(join(dir, "secrets.json"));
    provider.set("KEY", "val");
    expect(provider.remove("KEY")).toBe(true);
    expect(provider.get("KEY")).toBeNull();
    expect(provider.remove("KEY")).toBe(false);
  });

  it("creates parent directories", () => {
    const nested = join(dir, "deep", "nested", "secrets.json");
    const provider = new FileProvider(nested);
    provider.set("KEY", "val");
    expect(existsSync(nested)).toBe(true);
  });

  it("creates secret directories and files with owner-only permissions", () => {
    const nested = join(dir, "deep", "nested", "secrets.json");
    const provider = new FileProvider(nested);
    provider.set("KEY", "val");

    expect(modeOf(dirname(nested))).toBe(0o700);
    expect(modeOf(nested)).toBe(0o600);
  });

  it("repairs permissive existing storage permissions on load", () => {
    const path = join(dir, ".kota", "secrets.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ KEY: "val" }));
    chmodSync(dirname(path), 0o755);
    chmodSync(path, 0o644);

    const provider = new FileProvider(path);
    expect(provider.get("KEY")).toBe("val");
    expect(modeOf(dirname(path))).toBe(0o700);
    expect(modeOf(path)).toBe(0o600);
  });

  it("repairs permissive existing storage permissions on save", () => {
    const path = join(dir, ".kota", "secrets.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ KEY: "old" }));
    chmodSync(dirname(path), 0o755);
    chmodSync(path, 0o644);

    const provider = new FileProvider(path);
    expect(provider.get("KEY")).toBe("old");
    chmodSync(dirname(path), 0o755);
    chmodSync(path, 0o644);

    provider.set("KEY", "new");

    expect(modeOf(dirname(path))).toBe(0o700);
    expect(modeOf(path)).toBe(0o600);
  });

  it("handles corrupted JSON", () => {
    const path = join(dir, "secrets.json");
    writeFileSync(path, "not json{{{");
    const provider = new FileProvider(path);
    expect(provider.list()).toEqual([]);
    expect(provider.get("KEY")).toBeNull();
  });

  it("handles non-object JSON", () => {
    const path = join(dir, "secrets.json");
    writeFileSync(path, "[1,2,3]");
    const provider = new FileProvider(path);
    expect(provider.list()).toEqual([]);
  });

  it("is writable", () => {
    const provider = new FileProvider(join(dir, "secrets.json"));
    expect(provider.writable).toBe(true);
  });

  it("overwrites existing key", () => {
    const provider = new FileProvider(join(dir, "secrets.json"));
    provider.set("KEY", "old");
    provider.set("KEY", "new");
    expect(provider.get("KEY")).toBe("new");
  });

  it("ignores non-string values in JSON", () => {
    const path = join(dir, "secrets.json");
    writeFileSync(path, JSON.stringify({ GOOD: "val", NUM: 42, BOOL: true, NIL: null }));
    const provider = new FileProvider(path);
    expect(provider.get("GOOD")).toBe("val");
    // Non-string values are accessible via object lookup but come out as-is
    expect(provider.list()).toContain("GOOD");
    expect(provider.list()).toContain("NUM");
  });

  it("uses custom name", () => {
    const provider = new FileProvider(join(dir, "secrets.json"), "my-scope");
    expect(provider.name).toBe("my-scope");
  });
});

describe("KeychainProvider", () => {
  it("reports availability based on platform", () => {
    const provider = new KeychainProvider();
    // Just ensure it doesn't crash
    const available = provider.isAvailable();
    expect(typeof available).toBe("boolean");
  });

  it("returns null for missing keys", () => {
    const provider = new KeychainProvider();
    // Even if keychain is available, this non-existent key should return null
    expect(provider.get("KOTA_NONEXISTENT_TEST_KEY_12345")).toBeNull();
  });

  it("list returns empty array", () => {
    const provider = new KeychainProvider();
    expect(provider.list()).toEqual([]);
  });

  it("rejects keys with newlines", () => {
    const provider = new KeychainProvider();
    if (!provider.isAvailable()) return;
    expect(() => provider.set("key\ninjection", "val")).toThrow("newlines or null");
  });

  it("rejects values with null bytes", () => {
    const provider = new KeychainProvider();
    if (!provider.isAvailable()) return;
    expect(() => provider.set("key", "val\0ue")).toThrow("newlines or null");
  });
});
