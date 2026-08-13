import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
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
  it("rejects the host Keychains directory before creating a projection", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-agy-home-"));
    roots.push(root);
    const keychainDirectory = join(root, "host-keychains");
    const invocationRoot = join(root, "invocation");
    const toolRuntimeRoot = join(invocationRoot, "tool-runtime");
    mkdirSync(keychainDirectory);
    mkdirSync(join(toolRuntimeRoot, "home"), { recursive: true });

    const projection = join(toolRuntimeRoot, "home", "Library", "Keychains");
    expect(() => prepareAntigravityCliRuntimeEnvironment({
      invocationRoot,
      toolRuntimeRoot,
      readableRoots: [],
      writableRoots: [],
      readProtectedPaths: [],
      writeProtectedPaths: [],
      readProtectedRoots: [],
      protectedRuntimeRoot: join(root, "protected-runtime"),
    }, {
      [ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV]: keychainDirectory,
      PATH: "/usr/bin",
    })).toThrow(/provider-only authentication broker.*refusing to launch/i);
    expect(() => lstatSync(projection)).toThrow();
  });

  it("does not invent a file-backed keyring projection on other platforms", () => {
    expect(resolveAntigravityCliKeychainDirectory({}, "linux")).toBeUndefined();
  });

  it("rejects even a missing declared keychain directory instead of weakening the boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-agy-home-"));
    roots.push(root);
    const invocationRoot = join(root, "invocation");
    const toolRuntimeRoot = join(invocationRoot, "tool-runtime");
    mkdirSync(join(toolRuntimeRoot, "home"), { recursive: true });

    expect(() => prepareAntigravityCliRuntimeEnvironment(
      {
        invocationRoot,
        toolRuntimeRoot,
        readableRoots: [],
        writableRoots: [],
        readProtectedPaths: [],
        writeProtectedPaths: [],
        readProtectedRoots: [],
        protectedRuntimeRoot: join(root, "protected-runtime"),
      },
      { [ANTIGRAVITY_CLI_KEYCHAIN_DIR_ENV]: join(root, "missing") },
    )).toThrow(/Keychains directory.*refusing to launch/i);
  });
});
