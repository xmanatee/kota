import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GEMINI_CLI_AUTH_DIR_ENV,
  prepareGeminiCliRuntimeEnvironment,
  resolveGeminiCliAuthDirectory,
} from "./runtime-home.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Gemini CLI runtime home", () => {
  it("resolves an explicit auth directory before the host home", () => {
    expect(resolveGeminiCliAuthDirectory({
      [GEMINI_CLI_AUTH_DIR_ENV]: "/isolated/gemini-auth",
      HOME: "/operator",
    })).toBe("/isolated/gemini-auth");
    expect(resolveGeminiCliAuthDirectory({ HOME: "/operator" }))
      .toBe("/operator/.gemini");
  });

  it("copies only login state and the selected authentication mode", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-gemini-runtime-home-test-"));
    roots.push(root);
    const sourceDirectory = join(root, "source");
    const invocationRoot = join(root, "invocation");
    mkdirSync(sourceDirectory);
    mkdirSync(invocationRoot);
    writeFileSync(join(sourceDirectory, "oauth_creds.json"), "{\"refresh_token\":\"secret\"}");
    writeFileSync(join(sourceDirectory, "google_accounts.json"), "{\"active\":\"operator@example.com\"}");
    writeFileSync(join(sourceDirectory, "settings.json"), JSON.stringify({
      security: {
        auth: { selectedType: "oauth-personal" },
      },
      mcp: {
        servers: { hostile: { command: "printenv" } },
      },
      tools: { discoveryCommand: "printenv" },
    }));
    writeFileSync(join(sourceDirectory, "GEMINI.md"), "untrusted global prompt");
    writeFileSync(join(sourceDirectory, ".env"), "GH_TOKEN=must-not-copy");

    const env = prepareGeminiCliRuntimeEnvironment(invocationRoot, {
      [GEMINI_CLI_AUTH_DIR_ENV]: sourceDirectory,
      KOTA_RUN_DIR: "/project/.kota/run",
    });
    const runtimeDirectory = join(invocationRoot, "home", ".gemini");

    expect(env).toEqual({ KOTA_RUN_DIR: "/project/.kota/run" });
    expect(readFileSync(join(runtimeDirectory, "oauth_creds.json"), "utf8"))
      .toBe("{\"refresh_token\":\"secret\"}");
    expect(readFileSync(join(runtimeDirectory, "google_accounts.json"), "utf8"))
      .toBe("{\"active\":\"operator@example.com\"}");
    expect(JSON.parse(readFileSync(join(runtimeDirectory, "settings.json"), "utf8")))
      .toEqual({ security: { auth: { selectedType: "oauth-personal" } } });
    expect(() => readFileSync(join(runtimeDirectory, "GEMINI.md"), "utf8"))
      .toThrow();
    expect(() => readFileSync(join(runtimeDirectory, ".env"), "utf8"))
      .toThrow();
  });
});
