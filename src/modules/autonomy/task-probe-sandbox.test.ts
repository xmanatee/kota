import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessLinuxCoreDumpBoundary,
  buildLinuxTaskProbeSandbox,
} from "./task-probe-sandbox-spec.js";

function makeWorkspace(): string {
  const workspace = join(
    tmpdir(),
    `kota-probe-sandbox-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, ".git"), "gitdir: /readonly/gitdir\n");
  return workspace;
}

describe("Runtime Probe OS sandbox specifications", () => {
  it("builds a Linux empty-root, disposable workspace overlay, and PID namespace", () => {
    const workspace = makeWorkspace();
    const hardLinkPath = join(workspace, "host-hard-link.txt");
    writeFileSync(hardLinkPath, "host alias");
    const nodeExecutable = "/opt/kota-node/bin/node";
    const pnpmExecutable = "/opt/kota-pnpm/bin/pnpm";
    const pnpmRuntimePath = "/opt/kota-pnpm";
    const sandbox = buildLinuxTaskProbeSandbox(
      workspace,
      5_000,
      "/usr/bin/bwrap",
      "/usr/bin/prlimit",
      { nodeExecutable, pnpmExecutable, pnpmRuntimePath },
      {
        status: "available",
        evidence: "test non-piped core pattern and hard-zero limit",
      },
      [{ path: hardLinkPath, kind: "file" }],
    );
    const args = sandbox.prefixArgs;

    expect(sandbox).toMatchObject({
      command: "/usr/bin/prlimit",
      kind: "linux-bubblewrap",
      processBoundary: "pid-namespace",
      probeExecutable: pnpmExecutable,
    });
    expect(args).toContain("--cpu=5:5");
    expect(args).toContain("--nproc=256:256");
    expect(args).toContain("--nofile=1024:1024");
    expect(args).toContain("--core=0:0");
    expect(args).toContain("--unshare-all");
    expect(args).toContain("--disable-userns");
    expect(args).toContain("--die-with-parent");
    expect(args).toContain("--new-session");
    expect(args).not.toContain("--seccomp");
    expect(args).toContain("--dev");
    expect(args).toContain("--proc");
    expect(args.slice(args.indexOf("--tmpfs"), args.indexOf("--tmpfs") + 2))
      .toEqual(["--tmpfs", "/tmp"]);

    const readOnlySources = args.flatMap((arg, index) =>
      arg === "--ro-bind" ? [args[index + 1]] : [],
    );
    expect(readOnlySources).not.toContain("/");
    expect(readOnlySources).not.toContain("/run");
    expect(readOnlySources).not.toContain("/var");
    expect(readOnlySources).toContain(nodeExecutable);
    expect(readOnlySources).toContain(pnpmRuntimePath);
    expect(readOnlySources).toContain(hardLinkPath);
    expect(args.filter((arg) => arg === hardLinkPath)).toHaveLength(2);

    expect(args).not.toContain("--bind");
    const workspaceOverlay = args.indexOf("--overlay-src");
    expect(args.slice(workspaceOverlay, workspaceOverlay + 4)).toEqual([
      "--overlay-src",
      workspace,
      "--tmp-overlay",
      workspace,
    ]);
    expect(args.filter((arg) => arg === join(workspace, ".git"))).toHaveLength(2);
    const pathSetting = args.indexOf("--setenv");
    expect(args.slice(pathSetting, pathSetting + 3)).toEqual([
      "--setenv",
      "PATH",
      "/opt/kota-pnpm/bin:/opt/kota-node/bin:/usr/local/bin:/usr/bin:/bin",
    ]);
    expect(args).not.toContain("/usr/bin/setpriv");
    expect(sandbox.evidence).toContain(
      "test non-piped core pattern and hard-zero limit",
    );
  });

  it.each(["|/usr/lib/systemd/systemd-coredump", "  |/sbin/core-helper %P"])(
    "rejects a host pipe core handler: %s",
    (corePattern) => {
      expect(assessLinuxCoreDumpBoundary(corePattern)).toEqual({
        status: "unavailable",
        reason:
          "Runtime Probe execution refused because Linux core_pattern invokes a host pipe handler; RLIMIT_CORE=0 does not suppress piped handlers, and sandbox namespaces cannot contain a handler launched in the host's initial namespaces.",
      });
    },
  );

  it("accepts only a file-based core pattern behind the hard-zero core limit", () => {
    expect(assessLinuxCoreDumpBoundary("core.%p\n")).toEqual({
      status: "available",
      evidence:
        "host core_pattern verified non-piped before launch and RLIMIT_CORE locked at zero",
    });
    expect(assessLinuxCoreDumpBoundary("\n")).toMatchObject({
      status: "unavailable",
    });
  });

  it("keeps the core hard limit before Bubblewrap launch", () => {
    const workspace = makeWorkspace();
    const coreDumpBoundary = assessLinuxCoreDumpBoundary("core");
    if (coreDumpBoundary.status === "unavailable") {
      throw new Error(coreDumpBoundary.reason);
    }
    const sandbox = buildLinuxTaskProbeSandbox(
      workspace,
      5_000,
      "/usr/bin/bwrap",
      "/usr/bin/prlimit",
      {
        nodeExecutable: "/usr/bin/node",
        pnpmExecutable: "/usr/bin/pnpm",
        pnpmRuntimePath: "/usr/lib/node_modules/pnpm",
      },
      coreDumpBoundary,
    );

    expect(sandbox.prefixArgs.indexOf("--core=0:0")).toBeLessThan(
      sandbox.prefixArgs.indexOf("/usr/bin/bwrap"),
    );
  });
});
