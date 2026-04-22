import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WhisperLocalProvider, WhisperLocalTranscriptionError } from "./provider.js";

type MockChild = EventEmitter & { stderr: EventEmitter; kill: (signal: string) => boolean };

function makeSpawn(options: {
  writeResultJson?: (audioPath: string) => void;
  exitCode?: number;
  spawnError?: Error;
  stderr?: string;
}): typeof import("node:child_process").spawn {
  return ((_bin: string, args: string[]) => {
    const child = new EventEmitter() as MockChild;
    child.stderr = new EventEmitter();
    child.kill = () => true;
    const audioFlag = args.indexOf("--file");
    const audioPath = audioFlag >= 0 ? args[audioFlag + 1] : null;
    queueMicrotask(() => {
      if (options.spawnError) {
        child.emit("error", options.spawnError);
        return;
      }
      if (options.stderr) child.stderr.emit("data", Buffer.from(options.stderr));
      if (options.exitCode === undefined || options.exitCode === 0) {
        if (audioPath && options.writeResultJson) options.writeResultJson(audioPath);
        child.emit("close", 0);
      } else {
        child.emit("close", options.exitCode);
      }
    });
    return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
  }) as typeof import("node:child_process").spawn;
}

describe("WhisperLocalProvider", () => {
  it("returns transcribed text and language from whisper-cli JSON output", async () => {
    const spawnImpl = makeSpawn({
      writeResultJson: (audioPath) => {
        writeFileSync(
          `${audioPath}.json`,
          JSON.stringify({
            transcription: [
              { text: " hello " },
              { text: " world" },
            ],
            result: { language: "en" },
          }),
        );
      },
    });
    const provider = new WhisperLocalProvider({
      binaryPath: "/usr/bin/whisper-cli",
      modelPath: "/models/ggml-base.en.bin",
      timeoutMs: 5000,
      spawnImpl,
    });
    const result = await provider.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      mimeType: "audio/wav",
    });
    expect(result.text).toBe("hello  world");
    expect(result.language).toBe("en");
  });

  it("passes languageHint through as --language", async () => {
    const capturedArgs: string[] = [];
    const spawnImpl: typeof import("node:child_process").spawn = ((
      _bin: string,
      args: string[],
    ) => {
      capturedArgs.push(...args);
      const child = new EventEmitter() as MockChild;
      child.stderr = new EventEmitter();
      child.kill = () => true;
      queueMicrotask(() => {
        const idx = args.indexOf("--file");
        if (idx >= 0) {
          writeFileSync(`${args[idx + 1]}.json`, JSON.stringify({ transcription: [{ text: "x" }] }));
        }
        child.emit("close", 0);
      });
      return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    }) as typeof import("node:child_process").spawn;
    const provider = new WhisperLocalProvider({
      binaryPath: "/x",
      modelPath: "/m",
      timeoutMs: 5000,
      spawnImpl,
    });
    await provider.transcribe({
      audio: new Uint8Array([0]),
      mimeType: "audio/ogg",
      languageHint: "de",
    });
    expect(capturedArgs).toContain("--language");
    expect(capturedArgs[capturedArgs.indexOf("--language") + 1]).toBe("de");
  });

  it("throws WhisperLocalTranscriptionError with exit code and stderr on failure", async () => {
    const spawnImpl = makeSpawn({
      exitCode: 2,
      stderr: "model load failed: missing weights",
    });
    const provider = new WhisperLocalProvider({
      binaryPath: "/x",
      modelPath: "/m",
      timeoutMs: 5000,
      spawnImpl,
    });
    await expect(
      provider.transcribe({ audio: new Uint8Array([0]), mimeType: "audio/wav" }),
    ).rejects.toMatchObject({
      name: "WhisperLocalTranscriptionError",
      exitCode: 2,
    });
  });

  it("wraps spawn errors in WhisperLocalTranscriptionError", async () => {
    const spawnImpl = makeSpawn({ spawnError: new Error("ENOENT: binary not found") });
    const provider = new WhisperLocalProvider({
      binaryPath: "/missing",
      modelPath: "/m",
      timeoutMs: 5000,
      spawnImpl,
    });
    await expect(
      provider.transcribe({ audio: new Uint8Array([0]), mimeType: "audio/wav" }),
    ).rejects.toBeInstanceOf(WhisperLocalTranscriptionError);
  });
});
