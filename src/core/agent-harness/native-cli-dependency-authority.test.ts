import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMachineAuthoritySandboxLaunch } from "./machine-authority-sandbox.js";
import { withNativeCliSandbox } from "./native-cli-sandbox.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Owner portfolio: native agents rely on launch grants rejecting scope-controlled
// dependency links. Inspect both OS launch contracts without requiring either OS.
describe("native dependency read authority", () => {
  it.each([false, true])(
    "requires an independent runtime grant for a linked store (authorized: %s)",
    async (authorized) => {
      const root = realpathSync.native(mkdtempSync(join(tmpdir(), "kota-dependency-authority-")));
      roots.push(root);
      const parent = join(root, "project");
      const workspace = join(parent, "workspace");
      const store = join(root, "package-store");
      // Even a target named node_modules is not authority to read host files.
      const host = join(root, "operator", "node_modules");
      const inherited = join(root, "node_modules");
      for (const path of [workspace, store, host, inherited]) mkdirSync(path, { recursive: true });
      symlinkSync(store, join(workspace, "node_modules"));
      symlinkSync(host, join(parent, "node_modules"));

      await withNativeCliSandbox("/bin/sh", [], {
        cwd: workspace,
        machineAuthorityOwner: "native-cli",
        writableRoots: [],
        readOnlyHostRoots: authorized ? [store] : [],
        env: {},
        prepareEnvironment: (context, env) => {
          expect(context.readableRoots).toContain(inherited);
          expect(context.readableRoots).not.toContain(host);
          expect(context.readableRoots.includes(store)).toBe(authorized);

          for (const platform of ["darwin", "linux"] as const) {
            const launch = buildMachineAuthoritySandboxLaunch("/bin/sh", [], {
              cwd: workspace,
              authorityConfigPath: join(root, "authority", "config.json"),
              readableRoots: context.readableRoots,
              writableRoots: [],
              platform,
              pathExists: (path) => path === "/usr/bin/bwrap" || path === "/usr/bin/sandbox-exec" || existsSync(path),
            });
            if (!launch.ok) throw new Error(launch.error);
            if (platform === "darwin") {
              const profile = launch.args[1];
              expect(profile).toContain(`(subpath "${inherited}")`);
              expect(profile).not.toContain(host);
              expect(profile?.includes(`(subpath "${store}")`)).toBe(authorized);
            } else {
              const mounts = launch.args.flatMap((arg, index) =>
                arg === "--ro-bind" ? [launch.args[index + 1]] : []
              );
              expect(mounts).toContain(inherited);
              expect(mounts).not.toContain(host);
              expect(mounts.includes(store)).toBe(authorized);
            }
          }
          return env;
        },
      }, async () => undefined);
    },
  );
});
