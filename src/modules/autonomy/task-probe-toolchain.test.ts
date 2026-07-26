import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveTaskProbeToolchain } from "./task-probe-toolchain.js";

const originalPath = process.env.PATH;

afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
});

function makeFixture(): {
  root: string;
  workspace: string;
  pnpmRoot: string;
  pnpmExecutable: string;
} {
  const root = join(
    tmpdir(),
    `kota-probe-toolchain-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const workspace = join(root, "workspace");
  const pnpmRoot = join(root, "host-tools", "pnpm");
  const pnpmBin = join(pnpmRoot, "bin");
  const pnpmExecutable = join(pnpmBin, "pnpm");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(pnpmBin, { recursive: true });
  writeFileSync(join(pnpmRoot, "package.json"), '{"name":"pnpm"}');
  writeFileSync(pnpmExecutable, "#!/bin/sh\nexit 0\n");
  chmodSync(pnpmExecutable, 0o755);
  return { root, workspace, pnpmRoot, pnpmExecutable };
}

describe("Runtime Probe host toolchain", () => {
  it("pins the canonical pnpm package runtime from an absolute PATH entry", () => {
    const fixture = makeFixture();
    process.env.PATH = join(fixture.pnpmRoot, "bin");

    const result = resolveTaskProbeToolchain(fixture.workspace);

    expect(result).toEqual({
      status: "available",
      toolchain: {
        nodeExecutable: realpathSync(process.execPath),
        pnpmExecutable: fixture.pnpmExecutable,
        pnpmRuntimePath: fixture.pnpmRoot,
      },
    });
  });

  it("rejects relative PATH entries", () => {
    const fixture = makeFixture();
    process.env.PATH = "host-tools/pnpm/bin";

    expect(resolveTaskProbeToolchain(fixture.workspace)).toMatchObject({
      status: "unavailable",
    });
  });

  it("rejects a pnpm runtime inside the mutable project", () => {
    const fixture = makeFixture();
    process.env.PATH = join(fixture.pnpmRoot, "bin");

    expect(resolveTaskProbeToolchain(fixture.root)).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("outside the mutable project"),
    });
  });
});
