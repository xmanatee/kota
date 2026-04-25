/**
 * Voice CLI tests through `ctx.client.voice` — the new namespace contract.
 *
 * Tests stub a `ModuleContext` with a fake `VoiceClient` and exercise both
 * the success path and the daemon-down (`daemon_required`) path the local
 * handler returns when no daemon is reachable.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  VoiceClient,
  VoiceSynthesizeResult,
  VoiceTranscribeResult,
} from "#core/server/kota-client.js";
import { buildVoiceCommand } from "./cli.js";
import { localVoiceClient } from "./voice-operations.js";

function stubCtx(voice: VoiceClient): ModuleContext {
  return { client: { voice } } as unknown as ModuleContext;
}

type Captured = { exit: number | null; stderr: string[]; stdout: string[] };

async function runCommand(
  cmd: ReturnType<typeof buildVoiceCommand>,
  args: string[],
  captured: Captured,
): Promise<void> {
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
    // commander throws on exitOverride; captured.exit holds the code
  }
}

describe("voice CLI (ctx.client.voice contract)", () => {
  let stateDir: string;
  let restoreExit: () => void;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "kota-voice-cli-"));
    mkdirSync(join(stateDir, ".kota"), { recursive: true });
    const spy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);
    restoreExit = () => {
      spy.mockRestore();
    };
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    restoreExit();
  });

  it("transcribes through the namespace and prints the text", async () => {
    const voice: VoiceClient = {
      async transcribe(opts) {
        return {
          ok: true,
          text: `len=${opts.audio.length}`,
          language: "en",
        };
      },
      async synthesize() {
        throw new Error("not used");
      },
    };
    const cmd = buildVoiceCommand(stubCtx(voice));
    const audioPath = join(stateDir, "clip.wav");
    writeFileSync(audioPath, Buffer.from([1, 2, 3, 4, 5]));
    const captured: Captured = { exit: null, stdout: [], stderr: [] };
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });
    await runCommand(cmd, ["transcribe", audioPath], captured);
    spy.mockRestore();
    expect(logs.join("\n")).toMatch(/len=5/);
  });

  it("surfaces daemon_required as the daemon-not-running hint", async () => {
    const voice = localVoiceClient();
    const cmd = buildVoiceCommand(stubCtx(voice));
    const audioPath = join(stateDir, "clip.wav");
    writeFileSync(audioPath, Buffer.from([1]));
    const captured: Captured = { exit: null, stdout: [], stderr: [] };
    const errorLogs: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorLogs.push(args.map(String).join(" "));
    });
    await runCommand(cmd, ["transcribe", audioPath], captured);
    errSpy.mockRestore();
    expect(errorLogs.join("\n")).toMatch(/Daemon is not running/);
  });

  it("surfaces a non-ok daemon response as a CLI failure with code", async () => {
    const voice: VoiceClient = {
      async transcribe(): Promise<VoiceTranscribeResult> {
        return {
          ok: false,
          reason: "transport_error",
          status: 503,
          message: "No transcription provider is registered",
          code: "stt-unavailable",
        };
      },
      async synthesize() {
        throw new Error("not used");
      },
    };
    const cmd = buildVoiceCommand(stubCtx(voice));
    const audioPath = join(stateDir, "clip.wav");
    writeFileSync(audioPath, Buffer.from([1]));
    const captured: Captured = { exit: null, stdout: [], stderr: [] };
    const errorLogs: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorLogs.push(args.map(String).join(" "));
    });
    await runCommand(cmd, ["transcribe", audioPath], captured);
    errSpy.mockRestore();
    expect(errorLogs.join("\n")).toMatch(/stt-unavailable/);
  });

  it("writes synthesized audio to the --output path", async () => {
    const audioBytes = Buffer.from([9, 8, 7, 6]);
    const voice: VoiceClient = {
      async transcribe() {
        throw new Error("not used");
      },
      async synthesize(): Promise<VoiceSynthesizeResult> {
        return {
          ok: true,
          audio: audioBytes,
          mimeType: "audio/mpeg",
          format: "mp3",
        };
      },
    };
    const cmd = buildVoiceCommand(stubCtx(voice));
    const outPath = join(stateDir, "out.mp3");
    const captured: Captured = { exit: null, stdout: [], stderr: [] };
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await runCommand(
      cmd,
      ["speak", "hello world", "--output", outPath, "--no-play"],
      captured,
    );
    errSpy.mockRestore();
    const written = readFileSync(outPath);
    expect(Array.from(written)).toEqual([9, 8, 7, 6]);
  });

  it("surfaces synthesize daemon_required cleanly", async () => {
    const voice = localVoiceClient();
    const cmd = buildVoiceCommand(stubCtx(voice));
    const captured: Captured = { exit: null, stdout: [], stderr: [] };
    const errorLogs: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errorLogs.push(args.map(String).join(" "));
    });
    await runCommand(cmd, ["speak", "hi", "--no-play"], captured);
    errSpy.mockRestore();
    expect(errorLogs.join("\n")).toMatch(/Daemon is not running/);
  });
});
