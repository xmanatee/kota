import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyTaskProbeLinkedInode,
  findExternalHardLinkWriteProtections,
} from "./task-probe-hard-links.js";

function makeFifo(path: string): void {
  const executable = ["/usr/bin/mkfifo", "/bin/mkfifo"].find((candidate) =>
    existsSync(candidate),
  );
  if (executable === undefined) throw new Error("mkfifo is unavailable");
  const result = spawnSync(executable, [path], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`mkfifo failed: ${result.stderr}`);
  }
}

describe("Runtime Probe workspace hard-link inspection", () => {
  it.runIf(process.platform !== "win32")(
    "freezes external hard-link aliases without freezing workspace-only aliases",
    () => {
      const fixture = mkdtempSync(join(tmpdir(), "kota-probe-hard-links-"));
      const workspace = join(fixture, "project");
      const sourceDirectory = join(workspace, "src");
      mkdirSync(sourceDirectory, { recursive: true });

      const internal = join(workspace, "internal.txt");
      writeFileSync(internal, "internal");
      linkSync(internal, join(sourceDirectory, "internal-alias.txt"));

      const outsideTreeFile = join(fixture, "outside-tree.txt");
      writeFileSync(outsideTreeFile, "outside tree");
      linkSync(outsideTreeFile, join(sourceDirectory, "outside-alias.txt"));

      const outsideRootFile = join(fixture, "outside-root.txt");
      const rootAlias = join(workspace, "outside-root-alias.txt");
      writeFileSync(outsideRootFile, "outside root");
      linkSync(outsideRootFile, rootAlias);

      try {
        expect(findExternalHardLinkWriteProtections(workspace)).toEqual([
          { path: rootAlias, kind: "file" },
          { path: sourceDirectory, kind: "tree" },
        ]);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects an ordinary single-link FIFO before sandbox launch",
    () => {
      const fixture = mkdtempSync(join(tmpdir(), "kota-probe-fifo-link-"));
      const workspace = join(fixture, "project");
      mkdirSync(workspace);
      makeFifo(join(workspace, "host.fifo"));

      try {
        expect(() => findExternalHardLinkWriteProtections(workspace)).toThrow(
          /contains a FIFO.*refusing execution.*namespace boundaries/,
        );
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    },
  );

  it.runIf(process.platform === "linux")(
    "rejects an ordinary pathname Unix socket before sandbox launch",
    async () => {
      const fixture = mkdtempSync(join(tmpdir(), "kota-probe-socket-"));
      const workspace = join(fixture, "project");
      const socketPath = join(workspace, "host.sock");
      mkdirSync(workspace);
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolve);
      });

      try {
        expect(() => findExternalHardLinkWriteProtections(workspace)).toThrow(
          /contains a socket.*refusing execution.*namespace boundaries/,
        );
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        });
        rmSync(fixture, { recursive: true, force: true });
      }
    },
  );

  it("classifies Unix sockets as special inodes that cannot use write-only protection", () => {
    expect(classifyTaskProbeLinkedInode({
      isFile: () => false,
      isFIFO: () => false,
      isSocket: () => true,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
    })).toBe("socket");
  });
});
