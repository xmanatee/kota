/**
 * Local whisper.cpp provider — spawns a whisper-cli binary to transcribe
 * audio without a network round-trip. Optional: the module skips
 * registration when the binary is not present, so local STT is an opt-in
 * capability rather than a required dependency.
 *
 * The provider writes input audio to a temp file and invokes the binary
 * with `--file <path> --output-json --no-prints`. It then parses the
 * generated JSON, which whisper.cpp writes next to the input file with a
 * `.json` suffix.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  SpeechToTextProvider,
  VoiceInput,
  VoiceTranscript,
} from "#modules/voice/types.js";

export type WhisperLocalProviderOptions = {
  /** Path to the whisper-cli binary (e.g. `/opt/whisper.cpp/main`). */
  binaryPath: string;
  /** Path to the GGML model file whisper-cli should load. */
  modelPath: string;
  /** Extra command-line arguments forwarded verbatim to whisper-cli. */
  extraArgs?: readonly string[];
  /** Per-invocation timeout in milliseconds. */
  timeoutMs: number;
  /**
   * Override spawn — exposed for tests so the provider can be exercised
   * without a real binary. Defaults to `node:child_process/spawn`.
   */
  spawnImpl?: typeof spawn;
};

export class WhisperLocalTranscriptionError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  constructor(message: string, exitCode: number | null, stderr: string) {
    super(message);
    this.name = "WhisperLocalTranscriptionError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

const EXT_FROM_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/oga": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/webm": "webm",
  "audio/flac": "flac",
};

function extensionFor(input: VoiceInput): string {
  if (input.filename?.includes(".")) {
    return input.filename.split(".").pop()!;
  }
  return EXT_FROM_MIME[input.mimeType.toLowerCase()] ?? "bin";
}

export class WhisperLocalProvider implements SpeechToTextProvider {
  readonly name = "whisper-local";

  readonly #binaryPath: string;
  readonly #modelPath: string;
  readonly #extraArgs: readonly string[];
  readonly #timeoutMs: number;
  readonly #spawn: typeof spawn;

  constructor(options: WhisperLocalProviderOptions) {
    this.#binaryPath = options.binaryPath;
    this.#modelPath = options.modelPath;
    this.#extraArgs = options.extraArgs ?? [];
    this.#timeoutMs = options.timeoutMs;
    this.#spawn = options.spawnImpl ?? spawn;
  }

  async transcribe(input: VoiceInput): Promise<VoiceTranscript> {
    const dir = mkdtempSync(join(tmpdir(), "kota-whisper-local-"));
    const audioPath = join(dir, `input.${extensionFor(input)}`);
    writeFileSync(audioPath, Buffer.from(input.audio));

    const args = [
      "--model",
      this.#modelPath,
      "--file",
      audioPath,
      "--output-json",
      "--no-prints",
    ];
    if (input.languageHint) {
      args.push("--language", input.languageHint);
    }
    for (const extra of this.#extraArgs) args.push(extra);

    try {
      await this.#runBinary(args);
      const jsonPath = `${audioPath}.json`;
      const raw = readFileSync(jsonPath, "utf8");
      const parsed = JSON.parse(raw) as {
        transcription?: Array<{ text?: string }>;
        result?: { language?: string };
      };
      const text = (parsed.transcription ?? [])
        .map((seg) => (typeof seg.text === "string" ? seg.text : ""))
        .join("")
        .trim();
      const result: VoiceTranscript = { text };
      if (typeof parsed.result?.language === "string") {
        result.language = parsed.result.language;
      }
      return result;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  #runBinary(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.#spawn(this.#binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, this.#timeoutMs);

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new WhisperLocalTranscriptionError(
          `whisper-local spawn failed: ${err.message}`,
          null,
          stderr,
        ));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
        } else {
          reject(new WhisperLocalTranscriptionError(
            `whisper-local exited with code ${code}`,
            code,
            stderr.slice(0, 500),
          ));
        }
      });
    });
  }
}
