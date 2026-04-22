import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { DaemonClient } from '../daemonClient';
import { VoiceRecorder } from './voiceRecorder';

export type VoiceError = { code: string; message: string };

type Props = {
  client: DaemonClient;
  /** Latest assistant text the speak button should synthesize, or null. */
  speakableText: string | null;
  onTranscript: (text: string) => void;
  onError: (err: VoiceError) => void;
  /** Test seam — defaults to a real `VoiceRecorder` instance. */
  recorder?: VoiceRecorder;
};

/**
 * Mic + speaker buttons for the mobile chat. Mic capture goes through
 * `/voice/transcribe`; speaker playback goes through `/voice/synthesize`.
 * All vendor handling stays daemon-side. Failures surface typed codes to
 * match the CLI and web client one-to-one.
 */
export function VoiceComposer({
  client,
  speakableText,
  onTranscript,
  onError,
  recorder: injectedRecorder,
}: Props) {
  const recorderRef = useRef<VoiceRecorder>(injectedRecorder ?? new VoiceRecorder());
  const [state, setState] = useState<'idle' | 'recording' | 'uploading' | 'speaking'>('idle');

  useEffect(() => {
    const recorder = recorderRef.current;
    return () => {
      void recorder.cancel();
      void recorder.stopPlayback();
    };
  }, []);

  async function startRecording() {
    try {
      const granted = await recorderRef.current.requestPermission();
      if (!granted) {
        onError({ code: 'stt-mic-denied', message: 'Microphone access denied.' });
        return;
      }
      await recorderRef.current.start();
      setState('recording');
    } catch (err) {
      onError({
        code: 'stt-mic-denied',
        message: `Microphone access failed: ${(err as Error).message}`,
      });
    }
  }

  async function stopRecording() {
    try {
      const captured = await recorderRef.current.stop();
      if (!captured) {
        setState('idle');
        onError({
          code: 'stt-empty-recording',
          message: 'Recording produced no audio data.',
        });
        return;
      }
      setState('uploading');
      const result = await client.voiceTranscribe({
        audio: captured.audio,
        mimeType: captured.mimeType,
        filename: captured.filename,
      });
      setState('idle');
      if (!result.ok) {
        onError({
          code: result.code || `http-${result.status}`,
          message: result.error,
        });
        return;
      }
      if (!result.text.trim()) {
        onError({
          code: 'stt-empty-transcript',
          message: 'Voice provider returned no text.',
        });
        return;
      }
      onTranscript(result.text);
    } catch (err) {
      setState('idle');
      onError({
        code: 'stt-request-failed',
        message: (err as Error).message,
      });
    }
  }

  async function speakLatest() {
    if (!speakableText || !speakableText.trim()) return;
    setState('speaking');
    try {
      const result = await client.voiceSynthesize({ text: speakableText });
      if (!result.ok) {
        setState('idle');
        const suffix = result.supported ? ` Supported: ${result.supported.join(', ')}` : '';
        onError({
          code: result.code || `http-${result.status}`,
          message: result.error + suffix,
        });
        return;
      }
      await recorderRef.current.play(result.audio, result.mimeType);
    } catch (err) {
      onError({
        code: 'tts-playback-failed',
        message: (err as Error).message,
      });
    } finally {
      setState('idle');
    }
  }

  const recording = state === 'recording';
  const uploading = state === 'uploading';
  const speaking = state === 'speaking';
  const canSpeak = !!speakableText && !recording && !uploading && !speaking;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        accessibilityLabel={recording ? 'Stop recording' : 'Record voice'}
        accessibilityRole="button"
        testID="voice-mic-btn"
        style={[
          styles.btn,
          recording && styles.btnActive,
          (uploading || speaking) && styles.btnDisabled,
        ]}
        disabled={uploading || speaking}
        onPress={() => (recording ? void stopRecording() : void startRecording())}
      >
        <Text style={[styles.btnText, recording && styles.btnActiveText]}>
          {recording ? '■' : uploading ? '…' : '🎤'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityLabel="Speak latest reply"
        accessibilityRole="button"
        testID="voice-speak-btn"
        style={[styles.btn, !canSpeak && styles.btnDisabled]}
        disabled={!canSpeak}
        onPress={() => void speakLatest()}
      >
        <Text style={styles.btnText}>{speaking ? '♫' : '🔊'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e5e5ea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnActive: {
    backgroundColor: '#ff3b30',
  },
  btnActiveText: {
    color: '#fff',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  btnText: {
    fontSize: 16,
    color: '#1c1c1e',
    fontWeight: '600',
  },
});
