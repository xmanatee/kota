import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDaemon } from '../context/DaemonContext';
import type { OwnerQuestion } from '../types';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m === 1) return '1m ago';
  return `${m}m ago`;
}

function OwnerQuestionRow({
  question,
  onAnswer,
  onDismiss,
  busy,
}: {
  question: OwnerQuestion;
  onAnswer: (answer: string) => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  const [answer, setAnswer] = useState('');

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    onAnswer(trimmed);
    setAnswer('');
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.source}>❓ {question.source}</Text>
        <Text style={styles.age}>{timeAgo(question.createdAt)}</Text>
      </View>
      <Text style={styles.question}>{question.question}</Text>
      {question.reason && question.reason.length > 0 && (
        <Text style={styles.reason} numberOfLines={3}>
          {question.reason}
        </Text>
      )}
      {question.proposedAnswers && question.proposedAnswers.length > 0 && (
        <View style={styles.suggestions}>
          {question.proposedAnswers.map((s) => (
            <TouchableOpacity
              key={s}
              style={styles.suggestion}
              onPress={() => submit(s)}
              disabled={busy}
            >
              <Text style={styles.suggestionText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <TextInput
        value={answer}
        onChangeText={setAnswer}
        placeholder="Your answer…"
        style={styles.input}
        editable={!busy}
        onSubmitEditing={() => submit(answer)}
      />
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.answerBtn, (!answer.trim() || busy) && styles.btnDisabled]}
          onPress={() => submit(answer)}
          disabled={!answer.trim() || busy}
        >
          <Text style={styles.answerBtnText}>Answer</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.dismissBtn, busy && styles.btnDisabled]}
          onPress={onDismiss}
          disabled={busy}
        >
          <Text style={styles.dismissBtnText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function OwnerQuestionListScreen() {
  const { state, client, refresh } = useDaemon();
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    refresh();
    await new Promise((r) => setTimeout(r, 800));
    setRefreshing(false);
  }

  async function handleAnswer(id: string, answer: string) {
    if (!client || acting) return;
    setActing(id);
    try {
      await client.answerOwnerQuestion(id, answer);
      refresh();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to answer.');
    } finally {
      setActing(null);
    }
  }

  async function handleDismiss(id: string) {
    if (!client || acting) return;
    setActing(id);
    try {
      await client.dismissOwnerQuestion(id);
      refresh();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to dismiss.');
    } finally {
      setActing(null);
    }
  }

  const pending = state.ownerQuestions.filter((q) => q.status === 'pending');

  return (
    <FlatList
      style={styles.container}
      data={pending}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <OwnerQuestionRow
          question={item}
          onAnswer={(a) => void handleAnswer(item.id, a)}
          onDismiss={() => void handleDismiss(item.id)}
          busy={acting === item.id}
        />
      )}
      ListEmptyComponent={() => (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No pending owner questions.</Text>
        </View>
      )}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} />
      }
      contentContainerStyle={pending.length === 0 ? styles.emptyContainer : styles.list}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  list: { paddingVertical: 8 },
  row: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  source: { fontSize: 13, color: '#007aff', fontWeight: '600' },
  age: { fontSize: 13, color: '#8e8e93' },
  question: { fontSize: 15, fontWeight: '500', color: '#000', marginBottom: 6 },
  reason: { fontSize: 13, color: '#3c3c43', marginBottom: 8 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  suggestion: {
    backgroundColor: '#e5e5ea',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  suggestionText: { fontSize: 13, color: '#000' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d1d6',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    marginBottom: 8,
    backgroundColor: '#f2f2f7',
  },
  actions: { flexDirection: 'row', gap: 10 },
  answerBtn: {
    flex: 1,
    backgroundColor: '#007aff',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  answerBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  dismissBtn: {
    flex: 1,
    backgroundColor: '#8e8e93',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  dismissBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyContainer: { flexGrow: 1 },
  emptyText: { color: '#8e8e93', fontSize: 14 },
});
