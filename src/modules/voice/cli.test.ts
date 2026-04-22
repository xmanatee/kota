/**
 * CLI integration test — spins up a tiny HTTP server that mimics the
 * daemon-control voice routes, points DaemonControlClient at it via the
 * `.kota/daemon-control.json` state file, and runs the voice commands
 * end-to-end. This is the "real client of the daemon" round-trip that
 * the task contract requires for the CLI surface.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildVoiceCommand } from "./cli.js";

type Captured = { exit: number | null; stdout: string[]; stderr: string[] };

function startStubDaemon(handlers: {
  transcribe?: (body: Record<string, unknown>) => { status: number; body: unknown };
  synthesize?: (body: Record<string, unknown>) => { status: number; body: unknown };
}): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        const body = JSON.parse(raw) as Record<string, unknown>;
        let response: { status: number; body: unknown } | null = null;
        if (req.method === "POST" && req.url === "/voice/transcribe" && handlers.transcribe) {
          response = handlers.transcribe(body);
        } else if (req.method === "POST" && req.url === "/voice/synthesize" && handlers.synthesize) {
          response = handlers.synthesize(body);
        }
        if (!response) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(response.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response.body));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

async function runCommand(args: string[], captured: Captured): Promise<void> {
  const cmd = buildVoiceCommand();
  cmd.exitOverride((err) => {
    captured.exit = err.exitCode;
    throw err;
  });
  cmd.configureOutput({
    writeOut: (s) => captured.stdout.push(s),
    writeErr: (s) => captured.stderr.push(s),
  });
  try {
    await cmd.parseAsync(args, { from: "user" });
  } catch {
    // commander throws on --exitOverride; captured.exit holds the code
  }
}

describe("voice CLI (daemon-client round-trip)", () => {
  let stateDir: string;
  let previousCwd: string;
  let restoreExit: () => void;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "kota-voice-cli-"));
    previousCwd = process.cwd();
    mkdirSync(join(stateDir, ".kota"), { recursive: true });
    process.chdir(stateDir);
    const origExit = process.exit.bind(process);
    const spy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
    restoreExit = () => {
      spy.mockRestore();
      void origExit;
    };
  });

  afterEach(() => {
    process.chdir(previousCwd);
    rmSync(stateDir, { recursive: true, force: true });
    restoreExit();
  });

  function writeControlAddress(port: number): void {
    writeFileSync(
      join(stateDir, ".kota", "daemon-control.json"),
      JSON.stringify({ port, pid: process.pid, startedAt: new Date().toISOString(), token: "" }),
    );
  }

  it("transcribes an audio file through the daemon and prints the text", async () => {
    const { server, port } = await startStubDaemon({
      transcribe: (body) => ({
        status: 200,
        body: { text: `len=${(body.audioBase64 as string).length}`, language: "en" },
      }),
    });
    try {
      writeControlAddress(port);
      const audioPath = join(stateDir, "clip.wav");
      writeFileSync(audioPath, Buffer.from([1, 2, 3, 4, 5]));
      const captured: Captured = { exit: null, stdout: [], stderr: [] };
      const logs: string[] = [];
      const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
        logs.push(args.map(String).join(" "));
      });
      await runCommand(["transcribe", audioPath], captured);
      spy.mockRestore();
      expect(logs.join("\n")).toMatch(/len=/);
    } finally {
      server.close();
    }
  });

  it("surfaces a non-ok daemon response as a CLI failure", async () => {
    const { server, port } = await startStubDaemon({
      transcribe: () => ({
        status: 503,
        body: { error: "No transcription provider is registered", code: "stt-unavailable" },
      }),
    });
    try {
      writeControlAddress(port);
      const audioPath = join(stateDir, "clip.wav");
      writeFileSync(audioPath, Buffer.from([1]));
      const captured: Captured = { exit: null, stdout: [], stderr: [] };
      const errorLogs: string[] = [];
      const errSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
        errorLogs.push(args.map(String).join(" "));
      });
      await runCommand(["transcribe", audioPath], captured);
      errSpy.mockRestore();
      expect(errorLogs.join("\n")).toMatch(/stt-unavailable/);
    } finally {
      server.close();
    }
  });

  it("writes synthesized audio to the --output path", async () => {
    const audioBytes = Buffer.from([9, 8, 7, 6]);
    const { server, port } = await startStubDaemon({
      synthesize: () => ({
        status: 200,
        body: {
          audioBase64: audioBytes.toString("base64"),
          mimeType: "audio/mpeg",
          format: "mp3",
        },
      }),
    });
    try {
      writeControlAddress(port);
      const outPath = join(stateDir, "out.mp3");
      const captured: Captured = { exit: null, stdout: [], stderr: [] };
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await runCommand(["speak", "hello world", "--output", outPath, "--no-play"], captured);
      errSpy.mockRestore();
      const written = readFileSync(outPath);
      expect(Array.from(written)).toEqual([9, 8, 7, 6]);
    } finally {
      server.close();
    }
  });
});
