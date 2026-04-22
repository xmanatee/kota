/**
 * Voice CLI — thin daemon client for STT and TTS.
 *
 * Commands run against the daemon control API via `DaemonControlClient`.
 * No per-client audio pipeline: the CLI only reads input bytes and plays
 * output bytes through a platform-detected player, keeping provider and
 * credential handling daemon-side.
 */

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { Command } from "commander";
import { DaemonControlClient } from "#core/server/daemon-client.js";

const EXT_TO_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aac": "audio/aac",
  ".webm": "audio/webm",
  ".flac": "audio/flac",
};

function mimeFromFilename(path: string): string | null {
  const ext = extname(path).toLowerCase();
  return EXT_TO_MIME[ext] ?? null;
}

function connectDaemon(): DaemonControlClient {
  const client = DaemonControlClient.fromStateDir();
  if (!client) {
    console.error("Daemon is not running. Start it with `kota daemon`.");
    process.exit(1);
  }
  return client;
}

export function buildVoiceCommand(): Command {
  const cmd = new Command("voice").description(
    "Talk to the daemon's voice surface (STT input, TTS output)",
  );

  cmd
    .command("transcribe <file>")
    .description("Transcribe an audio file through the daemon's STT provider")
    .option("--mime <type>", "Override MIME type (inferred from file extension when omitted)")
    .option("--language <bcp47>", "BCP-47 language hint for the provider")
    .option("--json", "Emit the full JSON response instead of just the text")
    .action(async (
      file: string,
      opts: { mime?: string; language?: string; json?: boolean },
    ) => {
      const bytes = readFileSync(file);
      const mimeType = opts.mime ?? mimeFromFilename(file);
      if (!mimeType) {
        console.error(
          `Could not determine MIME type from "${file}". Pass --mime explicitly.`,
        );
        process.exit(1);
      }
      const result = await connectDaemon().voiceTranscribe({
        audio: new Uint8Array(bytes),
        mimeType,
        filename: basename(file),
        ...(opts.language !== undefined && { languageHint: opts.language }),
      });
      if (!result.ok) {
        reportFailure(result, "transcription");
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify({
          text: result.text,
          ...(result.language !== undefined && { language: result.language }),
        }));
      } else {
        console.log(result.text);
      }
    });

  cmd
    .command("speak <text>")
    .description("Synthesize speech for the given text via the daemon's TTS provider")
    .option("--voice <name>", "Provider-specific voice identifier")
    .option("--language <bcp47>", "BCP-47 language hint")
    .option("-f, --format <fmt>", "Output audio format (mp3, wav, ogg, opus, aac, flac, pcm)")
    .option("-o, --output <file>", "Write audio to file instead of playing it through the speaker")
    .option("--no-play", "Do not play audio automatically (useful with --output)")
    .action(async (
      text: string,
      opts: { voice?: string; language?: string; format?: string; output?: string; play: boolean },
    ) => {
      const result = await connectDaemon().voiceSynthesize({
        text,
        ...(opts.voice !== undefined && { voice: opts.voice }),
        ...(opts.language !== undefined && { languageHint: opts.language }),
        ...(opts.format !== undefined && { format: opts.format }),
      });
      if (!result.ok) {
        reportFailure(result, "synthesis");
        return;
      }
      if (opts.output) {
        writeFileSync(opts.output, result.audio);
        console.error(`Wrote ${result.audio.byteLength} bytes to ${opts.output}`);
        if (opts.play !== false) {
          playAudioFile(opts.output, result.format);
        }
        return;
      }
      const tmpPath = writeTempAudio(result.audio, result.format);
      if (opts.play === false) {
        console.log(tmpPath);
        return;
      }
      playAudioFile(tmpPath, result.format);
    });

  return cmd;
}

function reportFailure(
  result: { status: number; error: string; code?: string },
  kind: string,
): void {
  const code = result.code ? ` [${result.code}]` : "";
  console.error(
    `Voice ${kind} failed (HTTP ${result.status}${code}): ${result.error || "unknown error"}`,
  );
  process.exit(1);
}

function writeTempAudio(bytes: Uint8Array | Buffer, format: string): string {
  const name = `kota-voice-${Date.now()}.${format || "bin"}`;
  const path = join(tmpdir(), name);
  writeFileSync(path, bytes);
  return path;
}

/**
 * Play an audio file through the first platform player we can find.
 * Falls back to printing the path so the operator can open it manually —
 * the CLI never pretends audio played when no player exists.
 */
function playAudioFile(path: string, format: string): void {
  const candidates = selectPlayers(format);
  for (const [bin, ...args] of candidates) {
    if (!hasBinary(bin)) continue;
    const child = spawn(bin, [...args, path], { stdio: "ignore" });
    child.on("error", (err) => {
      console.error(`Playback failed (${bin}): ${err.message}. File remains at ${path}`);
    });
    return;
  }
  console.error(`No audio player found. File saved to ${path}`);
}

function selectPlayers(format: string): string[][] {
  if (process.platform === "darwin") {
    return [["afplay"]];
  }
  if (process.platform === "linux") {
    if (format === "mp3") return [["mpg123", "-q"], ["ffplay", "-autoexit", "-nodisp", "-loglevel", "quiet"]];
    return [["paplay"], ["aplay", "-q"], ["ffplay", "-autoexit", "-nodisp", "-loglevel", "quiet"]];
  }
  return [];
}

function hasBinary(bin: string): boolean {
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
    stdio: "ignore",
  });
  return probe.status === 0;
}
