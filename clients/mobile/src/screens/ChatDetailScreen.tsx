import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDaemon } from '../context/DaemonContext';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

function streamChat(
  url: string,
  authHeader: string,
  message: string,
  onText: (chunk: string) => void,
  onDone: () => void,
  onError: (err: string) => void,
): () => void {
  const xhr = new XMLHttpRequest();
  let buffer = '';
  let currentEvent = '';
  let currentData = '';

  function parseChunk(chunk: string) {
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        currentData += line.slice(6);
      } else if (line === '' && currentData !== '') {
        try {
          const payload = JSON.parse(currentData) as Record<string, unknown>;
          if (currentEvent === 'text' && typeof payload.content === 'string') {
            onText(payload.content as string);
          } else if (currentEvent === 'done') {
            onDone();
          } else if (currentEvent === 'error' && typeof payload.message === 'string') {
            onError(payload.message as string);
          }
        } catch {
          // malformed SSE — skip
        }
        currentEvent = '';
        currentData = '';
      }
    }
  }

  xhr.open('POST', url, true);
  xhr.setRequestHeader('Authorization', authHeader);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Accept', 'text/event-stream');
  xhr.setRequestHeader('Cache-Control', 'no-cache');

  xhr.onreadystatechange = () => {
    if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED && xhr.status !== 200) {
      onError(`${xhr.status} ${xhr.statusText}`);
      return;
    }
    if (xhr.readyState === XMLHttpRequest.LOADING || xhr.readyState === XMLHttpRequest.DONE) {
      const newText = xhr.responseText.slice(buffer.length);
      buffer = xhr.responseText;
      parseChunk(newText);
    }
    if (xhr.readyState === XMLHttpRequest.DONE) {
      onDone();
    }
  };

  xhr.onerror = () => onError('Connection failed');
  xhr.send(JSON.stringify({ message }));

  return () => xhr.abort();
}

export function ChatDetailScreen({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const { state, client } = useDaemon();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [closing, setClosing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const msgCounterRef = useRef(0);

  const nextId = () => {
    msgCounterRef.current += 1;
    return String(msgCounterRef.current);
  };

  useEffect(() => {
    return () => {
      abortRef.current?.();
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, []);

  function handleSend() {
    if (!client || streaming || !input.trim() || !state.online) return;

    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: input.trim() };
    const assistantId = nextId();
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '', streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);
    scrollToBottom();

    const url = client.chatUrl(sessionId);
    const auth = client.authHeader;

    abortRef.current = streamChat(
      url,
      auth,
      userMsg.content,
      (chunk) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + chunk } : m,
          ),
        );
        scrollToBottom();
      },
      () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        );
        setStreaming(false);
        abortRef.current = null;
      },
      (err) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || `Error: ${err}`, streaming: false }
              : m,
          ),
        );
        setStreaming(false);
        abortRef.current = null;
      },
    );
  }

  async function handleClose() {
    if (!client || closing) return;
    setClosing(true);
    abortRef.current?.();
    try {
      await client.deleteSession(sessionId);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to close session.');
    } finally {
      setClosing(false);
      onClose();
    }
  }

  if (!state.online) {
    return (
      <View style={styles.center}>
        <Text style={styles.offlineText}>Daemon offline</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={88}
    >
      <View style={styles.header}>
        <Text style={styles.sessionIdText} numberOfLines={1}>{sessionId}</Text>
        <TouchableOpacity
          style={[styles.closeBtn, closing && styles.btnDisabled]}
          onPress={() => void handleClose()}
          disabled={closing}
        >
          <Text style={styles.closeBtnText}>{closing ? '…' : 'End'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        onContentSizeChange={scrollToBottom}
      >
        {messages.length === 0 && (
          <View style={styles.emptyHint}>
            <Text style={styles.emptyHintText}>Send a message to start the conversation.</Text>
          </View>
        )}
        {messages.map((msg) => (
          <View
            key={msg.id}
            style={[
              styles.bubble,
              msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            <Text
              style={[
                styles.bubbleText,
                msg.role === 'user' ? styles.userBubbleText : styles.assistantBubbleText,
              ]}
            >
              {msg.content}
              {msg.streaming && <Text style={styles.cursor}>▌</Text>}
            </Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.textInput, streaming && styles.inputDisabled]}
          value={input}
          onChangeText={setInput}
          placeholder="Message…"
          placeholderTextColor="#8e8e93"
          multiline
          editable={!streaming}
          returnKeyType="send"
          onSubmitEditing={() => handleSend()}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || streaming) && styles.btnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || streaming}
        >
          <Text style={styles.sendBtnText}>↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f2f2f7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  offlineText: { fontSize: 15, color: '#8e8e93' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#c6c6c8',
  },
  sessionIdText: {
    flex: 1,
    fontSize: 13,
    color: '#6c6c70',
    fontFamily: 'monospace',
  },
  closeBtn: {
    backgroundColor: '#ff3b30',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginLeft: 12,
  },
  closeBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  messageList: { flex: 1 },
  messageContent: { padding: 16, paddingBottom: 8 },
  emptyHint: { alignItems: 'center', marginTop: 32 },
  emptyHintText: { fontSize: 14, color: '#8e8e93', textAlign: 'center' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  userBubble: { backgroundColor: '#007aff', alignSelf: 'flex-end' },
  assistantBubble: { backgroundColor: '#fff', alignSelf: 'flex-start', borderWidth: StyleSheet.hairlineWidth, borderColor: '#e5e5ea' },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  userBubbleText: { color: '#fff' },
  assistantBubbleText: { color: '#1c1c1e' },
  cursor: { color: '#007aff' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#c6c6c8',
    gap: 8,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#f2f2f7',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1c1c1e',
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c6c6c8',
  },
  inputDisabled: { opacity: 0.6 },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#007aff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 20 },
  btnDisabled: { opacity: 0.4 },
});
