import { execFileSync, execSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvProvider, FileProvider, KeychainProvider } from "./secret-providers.js";

const security = vi.hoisted(() => ({ run: vi.fn(() => ""), platform: vi.fn(() => "darwin") }));
vi.mock("node:os", async (original) => ({ ...await original<typeof import("node:os")>(), platform: security.platform }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn((file, ...args) => file === "security" ? security.run() : actual.execFileSync(file, ...args)),
    // Retain a rejecting shell port so a regression cannot invoke the host keychain.
    execSync: vi.fn(() => { throw new Error("Unexpected shell execution"); }),
  };
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kota-secret-provider-"));
  security.run.mockReset().mockReturnValue("");
  security.platform.mockReturnValue("darwin");
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function mode(path: string): number { return statSync(path).mode & 0o777; }

describe("environment provider", () => {
  it("parses quoted, empty and embedded-equals values and skips malformed lines", () => {
    const path = join(dir, "variables");
    const values = { KOTA_PROVIDER_PLAIN: "bar", KOTA_PROVIDER_DOUBLE: "quoted value", KOTA_PROVIDER_SINGLE: "single quoted", KOTA_PROVIDER_EMPTY: "", KOTA_PROVIDER_URL: "https://host?a=1&b=2" };
    for (const key of Object.keys(values)) vi.stubEnv(key, undefined);
    writeFileSync(path, 'KOTA_PROVIDER_PLAIN=bar\r\nKOTA_PROVIDER_DOUBLE="quoted value"\r\nKOTA_PROVIDER_SINGLE=\'single quoted\'\r\nKOTA_PROVIDER_EMPTY=\r\nKOTA_PROVIDER_URL=https://host?a=1&b=2\r\n# comment\r\nBADLINE\r\n=nokey\r\n\r\n');
    const provider = new EnvProvider(path);
    expect(Object.fromEntries(provider.list().map((key) => [key, provider.get(key)]))).toEqual(values);
    writeFileSync(path, "KOTA_PROVIDER_PLAIN=changed\n");
    expect(provider.get("KOTA_PROVIDER_PLAIN")).toBe("bar");
    vi.stubEnv("KOTA_PROVIDER_PLAIN", "environment");
    expect(provider.get("KOTA_PROVIDER_PLAIN")).toBe("environment");
  });

  it("handles missing files and keys and rejects writes", () => {
    vi.stubEnv("KOTA_PROVIDER_MISSING", undefined);
    const provider = new EnvProvider(join(dir, "missing"));
    expect(provider.get("KOTA_PROVIDER_MISSING")).toBeNull();
    expect(provider.list()).toEqual([]);
    expect(() => provider.set("key", "value")).toThrow("read-only");
    expect(() => provider.remove("key")).toThrow("read-only");
  });
});

describe("file provider", () => {
  it("creates private storage and persists replacement, listing and removal across reopen", () => {
    const path = join(dir, "deep", "nested", "secrets.json");
    const provider = new FileProvider(path);
    provider.set("KEY", "old");
    provider.set("OTHER", "retained");
    provider.set("KEY", "new");
    const reopened = new FileProvider(path);
    expect(reopened.list().sort()).toEqual(["KEY", "OTHER"]);
    expect(reopened.get("KEY")).toBe("new");
    expect(mode(dirname(path))).toBe(0o700);
    expect(mode(path)).toBe(0o600);
    expect(reopened.remove("KEY")).toBe(true);
    expect(reopened.remove("KEY")).toBe(false);
    expect(new FileProvider(path).get("KEY")).toBeNull();
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ OTHER: "retained" });
  });

  it("repairs permissive storage on both read and subsequent write", () => {
    const path = join(dir, "storage", "secrets.json");
    mkdirSync(dirname(path));
    writeFileSync(path, '{"KEY":"old"}');
    const provider = new FileProvider(path);
    for (const operation of [() => expect(provider.get("KEY")).toBe("old"), () => provider.set("KEY", "new")]) {
      chmodSync(dirname(path), 0o755);
      chmodSync(path, 0o644);
      operation();
      expect(mode(dirname(path))).toBe(0o700);
      expect(mode(path)).toBe(0o600);
    }
    expect(new FileProvider(path).get("KEY")).toBe("new");
  });

  it.each(["not json{{{", "[1,2,3]", "null"])("treats invalid file %s as empty", (raw) => {
    const path = join(dir, "secrets.json");
    writeFileSync(path, raw);
    const provider = new FileProvider(path);
    expect(provider.list()).toEqual([]);
    expect(provider.get("KEY")).toBeNull();
  });

  it("decodes only string values from untrusted JSON", () => {
    const path = join(dir, "secrets.json");
    writeFileSync(path, JSON.stringify({ GOOD: "value", EMPTY: "", NUM: 42, BOOL: true, NIL: null, OBJECT: {} }));
    const provider = new FileProvider(path);
    expect(provider.list().sort()).toEqual(["EMPTY", "GOOD"]);
    expect(provider.get("GOOD")).toBe("value");
    expect(provider.get("EMPTY")).toBe("");
    expect(provider.get("NUM")).toBeNull();
    expect(provider.get("toString")).toBeNull();
    expect(provider.remove("toString")).toBe(false);
  });
});

describe("keychain provider", () => {
  it("passes metacharacters literally through an argument vector", () => {
    const provider = new KeychainProvider();
    const key = 'key"\\$`$(ignored)';
    const value = 'value"\\$`$(ignored)';
    provider.set(key, value);
    expect(execFileSync).toHaveBeenCalledWith("security", ["add-generic-password", "-s", "kota-secrets", "-a", key, "-w", value], expect.any(Object));
    expect(execSync).not.toHaveBeenCalled();
    security.run.mockReturnValue(" retrieved-value\n");
    expect(provider.get(key)).toBe("retrieved-value");
    expect(execFileSync).toHaveBeenCalledWith("security", ["find-generic-password", "-s", "kota-secrets", "-a", key, "-w"], expect.any(Object));
    expect(provider.remove(key)).toBe(true);
    expect(execFileSync).toHaveBeenCalledWith("security", ["delete-generic-password", "-s", "kota-secrets", "-a", key], expect.any(Object));
  });

  it.each([ ["key\ninjection", "value"], ["key", "val\0ue"], ["key", "val\rue"] ])("rejects malformed input before any process effect (%j)", (key, value) => {
    const provider = new KeychainProvider();
    expect(provider.isAvailable()).toBe(true);
    vi.clearAllMocks();
    expect(() => provider.set(key, value)).toThrow("newlines or null");
    expect(execFileSync).not.toHaveBeenCalled();
    expect(execSync).not.toHaveBeenCalled();
  });

  it.each(["unsupported platform", "missing executable"])("reports %s without pretending writes succeed", (failure) => {
    if (failure === "unsupported platform") security.platform.mockReturnValue("linux");
    else security.run.mockImplementation(() => { throw new Error("missing"); });
    const provider = new KeychainProvider();
    expect(provider.isAvailable()).toBe(false);
    expect(provider.get("key")).toBeNull();
    expect(provider.remove("key")).toBe(false);
    expect(() => provider.set("key", "value")).toThrow("Keychain not available");
    expect(provider.list()).toEqual([]);
  });

  it("preserves lookup/removal failure semantics and propagates write failure", () => {
    const provider = new KeychainProvider();
    expect(provider.isAvailable()).toBe(true);
    security.run.mockImplementation(() => { throw new Error("keychain rejected"); });
    expect(provider.get("key")).toBeNull();
    expect(provider.remove("key")).toBe(false);
    expect(() => provider.set("key", "value")).toThrow("keychain rejected");
  });
});
