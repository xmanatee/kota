import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDaemon } from '../context/DaemonContext';
import {
  RETRACT_TARGET_TINT,
  renderRetractResultPlain,
} from '../retractRender';
import {
  RETRACT_TARGET_ORDER,
  type RetractRequest,
  type RetractResult,
  type RetractTarget,
} from '../types';

const EMPTY_HINT =
  'Pick a store, type the identifier, then tap Retract to remove the record.';

type IdentifierLabel = 'id' | 'slug' | 'path';

function identifierLabelFor(target: RetractTarget): IdentifierLabel {
  switch (target) {
    case 'memory':
      return 'id';
    case 'knowledge':
      return 'slug';
    case 'tasks':
      return 'id';
    case 'inbox':
      return 'path';
  }
}

function identifierPlaceholderFor(target: RetractTarget): string {
  switch (target) {
    case 'memory':
      return 'memory id (e.g. mem-7)';
    case 'knowledge':
      return 'knowledge slug';
    case 'tasks':
      return 'task id (filename without .md)';
    case 'inbox':
      return 'data/inbox/note-foo.md';
  }
}

function buildRetractRequest(
  target: RetractTarget,
  identifier: string,
): RetractRequest {
  switch (target) {
    case 'memory':
      return { target: 'memory', id: identifier };
    case 'knowledge':
      return { target: 'knowledge', slug: identifier };
    case 'tasks':
      return { target: 'tasks', id: identifier };
    case 'inbox':
      return { target: 'inbox', path: identifier };
  }
}

export function RetractScreen() {
  const {
    state,
    setRetractTarget,
    setRetractIdentifier,
    setRetractConfirmed,
    retract,
  } = useDaemon();
  const {
    online,
    retractTarget,
    retractIdentifier,
    retractResult,
    retractLoading,
    retractError,
    retractConfirmed,
  } = state;

  const trimmed = retractIdentifier.trim();
  const hasIdentifier = trimmed.length > 0;
  const label = identifierLabelFor(retractTarget);

  const onSubmit = () => {
    if (!hasIdentifier || retractLoading) return;
    if (!retractConfirmed) {
      setRetractConfirmed(true);
      return;
    }
    void retract(buildRetractRequest(retractTarget, trimmed));
  };

  const onCancelConfirmation = () => {
    setRetractConfirmed(false);
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

  const headerBadge = renderHeaderBadge(retractResult);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!online && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            Daemon offline — retrying every 15s
          </Text>
        </View>
      )}

      <View style={styles.headerRow}>
        <Text style={styles.title}>Retract</Text>
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

      <View style={styles.targetRow}>
        {RETRACT_TARGET_ORDER.map((choice) => {
          const selected = retractTarget === choice;
          return (
            <TouchableOpacity
              key={choice}
              accessibilityRole="button"
              accessibilityLabel={`Retract target ${choice}`}
              style={[
                styles.targetChip,
                selected ? styles.targetChipSelected : null,
              ]}
              onPress={() => setRetractTarget(choice)}
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

      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.identifierInput}
        placeholder={identifierPlaceholderFor(retractTarget)}
        autoCapitalize="none"
        autoCorrect={false}
        value={retractIdentifier}
        onChangeText={setRetractIdentifier}
        accessibilityLabel={`Retract ${label}`}
      />

      {retractConfirmed && hasIdentifier && (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>
            Confirm retract of {retractTarget} {label}{' '}
            <Text style={styles.confirmIdentifier}>{trimmed}</Text>?
          </Text>
          <Text style={styles.confirmWarning}>
            This is destructive. Tap Confirm retract to remove this record.
          </Text>
        </View>
      )}

      <View style={styles.submitRow}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={
            retractConfirmed ? 'Confirm retract' : 'Submit retract'
          }
          style={[
            styles.submitButton,
            retractConfirmed
              ? styles.submitButtonDanger
              : styles.submitButtonNeutral,
            (!hasIdentifier || !online || retractLoading) &&
              styles.submitButtonDisabled,
          ]}
          onPress={onSubmit}
          disabled={!hasIdentifier || !online || retractLoading}
        >
          <Text style={styles.submitButtonText}>
            {retractLoading
              ? 'Retracting…'
              : retractConfirmed
                ? 'Confirm retract'
                : 'Retract'}
          </Text>
        </TouchableOpacity>

        {retractConfirmed && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Cancel retract confirmation"
            style={styles.cancelButton}
            onPress={onCancelConfirmation}
            disabled={retractLoading}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

      {retractError !== null && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{retractError}</Text>
        </View>
      )}

      {retractError === null && retractResult === null && retractLoading && (
        <View style={styles.center}>
          <ActivityIndicator size="small" />
        </View>
      )}

      {retractError === null && !hasIdentifier && retractResult === null && (
        <Text style={styles.usageHint}>{EMPTY_HINT}</Text>
      )}

      {retractError === null && retractResult !== null && (
        <RetractBody result={retractResult} />
      )}
    </ScrollView>
  );
}

function RetractBody({ result }: { result: RetractResult }) {
  const plain = renderRetractResultPlain(result);
  const badgeTargets = resultBadgeTargets(result);
  return (
    <View style={styles.resultWrap}>
      <View style={styles.resultBadges}>
        {badgeTargets.map((target) => (
          <TargetBadge key={target} target={target} />
        ))}
      </View>
      <Text
        style={resultBodyStyle(result)}
        accessibilityLabel="retract rendered body"
      >
        {plain}
      </Text>
      {result.ok && result.record.target === 'tasks' && (
        <View style={styles.detailRow}>
          <View style={styles.toStateBadge}>
            <Text style={styles.toStateBadgeText}>{result.record.toState}</Text>
          </View>
          <Text style={styles.detailText}>
            {result.record.previousPath} → {result.record.path}
          </Text>
        </View>
      )}
      {result.ok && result.record.target === 'inbox' && (
        <Text style={styles.detailText}>{result.record.path}</Text>
      )}
    </View>
  );
}

function resultBadgeTargets(result: RetractResult): RetractTarget[] {
  if (result.ok) return [result.record.target];
  switch (result.reason) {
    case 'no_contributors':
      return [];
    case 'not_found':
    case 'contributor_failed':
      return [result.target];
  }
}

function resultBodyStyle(result: RetractResult) {
  if (result.ok) return styles.bodyOk;
  switch (result.reason) {
    case 'no_contributors':
    case 'not_found':
      return styles.bodyNotice;
    case 'contributor_failed':
      return styles.bodyError;
  }
}

function TargetBadge({ target }: { target: RetractTarget }) {
  const tint = RETRACT_TARGET_TINT[target];
  return (
    <View style={[styles.successBadge, { backgroundColor: tint.bg }]}>
      <Text style={[styles.successBadgeText, { color: tint.fg }]}>
        {target}
      </Text>
    </View>
  );
}

function renderHeaderBadge(
  result: RetractResult | null,
): { label: string; active: boolean } | null {
  if (result === null) return null;
  if (result.ok === false) {
    switch (result.reason) {
      case 'no_contributors':
        return { label: 'no contributors', active: false };
      case 'not_found':
        return { label: `${result.target} not found`, active: false };
      case 'contributor_failed':
        return { label: `${result.target} failed`, active: false };
    }
  }
  return { label: `retracted from ${result.record.target}`, active: true };
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
  badgeActive: { backgroundColor: 'rgba(52, 199, 89, 0.18)' },
  badgeQuiet: { backgroundColor: 'rgba(255, 149, 0, 0.18)' },
  badgeTextActive: { color: '#1f7a3a', fontSize: 11, fontWeight: '600' },
  badgeTextQuiet: { color: '#a85a00', fontSize: 11, fontWeight: '600' },
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
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3a3a3c',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  identifierInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1c1c1e',
  },
  confirmBox: {
    backgroundColor: 'rgba(255, 149, 0, 0.15)',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  confirmText: { color: '#1c1c1e', fontSize: 13 },
  confirmIdentifier: { fontFamily: 'Courier', fontSize: 12 },
  confirmWarning: { color: '#a85a00', fontSize: 12 },
  submitRow: {
    flexDirection: 'row',
    gap: 8,
  },
  submitButton: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  submitButtonNeutral: {
    backgroundColor: '#007aff',
  },
  submitButtonDanger: {
    backgroundColor: '#ff3b30',
  },
  submitButtonDisabled: {
    backgroundColor: '#a8a8ad',
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  cancelButton: {
    backgroundColor: '#e5e5ea',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    color: '#1c1c1e',
    fontSize: 14,
    fontWeight: '600',
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
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  toStateBadge: {
    backgroundColor: 'rgba(142, 142, 147, 0.2)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  toStateBadgeText: {
    color: '#3a3a3c',
    fontSize: 11,
    fontWeight: '600',
  },
  detailText: {
    color: '#6c6c70',
    fontSize: 12,
    fontFamily: 'Courier',
    flexShrink: 1,
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
});
