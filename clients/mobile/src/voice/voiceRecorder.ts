import { Audio } from 'expo-av';
import type { Recording as AudioRecordingInstance } from 'expo-av/build/Audio/Recording';
import * as FileSystem from 'expo-file-system';
import { base64ToBytes } from './base64';

/**
 * Thin wrapper around `expo-av`'s Audio.Recording / Audio.Sound. All vendor
 * calls live in the daemon — this wrapper only moves bytes in and out of the
 * platform audio pipeline. No TTS/STT SDKs are imported here.
 */

export type CapturedAudio = {
  audio: Uint8Array;
  mimeType: string;
  filename: string;
};

export class VoiceRecorder {
  private recording: AudioRecordingInstance | null = null;
  private sound: Audio.Sound | null = null;

  async requestPermission(): Promise<boolean> {
    const response = await Audio.requestPermissionsAsync();
    return response.status === 'granted';
  }

  async start(): Promise<void> {
    if (this.recording) return;
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY,
    );
    this.recording = recording;
  }

  async stop(): Promise<CapturedAudio | null> {
    const recording = this.recording;
    if (!recording) return null;
    this.recording = null;
    try {
      await recording.stopAndUnloadAsync();
    } catch {
      // Recording was already released by the platform — fall through.
    }
    const uri = recording.getURI();
    if (!uri) return null;
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // Best-effort cleanup; the file lives in the app cache.
    }
    const audio = base64ToBytes(base64);
    if (audio.length === 0) return null;
    const mimeType = uriToMimeType(uri);
    const filename = filenameFromUri(uri);
    return { audio, mimeType, filename };
  }

  async cancel(): Promise<void> {
    const recording = this.recording;
    this.recording = null;
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
    } catch {
      // Already stopped.
    }
    const uri = recording.getURI();
    if (uri) {
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  async play(audio: Uint8Array, mimeType: string): Promise<void> {
    await this.stopPlayback();
    const ext = extensionFromMimeType(mimeType);
    const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
    const uri = `${dir}kota-voice-${Date.now()}.${ext}`;
    const base64 = uint8ArrayToBase64(audio);
    await FileSystem.writeAsStringAsync(uri, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const { sound } = await Audio.Sound.createAsync({ uri });
    this.sound = sound;
    await new Promise<void>((resolve, reject) => {
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) {
          if (status.error) reject(new Error(status.error));
          return;
        }
        if (status.didJustFinish) resolve();
      });
      sound.playAsync().catch(reject);
    });
    await this.stopPlayback();
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // Best-effort cleanup.
    }
  }

  async stopPlayback(): Promise<void> {
    const sound = this.sound;
    this.sound = null;
    if (!sound) return;
    try {
      await sound.stopAsync();
    } catch {
      // Already stopped.
    }
    try {
      await sound.unloadAsync();
    } catch {
      // Already unloaded.
    }
  }
}

function uriToMimeType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.caf')) return 'audio/x-caf';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'audio/ogg';
  if (lower.endsWith('.webm')) return 'audio/webm';
  return 'audio/m4a';
}

function extensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/aac':
      return 'aac';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/flac':
      return 'flac';
    default:
      return 'bin';
  }
}

function filenameFromUri(uri: string): string {
  const slash = uri.lastIndexOf('/');
  return slash >= 0 ? uri.slice(slash + 1) : uri;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const globals = globalThis as { btoa?: (raw: string) => string };
  if (typeof globals.btoa !== 'function') {
    throw new Error('btoa is not available in this runtime');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(
      null,
      Array.from(slice) as unknown as number[],
    );
  }
  return globals.btoa(binary);
}
