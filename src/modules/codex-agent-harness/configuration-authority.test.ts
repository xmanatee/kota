import type { SpawnOptions } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as egress from "#core/agent-harness/native-cli-egress-proxy.js";
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
