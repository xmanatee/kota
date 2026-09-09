import type { SpawnOptions } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as egress from "#core/agent-harness/native-cli-egress-proxy.js";
import type { AgentHarnessRunOptions } from "#core/agent-harness/types.js";
import * as config from "#core/config/config.js";
import { codexAgentHarness } from "./adapter.js";

const roots: string[] = [];
const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn,
}));
afterEach(() => {
  spawn.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(directoryLink: boolean) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "kota-config-authority-")));
  roots.push(root);
  const workspace = join(root, "workspace");
  const target = join(root, "shared", "config.toml");
  const sourceHome = join(root, "login");
  for (const path of [workspace, dirname(target), sourceHome]) mkdirSync(path);
  writeFileSync(target, 'model = "shared-model"\n');
  if (directoryLink) symlinkSync(dirname(target), join(workspace, ".codex"));
  else {
    mkdirSync(join(workspace, ".codex"));
    symlinkSync(target, join(workspace, ".codex", "config.toml"));
  }
  return { workspace, target, sourceHome };
}

function grantedPaths(config: string): string[] {
  return config.split("\n").flatMap((line) => {
    const match = line.match(/^("(?:[^"\\]|\\.)*") = "(?:read|write)"$/);
    return match ? [JSON.parse(match[1]!) as string] : [];
  });
}

async function launchProfile(
  workspace: string,
  sourceHome: string,
  readOnlyHostRoots?: readonly string[],
  options: Pick<AgentHarnessRunOptions, "authorityConfigPath" | "agentWriteScope" | "agentOutputDir"> = {},
): Promise<string> {
  vi.spyOn(egress, "startNativeCliEgressProxy").mockResolvedValue({
    address: { kind: "tcp", host: "127.0.0.1", port: 43217 },
    close: async () => {},
  });
  let profile: string | undefined;
  const stop = new Error("Captured provider launch");
  spawn.mockImplementation((_command: string, _args: string[], options: SpawnOptions) => {
    profile = readFileSync(join(options.env!.CODEX_HOME!, "config.toml"), "utf8");
    throw stop;
  });
  await expect(codexAgentHarness.run({
    prompt: "Inspect configuration", cwd: workspace, model: "test", effort: "low",
    agentWriteScope: "deny-all",
    ...options,
    ...(readOnlyHostRoots === undefined ? {} : { readOnlyHostRoots }),
    env: { CODEX_HOME: sourceHome, PATH: "/usr/bin:/bin" },
  })).rejects.toBe(stop);
  expect(profile).toBeDefined();
  return profile!;
}

// Owner portfolio: native agents rely on the adapter's generated permission
// profile. Control only provider/network ports; exercise real root projection.
describe("Codex configuration read authority", () => {
  it.each([false, true])("does not grant external configuration link targets (directory link: %s)", async (directoryLink) => {
    const { workspace, target, sourceHome } = fixture(directoryLink);
    const profile = await launchProfile(workspace, sourceHome);
    const grants = grantedPaths(profile);
    expect(grants).toContain(workspace);
    expect(profile).not.toContain(target);
    expect(grants.filter((path) => path.startsWith("/"))).not.toSatisfy((paths: string[]) =>
      paths.some((path) => {
        const child = relative(path, target);
        return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
      })
    );
  });

  it.each(["file", "directory"] as const)("preserves an independent runtime %s grant for shared configuration", async (grant) => {
    const { workspace, target, sourceHome } = fixture(false);
    const authorizedRoot = grant === "file" ? target : dirname(target);
    const profile = await launchProfile(workspace, sourceHome, [authorizedRoot]);
    expect(profile).toContain(`${JSON.stringify(authorizedRoot)} = "read"`);
    expect(grantedPaths(profile)).toContain(workspace);
  });
});

describe("Codex machine authority protection", () => {
  it.each(["default", "custom"] as const)(
    "does not grant reads to an external %s authority directory or ungranted child files",
    async (location) => {
      const { workspace, sourceHome } = fixture(false);
      const authorityDirectory = join(dirname(workspace), "authority");
      mkdirSync(authorityDirectory);
      const configPath = join(authorityDirectory, "config.json");
      writeFileSync(configPath, "{}");
      vi.stubEnv("KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH", "");
      if (location === "default") {
        vi.spyOn(config, "getGlobalConfigPath").mockReturnValue(configPath);
      }
      const options = location === "custom" ? { authorityConfigPath: configPath } : {};
      for (const grants of [[], [configPath]]) {
        const profile = await launchProfile(workspace, sourceHome, grants, options);
        const absoluteGrants = grantedPaths(profile).filter((path) => path.startsWith("/"));
        for (const target of [authorityDirectory, join(authorityDirectory, "secrets.json"), join(authorityDirectory, ".env")]) {
          expect(absoluteGrants).not.toSatisfy((paths: string[]) => paths.some((path) => {
            const child = relative(path, target);
            return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
          }));
        }
        expect(profile).not.toContain(`${JSON.stringify(authorityDirectory)} = "deny"`);
        if (grants.length > 0) expect(profile).toContain(`${JSON.stringify(configPath)} = "read"`);
        expect(profile).toContain(`${JSON.stringify(join(authorityDirectory, "scope-authority-token.json"))} = "deny"`);
      }
    },
  );

  it.each(["workspace", "host", "directory-alias", "file-alias"] as const)(
    "protects custom authority and token paths against overlapping grants (%s)",
    async (location) => {
      const { workspace, sourceHome } = fixture(false);
      const host = dirname(workspace);
      const authorityDirectory = join(location === "workspace" ? workspace : host, "authority");
      mkdirSync(authorityDirectory);
      const configPath = join(authorityDirectory, "config.json");
      writeFileSync(configPath, "{}");
      const tokenPath = join(authorityDirectory, "scope-authority-token.json");
      // Synthetic paths only: even a missing token must receive a denial.
      const externalToken = join(host, "operator-token.json");
      const tokenAlias = join(workspace, "token-alias.json");
      symlinkSync(externalToken, tokenAlias);
      if (location === "workspace") {
        writeFileSync(externalToken, "synthetic operator credential");
        symlinkSync(externalToken, tokenPath);
      }
      vi.stubEnv("KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH", tokenAlias);
      let authorityConfigPath = configPath;
      if (location === "directory-alias") {
        const alias = join(workspace, "authority-alias");
        symlinkSync(authorityDirectory, alias);
        authorityConfigPath = join(alias, "config.json");
      } else if (location === "file-alias") {
        const alias = join(workspace, "authority-alias");
        mkdirSync(alias);
        authorityConfigPath = join(alias, "config.json");
        symlinkSync(configPath, authorityConfigPath);
      }
      const output = join(authorityDirectory, "output");
      const profile = await launchProfile(workspace, sourceHome, [host, tokenAlias, tokenPath], {
        authorityConfigPath,
        agentWriteScope: undefined,
        agentOutputDir: output,
      });
      expect(profile).toContain(`${JSON.stringify(workspace)} = "write"`);
      for (const path of [authorityDirectory, dirname(authorityConfigPath), output]) {
        expect(profile).toContain(`${JSON.stringify(path)} = "read"`);
        expect(profile).not.toContain(`${JSON.stringify(path)} = "write"`);
      }
      const configuredToken = join(dirname(authorityConfigPath), "scope-authority-token.json");
      for (const path of [configuredToken, tokenAlias, externalToken]) {
        expect(profile).toContain(`${JSON.stringify(path)} = "deny"`);
        expect(grantedPaths(profile)).not.toContain(path);
      }
    },
  );

  it("protects the default authority directory and operator token", async () => {
    const { workspace, sourceHome } = fixture(false);
    const authorityDirectory = join(workspace, "machine");
    vi.spyOn(config, "getGlobalConfigPath").mockReturnValue(join(authorityDirectory, "config.json"));
    vi.stubEnv("KOTA_SCOPE_AUTHORITY_OPERATOR_TOKEN_PATH", "");
    const profile = await launchProfile(workspace, sourceHome, [], { agentWriteScope: undefined });
    expect(profile).toContain(`${JSON.stringify(authorityDirectory)} = "read"`);
    expect(profile).toContain(`${JSON.stringify(join(authorityDirectory, "scope-authority-token.json"))} = "deny"`);
  });
});
