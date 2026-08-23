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
} from '../daemon/conformance/ui-surface.generated';
import { SharedUiAction } from './SharedUiAction';
import { SharedUiNode } from './SharedUiNode';
import { embeddedActionIds, referencedActionIds } from './graph';
import { conditionLabel, permissionLabel } from './presentation';

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
        <View style={styles.headerTop}>
          <View style={styles.intentBadge}>
            <Text style={styles.intentLabel}>{surface.intent}</Text>
          </View>
          <Text style={styles.extension}>{surface.extensionId}</Text>
          <TouchableOpacity
            style={styles.connectionButton}
            accessibilityRole="button"
            accessibilityLabel="Daemon connection settings"
            onPress={onOpenConnection}
          >
            <Text style={styles.connectionLabel}>Connection</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>{surface.title}</Text>
        <Text style={styles.protocol}>
          Shared operator surface · {surface.protocolVersion}
        </Text>
        <Text style={styles.scope} numberOfLines={1}>
          {surface.scopeId}
        </Text>
        {surface.conditions?.length || surface.permissions?.length ? (
          <View style={styles.requirements} accessibilityLabel="Surface requirements">
            {surface.conditions?.map((condition, index) => (
              <View key={`${conditionLabel(condition)}-${index}`} style={styles.requirement}>
                <Text style={styles.requirementLabel}>{conditionLabel(condition)}</Text>
              </View>
            ))}
            {surface.permissions?.map((permission, index) => (
              <View key={`${permissionLabel(permission)}-${index}`} style={styles.requirement}>
                <Text style={styles.requirementLabel}>{permissionLabel(permission)}</Text>
              </View>
            ))}
          </View>
        ) : null}
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
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  intentBadge: { borderRadius: 12, backgroundColor: '#eaf3fc', paddingHorizontal: 9, paddingVertical: 4 },
  intentLabel: { color: '#0a67c7', fontSize: 11, fontWeight: '700' },
  extension: { flex: 1, color: '#6c6c70', fontSize: 11 },
  connectionButton: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 6 },
  connectionLabel: { color: '#0a67c7', fontSize: 12, fontWeight: '600' },
  title: { color: '#1c1c1e', fontSize: 28, fontWeight: '800', letterSpacing: -0.4 },
  protocol: { color: '#6c6c70', fontSize: 13 },
  scope: { color: '#8e8e93', fontSize: 11 },
  requirements: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  requirement: { borderRadius: 10, backgroundColor: '#e5e5ea', paddingHorizontal: 8, paddingVertical: 4 },
  requirementLabel: { color: '#3a3a3c', fontSize: 10, fontWeight: '600' },
  additionalActions: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#c7c7cc', paddingTop: 18 },
  sectionTitle: { color: '#1c1c1e', fontSize: 16, fontWeight: '700' },
});
