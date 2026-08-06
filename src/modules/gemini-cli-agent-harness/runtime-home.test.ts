import {
  existsSync,
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
  GEMINI_CLI_HOME_ENV,
  GEMINI_CLI_SYSTEM_DEFAULTS_PATH_ENV,
  GEMINI_CLI_SYSTEM_SETTINGS_PATH_ENV,
  GEMINI_FORCE_FILE_STORAGE_ENV,
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
      [GEMINI_CLI_HOME_ENV]: "/isolated/gemini-auth",
      HOME: "/operator",
    })).toBe("/isolated/gemini-auth/.gemini");
    expect(resolveGeminiCliAuthDirectory({ HOME: "/operator" }))
      .toBe("/operator/.gemini");
  });

  it("rejects copied login state before creating a runtime home", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-gemini-runtime-home-test-"));
    roots.push(root);
    const sourceHome = join(root, "source");
    const sourceDirectory = join(sourceHome, ".gemini");
    const invocationRoot = join(root, "invocation");
    mkdirSync(sourceDirectory, { recursive: true });
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

    expect(() => prepareGeminiCliRuntimeEnvironment({
      invocationRoot,
      toolRuntimeRoot: join(invocationRoot, "tool-runtime"),
      readableRoots: [],
      writableRoots: [],
      readProtectedPaths: [],
      writeProtectedPaths: [],
      readProtectedRoots: [],
      protectedRuntimeRoot: join(invocationRoot, "protected-runtime"),
    }, {
      [GEMINI_CLI_HOME_ENV]: sourceHome,
      KOTA_RUN_DIR: "/project/.kota/run",
    })).toThrow(/provider-only authentication broker.*refusing to launch/i);
    expect(existsSync(join(invocationRoot, "gemini-provider-home"))).toBe(false);
  });

  it.each(["GEMINI_API_KEY", "GOOGLE_API_KEY"] as const)(
    "rejects %s before creating a runtime home",
    (credentialKey) => {
      const root = mkdtempSync(join(tmpdir(), "kota-gemini-api-key-test-"));
      roots.push(root);
      const sourceHome = join(root, "source");
      const invocationRoot = join(root, "invocation");
      mkdirSync(invocationRoot);

      expect(() => prepareGeminiCliRuntimeEnvironment({
        invocationRoot,
        toolRuntimeRoot: join(invocationRoot, "tool-runtime"),
        readableRoots: [],
        writableRoots: [],
        readProtectedPaths: [],
        writeProtectedPaths: [],
        readProtectedRoots: [],
        protectedRuntimeRoot: join(invocationRoot, "protected-runtime"),
      }, {
        [GEMINI_CLI_HOME_ENV]: sourceHome,
        [credentialKey]: "provider-secret",
      })).toThrow(
        new RegExp(`${credentialKey}.*provider-only authentication broker`, "i"),
      );
      expect(existsSync(join(invocationRoot, "gemini-provider-home"))).toBe(false);
    },
  );

  it.each([
    { selectedAuthType: "gemini-api-key" },
    { security: { auth: { selectedType: "gemini-api-key" } } },
  ])("rejects a possible Keychain-backed API-key selection before creating a runtime home", (settings) => {
    const root = mkdtempSync(join(tmpdir(), "kota-gemini-keychain-selection-test-"));
    roots.push(root);
    const sourceHome = join(root, "source");
    const sourceDirectory = join(sourceHome, ".gemini");
    const invocationRoot = join(root, "invocation");
    mkdirSync(sourceDirectory, { recursive: true });
    mkdirSync(invocationRoot);
    writeFileSync(join(sourceDirectory, "settings.json"), JSON.stringify(settings));

    expect(() => prepareGeminiCliRuntimeEnvironment({
      invocationRoot,
      toolRuntimeRoot: join(invocationRoot, "tool-runtime"),
      readableRoots: [],
      writableRoots: [],
      readProtectedPaths: [],
      writeProtectedPaths: [],
      readProtectedRoots: [],
      protectedRuntimeRoot: join(invocationRoot, "protected-runtime"),
    }, {
      [GEMINI_CLI_HOME_ENV]: sourceHome,
    })).toThrow(/settings\.json.*gemini-api-key selection.*refusing to launch/i);
    expect(existsSync(join(invocationRoot, "gemini-provider-home"))).toBe(false);
  });

  it("writes sanitized user and system settings without executable configuration", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-gemini-runtime-settings-test-"));
    roots.push(root);
    const sourceHome = join(root, "source");
    const sourceDirectory = join(sourceHome, ".gemini");
    const invocationRoot = join(root, "invocation");
    mkdirSync(sourceDirectory, { recursive: true });
    mkdirSync(invocationRoot);
    mkdirSync(join(invocationRoot, "protected-runtime"));
    writeFileSync(join(sourceDirectory, "settings.json"), JSON.stringify({
      security: { auth: { selectedType: "oauth-personal" } },
      hooks: { BeforeTool: [{ command: "hostile-hook" }] },
      mcpServers: { hostile: { command: "hostile-mcp" } },
      tools: { discoveryCommand: "hostile-discovery" },
    }));

    const env = prepareGeminiCliRuntimeEnvironment({
      invocationRoot,
      toolRuntimeRoot: join(invocationRoot, "tool-runtime"),
      readableRoots: [],
      writableRoots: [],
      readProtectedPaths: [],
      writeProtectedPaths: [],
      readProtectedRoots: [],
      protectedRuntimeRoot: join(invocationRoot, "protected-runtime"),
    }, {
      [GEMINI_CLI_HOME_ENV]: sourceHome,
      [GEMINI_FORCE_FILE_STORAGE_ENV]: "false",
      KOTA_RUN_DIR: "/project/.kota/run",
    });
    const runtimeHome = join(invocationRoot, "gemini-provider-home");
    const runtimeDirectory = join(runtimeHome, ".gemini");

    expect(env).toMatchObject({
      [GEMINI_CLI_HOME_ENV]: runtimeHome,
      [GEMINI_FORCE_FILE_STORAGE_ENV]: "true",
      [GEMINI_CLI_SYSTEM_SETTINGS_PATH_ENV]: join(
        invocationRoot,
        "protected-runtime",
        "kota-system-settings.json",
      ),
      [GEMINI_CLI_SYSTEM_DEFAULTS_PATH_ENV]: join(
        invocationRoot,
        "protected-runtime",
        "kota-system-defaults.json",
      ),
      KOTA_RUN_DIR: "/project/.kota/run",
    });
    expect(JSON.parse(readFileSync(join(runtimeDirectory, "settings.json"), "utf8")))
      .toEqual({ security: { auth: { selectedType: "oauth-personal" } } });
    expect(JSON.parse(readFileSync(
      env[GEMINI_CLI_SYSTEM_SETTINGS_PATH_ENV]!,
      "utf8",
    ))).toMatchObject({
      admin: {
        secureModeEnabled: true,
        extensions: { enabled: false },
        mcp: { enabled: false },
        skills: { enabled: false },
      },
      advanced: { ignoreLocalEnv: true },
      security: {
        blockGitExtensions: true,
        environmentVariableRedaction: {
          enabled: true,
          blocked: [
            "GEMINI_CLI_HOME",
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
          ],
        },
      },
    });
    expect(() => readFileSync(join(runtimeDirectory, "GEMINI.md"), "utf8"))
      .toThrow();
    expect(() => readFileSync(join(runtimeDirectory, ".env"), "utf8"))
      .toThrow();
  });
});
