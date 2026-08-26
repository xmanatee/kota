import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDaemon } from '../context/DaemonContext';

/**
 * Header scope selector. Hidden when the daemon hosts exactly one directory
 * scope. Tapping a chip drives `setActiveScopeId(...)`, which threads through
 * every scope-aware
 * daemon route in `fetchAll`.
 */
export function ScopeSelector() {
  const { state, setActiveScopeId } = useDaemon();
  const identity = state.connection.identity;
  const scopes = identity?.scopeRegistry.scopes.filter(
    (scope) => scope.directoryRoot !== undefined,
  );
  if (!identity || !scopes || scopes.length <= 1) return null;
  const activeId = state.scope.activeScopeId ?? identity.scopeRegistry.defaultScopeId;
  return (
    <View style={styles.container} testID="scope-selector">
      <Text style={styles.label}>Scope</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {scopes.map((entry) => {
          const active = entry.scopeId === activeId;
          return (
            <TouchableOpacity
              key={entry.scopeId}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setActiveScopeId(entry.scopeId)}
              testID={`scope-selector-chip-${entry.scopeId}`}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {entry.displayName}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#e5e5ea',
    gap: 8,
  },
  label: { fontSize: 13, color: '#6c6c70', fontWeight: '600' },
  chipRow: { gap: 8, paddingRight: 16 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d1d1d6',
  },
  chipActive: {
    backgroundColor: '#007aff',
    borderColor: '#007aff',
  },
  chipText: { fontSize: 13, color: '#1c1c1e' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
});
