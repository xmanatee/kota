import React from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CAPTURE_TARGET_TINT, renderCaptureResultPlain } from '../captureRender';
import { useDaemon } from '../context/DaemonContext';
import type { CaptureTargetChoice } from '../context/state';
import {
  CAPTURE_TARGET_ORDER,
  type CaptureFilter,
  type CaptureResult,
  type CaptureTarget,
} from '../types';

const EMPTY_TEXT_HINT =
  'Type a note and tap Capture to route it across memory, knowledge, tasks, or inbox.';

const TARGET_CHOICES: ReadonlyArray<CaptureTargetChoice> = [
  'auto',
  ...CAPTURE_TARGET_ORDER,
];

function buildFilter(
  target: CaptureTargetChoice,
  hint: string,
): CaptureFilter | undefined {
  const filter: CaptureFilter = {};
  if (target !== 'auto') filter.target = target;
  if (hint.trim().length > 0) filter.hint = hint.trim();
  return Object.keys(filter).length > 0 ? filter : undefined;
}

export function CaptureScreen() {
  const {
    state,
    setCaptureText,
    setCaptureTarget,
    setCaptureHint,
    capture,
  } = useDaemon();
  const {
    online,
    captureText,
    captureTarget,
    captureHint,
    captureResult,
    captureLoading,
    captureError,
  } = state;

  const trimmed = captureText.trim();
  const hasText = trimmed.length > 0;

  const onSubmit = () => {
    if (!hasText) return;
    void capture(trimmed, buildFilter(captureTarget, captureHint));
  };

  const onPickSuggestion = (suggestion: CaptureTarget) => {
    if (!hasText) return;
    setCaptureTarget(suggestion);
    void capture(trimmed, buildFilter(suggestion, captureHint));
  };

  if (!state.settingsLoaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!state.daemonUrl || !state.token) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No daemon configured.</Text>
      </View>
    );
  }

  const headerBadge = renderHeaderBadge(captureResult);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={captureLoading} onRefresh={onSubmit} />
      }
    >
      {!online && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            Daemon offline — retrying every 15s
          </Text>
        </View>
      )}

      <View style={styles.headerRow}>
        <Text style={styles.title}>Capture</Text>
        {headerBadge !== null && (
          <View
            style={[
              styles.badge,
              headerBadge.active ? styles.badgeActive : styles.badgeQuiet,
            ]}
          >
            <Text
              style={
                headerBadge.active
                  ? styles.badgeTextActive
                  : styles.badgeTextQuiet
              }
            >
              {headerBadge.label}
            </Text>
          </View>
        )}
      </View>

      <TextInput
        style={styles.textArea}
        placeholder="Capture a note across stores…"
        autoCapitalize="sentences"
        autoCorrect
        value={captureText}
        onChangeText={setCaptureText}
        multiline
        textAlignVertical="top"
      />

      <View style={styles.targetRow}>
        {TARGET_CHOICES.map((choice) => {
          const selected = captureTarget === choice;
          return (
            <TouchableOpacity
              key={choice}
              accessibilityRole="button"
              accessibilityLabel={`Capture target ${choice}`}
              style={[
                styles.targetChip,
                selected ? styles.targetChipSelected : null,
              ]}
              onPress={() => setCaptureTarget(choice)}
            >
              <Text
                style={
                  selected
                    ? styles.targetChipTextSelected
                    : styles.targetChipText
                }
              >
                {choice}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TextInput
        style={styles.hintInput}
        placeholder="Optional hint for the classifier…"
        autoCapitalize="none"
        autoCorrect={false}
        value={captureHint}
        onChangeText={setCaptureHint}
      />

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Submit capture"
        style={[
          styles.submitButton,
          (!hasText || !online || captureLoading) &&
            styles.submitButtonDisabled,
        ]}
        onPress={onSubmit}
        disabled={!hasText || !online || captureLoading}
      >
        <Text style={styles.submitButtonText}>
          {captureLoading ? 'Capturing…' : 'Capture'}
        </Text>
      </TouchableOpacity>

      {captureError !== null && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{captureError}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={onSubmit}
            disabled={!hasText || captureLoading || !online}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {captureError === null && captureResult === null && captureLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="small" />
        </View>
      )}

      {captureError === null && !hasText && captureResult === null && (
        <Text style={styles.usageHint}>{EMPTY_TEXT_HINT}</Text>
      )}

      {captureError === null && captureResult !== null && (
        <CaptureBody
          result={captureResult}
          onPickSuggestion={onPickSuggestion}
        />
      )}
    </ScrollView>
  );
}

function CaptureBody({
  result,
  onPickSuggestion,
}: {
  result: CaptureResult;
  onPickSuggestion: (target: CaptureTarget) => void;
}) {
  const plain = renderCaptureResultPlain(result);
  return (
    <View style={styles.resultWrap}>
      <View style={styles.resultBadges}>
        {resultBadgeTargets(result).map((target) => (
          <TargetBadge key={target} target={target} />
        ))}
      </View>
      <Text
        style={resultBodyStyle(result)}
        accessibilityLabel="capture rendered body"
      >
        {plain}
      </Text>
      {result.ok === false && result.reason === 'ambiguous' && (
        <View style={styles.suggestionRow}>
          {result.suggestions.map((suggestion) => (
            <TouchableOpacity
              key={suggestion}
              accessibilityRole="button"
              accessibilityLabel={`Re-issue capture into ${suggestion}`}
              style={[
                styles.targetChip,
                {
                  backgroundColor: CAPTURE_TARGET_TINT[suggestion].bg,
                },
              ]}
              onPress={() => onPickSuggestion(suggestion)}
            >
              <Text
                style={[
                  styles.targetChipText,
                  { color: CAPTURE_TARGET_TINT[suggestion].fg },
                ]}
              >
                {suggestion}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function resultBadgeTargets(result: CaptureResult): CaptureTarget[] {
  if (result.ok) return [result.record.target];
  switch (result.reason) {
    case 'ambiguous':
      return [...result.suggestions];
    case 'contributor_failed':
      return [result.target];
    case 'no_contributors':
      return [];
  }
}

function resultBodyStyle(result: CaptureResult) {
  if (result.ok) return styles.bodyOk;
  switch (result.reason) {
    case 'ambiguous':
    case 'no_contributors':
      return styles.bodyNotice;
    case 'contributor_failed':
      return styles.bodyError;
  }
}

function TargetBadge({ target }: { target: CaptureTarget }) {
  const tint = CAPTURE_TARGET_TINT[target];
  return (
    <View style={[styles.successBadge, { backgroundColor: tint.bg }]}>
      <Text style={[styles.successBadgeText, { color: tint.fg }]}>
        {target}
      </Text>
    </View>
  );
}

function renderHeaderBadge(
  result: CaptureResult | null,
): { label: string; active: boolean } | null {
  if (result === null) return null;
  if (result.ok === false) {
    switch (result.reason) {
      case 'ambiguous':
        return { label: 'ambiguous', active: false };
      case 'no_contributors':
        return { label: 'unconfigured', active: false };
      case 'contributor_failed':
        return { label: 'contributor failed', active: false };
    }
  }
  return { label: `captured to ${result.record.target}`, active: true };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  content: { padding: 16, gap: 12 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 12,
  },
  offlineBanner: {
    backgroundColor: '#ff3b30',
    borderRadius: 10,
    padding: 12,
  },
  offlineText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: { fontSize: 17, fontWeight: '600', color: '#1c1c1e' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeActive: { backgroundColor: 'rgba(0, 122, 255, 0.15)' },
  badgeQuiet: { backgroundColor: 'rgba(142, 142, 147, 0.15)' },
  badgeTextActive: { color: '#0a5fc2', fontSize: 11, fontWeight: '600' },
  badgeTextQuiet: { color: '#6c6c70', fontSize: 11, fontWeight: '600' },
  textArea: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#1c1c1e',
    minHeight: 96,
  },
  targetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  targetChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(142, 142, 147, 0.15)',
  },
  targetChipSelected: {
    backgroundColor: '#007aff',
  },
  targetChipText: {
    color: '#3a3a3c',
    fontSize: 12,
    fontWeight: '600',
  },
  targetChipTextSelected: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  hintInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#1c1c1e',
  },
  submitButton: {
    backgroundColor: '#007aff',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#a8a8ad',
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  resultWrap: { gap: 10 },
  resultBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  successBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    minWidth: 64,
    alignItems: 'center',
  },
  successBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  bodyOk: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: '#1c1c1e',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 10,
  },
  bodyNotice: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: '#c25e00',
    backgroundColor: 'rgba(255, 149, 0, 0.12)',
    borderRadius: 10,
    padding: 10,
  },
  bodyError: {
    fontFamily: 'Courier',
    fontSize: 12,
    color: '#ff3b30',
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    borderRadius: 10,
    padding: 10,
  },
  emptyText: { color: '#8e8e93', fontSize: 14 },
  usageHint: { color: '#8e8e93', fontSize: 13 },
  errorBox: {
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  errorText: { color: '#ff3b30', fontSize: 13 },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#007aff',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
