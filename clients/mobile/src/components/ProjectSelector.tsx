import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDaemon } from '../context/DaemonContext';

/**
 * Header project selector. Hidden when the daemon hosts exactly one
 * project so KOTA-on-itself looks identical to the pre-multi-project
 * experience. Mirrors the web `ProjectSelector` and the apple
 * `ProjectSelectorView` semantics: tapping a chip drives
 * `setActiveProjectId(...)`, which threads through every project-scoped
 * daemon route in `fetchAll`.
 */
export function ProjectSelector() {
  const { state, setActiveProjectId } = useDaemon();
  const identity = state.identity;
  if (!identity || identity.projects.projects.length <= 1) return null;
  const activeId = state.activeProjectId ?? identity.projects.defaultProjectId;
  return (
    <View style={styles.container} testID="project-selector">
      <Text style={styles.label}>Project</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {identity.projects.projects.map((entry) => {
          const active = entry.projectId === activeId;
          return (
            <TouchableOpacity
              key={entry.projectId}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setActiveProjectId(entry.projectId)}
              testID={`project-selector-chip-${entry.projectId}`}
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
