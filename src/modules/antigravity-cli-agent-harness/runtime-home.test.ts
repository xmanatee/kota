import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV,
  prepareAntigravityCliRuntimeEnvironment,
  resolveAntigravityCliKeychainDirectory,
} from "./runtime-home.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Antigravity CLI runtime home", () => {
  it("projects the macOS keychain directory into the isolated home", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-agy-home-"));
    roots.push(root);
    const keychainDirectory = join(root, "host-keychains");
    const invocationRoot = join(root, "invocation");
    mkdirSync(keychainDirectory);
    mkdirSync(join(invocationRoot, "home"), { recursive: true });

    const env = prepareAntigravityCliRuntimeEnvironment(invocationRoot, {
      [ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV]: keychainDirectory,
      PATH: "/usr/bin",
    });

    const projection = join(invocationRoot, "home", "Library", "Keychains");
    expect(lstatSync(projection).isSymbolicLink()).toBe(true);
    expect(readlinkSync(projection)).toBe(keychainDirectory);
    expect(env).toEqual({ PATH: "/usr/bin" });
  });

  it("does not invent a file-backed keyring projection on other platforms", () => {
    expect(resolveAntigravityCliKeychainDirectory({}, "linux")).toBeUndefined();
  });

  it("fails when the declared keychain directory is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-agy-home-"));
    roots.push(root);
    mkdirSync(join(root, "invocation", "home"), { recursive: true });

    expect(() => prepareAntigravityCliRuntimeEnvironment(
      join(root, "invocation"),
      { [ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV]: join(root, "missing") },
    )).toThrow(/keychain directory does not exist/);
  });
});
