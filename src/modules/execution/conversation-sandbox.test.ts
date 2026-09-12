import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROTECTED_CONVERSATION_DIRECTORY } from "#core/tools/protected-scope-paths.js";
import { DONE_MARKER } from "./code-wrappers.js";
import { startProcess } from "./process-core.js";
import { REPLSession } from "./repl-session.js";
import { runShell } from "./shell.js";

const launches = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: launches,
}));

const roots: string[] = [];
afterEach(() => {
  launches.mockReset();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("conversation restrictions at execution launch", () => {
  it.runIf(process.platform === "darwin")("rebuilds a persistent REPL sandbox when the canonical scope changes", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "kota-repl-scope-change-")));
    roots.push(root);
    launches.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
        kill: vi.fn(),
      });
      child.stdin.on("data", () => queueMicrotask(() => child.stdout.write(`2\n${DONE_MARKER}\n`)));
      return child;
    });
    const repl = new REPLSession("node");
    const context = { cwd: root, authorityConfigPath: join(root, "authority", "config.json") };
    try {
      for (const scope of ["first", "second"]) {
        const result = await repl.execute("1 + 1", 1000, { ...context, scopeRoot: join(root, scope) });
        expect(result).toEqual({ output: "2", isError: false });
      }
      expect(launches).toHaveBeenCalledTimes(2);
      expect(launches.mock.calls[1]![1][1]).toContain(
        `(subpath ${JSON.stringify(join(root, "second", PROTECTED_CONVERSATION_DIRECTORY))})`,
      );
    } finally {
      repl.kill();
    }
  });

  it.runIf(process.platform === "darwin").each(["shell", "process", "node", "python"] as const)(
    "%s denies the canonical, workspace and relocated stores at the process port",
    async (kind) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "kota-execution-conversation-")));
      roots.push(root);
      const cwd = join(root, "writer");
      const scopeRoot = join(root, "scope");
      const privateRoot = join(root, "relocated-store");
      const canonicalStore = join(scopeRoot, PROTECTED_CONVERSATION_DIRECTORY);
      const workspaceStore = join(cwd, PROTECTED_CONVERSATION_DIRECTORY);
      mkdirSync(cwd);
      mkdirSync(dirname(canonicalStore), { recursive: true });
      mkdirSync(privateRoot);
      symlinkSync(privateRoot, canonicalStore);
      launches.mockImplementation(() => {
        const child = Object.assign(new EventEmitter(), {
          stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
          kill: vi.fn(),
        });
        queueMicrotask(() => { child.emit("exit", 0); child.emit("close", 0); });
        return child;
      });
      const context = { cwd, scopeRoot, authorityConfigPath: join(root, "authority", "config.json") };
      if (kind === "shell") {
        await runShell({ command: "true", cwd: root, stream_output: false }, context);
      } else if (kind === "process") {
        await startProcess("true", context);
      } else {
        await new REPLSession(kind).execute("1 + 1", 1000, context);
      }
      const [command, args] = launches.mock.calls[0]!;
      expect(command).toBe("/usr/bin/sandbox-exec");
      const profile: string = args[1];
      const readDenial = profile.split("\n").filter((line) => line.startsWith("(deny file-read*" )).join("\n");
      const writeDenial = profile.split("\n").filter((line) => line.startsWith("(deny file-write*" )).join("\n");
      for (const store of [canonicalStore, workspaceStore, privateRoot]) {
        // Subpath rules cover current, sibling, retired and future transcripts.
        const selector = `(subpath ${JSON.stringify(store)})`;
        expect(readDenial).toContain(selector);
        expect(writeDenial).toContain(selector);
      }
      expect(readDenial).not.toContain(`(subpath ${JSON.stringify(cwd)})`);
      expect(writeDenial).not.toContain(`(subpath ${JSON.stringify(cwd)})`);
    },
  );
});
