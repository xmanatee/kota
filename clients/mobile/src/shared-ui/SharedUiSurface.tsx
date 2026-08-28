import React from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { LiveUiLogEntries } from '../context/DaemonContext';
import type {
  UiLinkTarget,
  UiSurface,
} from '../daemon/ui-surface.generated';
import { SharedUiAction } from './SharedUiAction';
import { SharedUiNode } from './SharedUiNode';
import { embeddedActionIds, referencedActionIds } from './graph';

export function SharedUiSurface({
  surface,
  onNavigate,
  onOpenLink,
  onRefresh,
  refreshing,
  onOpenConnection,
  liveLogEntries = {},
  highlightedActionId,
}: {
  surface: UiSurface;
  onNavigate: (surfaceId: string) => void;
  onOpenLink: (target: UiLinkTarget) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onOpenConnection: () => void;
  liveLogEntries?: LiveUiLogEntries;
  highlightedActionId?: string;
}) {
  const referenced = referencedActionIds(surface.nodes);
  const embedded = embeddedActionIds(surface.nodes);
  const additionalActions = surface.actions.filter(
    (action) => !referenced.has(action.actionId),
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      testID={`ui-surface-${surface.surfaceId}`}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.connectionButton}
          accessibilityRole="button"
          accessibilityLabel="Daemon connection settings"
          onPress={onOpenConnection}
        >
          <Text style={styles.connectionLabel}>Connection</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{surface.title}</Text>
      </View>

      {surface.nodes.map((node, index) => (
        <SharedUiNode
          key={`${node.kind}-${index}`}
          node={node}
          onNavigate={onNavigate}
          onOpenLink={onOpenLink}
          hiddenActionIds={embedded}
          liveLogEntries={liveLogEntries}
          highlightedActionId={highlightedActionId}
        />
      ))}

      {additionalActions.length > 0 ? (
        <View style={styles.additionalActions} testID="ui-surface-actions">
          <Text style={styles.sectionTitle}>Available actions</Text>
          {additionalActions.map((action) => (
            <SharedUiAction
              key={action.actionId}
              action={action}
              highlighted={action.actionId === highlightedActionId}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  content: { gap: 22, padding: 16, paddingBottom: 40 },
  header: {
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#c7c7cc',
    paddingBottom: 16,
  },
  connectionButton: { minHeight: 48, alignSelf: 'flex-end', justifyContent: 'center', paddingHorizontal: 6 },
  connectionLabel: { color: '#0a67c7', fontSize: 12, fontWeight: '600' },
  title: { color: '#1c1c1e', fontSize: 28, fontWeight: '800', letterSpacing: -0.4 },
  additionalActions: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#c7c7cc', paddingTop: 18 },
  sectionTitle: { color: '#1c1c1e', fontSize: 16, fontWeight: '700' },
});
