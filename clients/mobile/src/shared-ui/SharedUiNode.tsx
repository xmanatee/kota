import React, { useState } from 'react';
import {
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type {
  UiLinkTarget,
  UiLogEntry,
  UiNode,
} from '../daemon/ui-surface.generated';
import type { LiveUiLogEntries } from '../context/DaemonContext';
import { SharedUiAction } from './SharedUiAction';
import { Section, SharedUiDataNode } from './SharedUiDataNode';
import { assertNever } from './graph';
import { roleColors } from './presentation';
import { nodeStyles as styles } from './node-styles';

export function SharedUiNode({
  node,
  onNavigate,
  onOpenLink,
  hiddenActionIds = new Set(),
  liveLogEntries = {},
  highlightedActionId,
}: {
  node: UiNode;
  onNavigate: (surfaceId: string) => void;
  onOpenLink: (target: UiLinkTarget) => void;
  hiddenActionIds?: ReadonlySet<string>;
  liveLogEntries?: LiveUiLogEntries;
  highlightedActionId?: string;
}) {
  switch (node.kind) {
    case 'navigation':
    case 'status-summary':
    case 'metrics':
    case 'text':
    case 'link':
    case 'list':
    case 'table':
      return (
        <SharedUiDataNode
          node={node}
          onNavigate={onNavigate}
          onOpenLink={onOpenLink}
          highlightedActionId={highlightedActionId}
        />
      );
    case 'tabs':
      return (
        <SharedUiTabs
          node={node}
          onNavigate={onNavigate}
          onOpenLink={onOpenLink}
          hiddenActionIds={hiddenActionIds}
          liveLogEntries={liveLogEntries}
          highlightedActionId={highlightedActionId}
        />
      );
    case 'detail':
      return (
        <Section title={node.title} kind={node.kind}>
          <Text style={styles.body}>{node.body}</Text>
        </Section>
      );
    case 'progress': {
      const percent = node.max > 0
        ? Math.max(0, Math.min(1, node.value / node.max))
        : 0;
      return (
        <View style={styles.section} testID={`ui-node-${node.kind}`}>
          <View style={styles.progressHeader}>
            <Text style={styles.sectionTitle}>{node.label}</Text>
            <Text style={{ color: roleColors[node.role] }}>
              {node.value} / {node.max}
            </Text>
          </View>
          <View
            style={styles.progressTrack}
            accessibilityRole="progressbar"
            accessibilityLabel={node.label}
            accessibilityValue={{
              min: 0,
              max: node.max > 0 ? node.max : 1,
              now: Math.max(0, Math.min(node.value, node.max > 0 ? node.max : 1)),
            }}
          >
            <View style={[styles.progressFill, { width: `${percent * 100}%` }]} />
          </View>
        </View>
      );
    }
    case 'log':
      return (
        <Section title={node.title} kind={node.kind}>
          <LogEntries entries={node.entries} />
        </Section>
      );
    case 'log-stream':
      return (
        <Section title={node.title} kind={node.kind}>
          <Text style={styles.streamMeta}>
            Live from {node.source.path} · {node.source.eventTypes.join(', ')}
          </Text>
          <LogEntries
            entries={[
              ...node.entries,
              ...(liveLogEntries[node.streamId] ?? []),
            ]}
          />
        </Section>
      );
    case 'form':
      return (
        <Section title={node.title} kind={node.kind}>
          <SharedUiAction
            action={node.submit}
            fields={node.fields}
            expanded
            highlighted={node.submit.actionId === highlightedActionId}
          />
        </Section>
      );
    case 'action-list': {
      const visibleActions = node.actions.filter(
        (action) => !hiddenActionIds.has(action.actionId),
      );
      return (
        <Section title={node.title} kind={node.kind}>
          {visibleActions.length > 0 ? (
            <View style={styles.actionList}>
              {visibleActions.map((action) => (
                <SharedUiAction
                  key={action.actionId}
                  action={action}
                  highlighted={action.actionId === highlightedActionId}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>
              {node.actions.length > 0
                ? 'Actions are shown with their related content.'
                : 'No actions available.'}
            </Text>
          )}
        </Section>
      );
    }
    case 'command':
      return (
        <View testID={`ui-node-${node.kind}`}>
          <SharedUiAction
            action={node.action}
            highlighted={node.action.actionId === highlightedActionId}
          />
        </View>
      );
    case 'empty':
    case 'error':
      return (
        <View
          style={[
            styles.messageCard,
            node.kind === 'error' && styles.errorCard,
          ]}
          accessibilityRole={node.kind === 'error' ? 'alert' : undefined}
          testID={`ui-node-${node.kind}`}
        >
          <Text
            style={[
              styles.sectionTitle,
              node.kind === 'error' && styles.errorText,
            ]}
          >
            {node.title}
          </Text>
          <Text style={styles.body}>{node.detail}</Text>
          <SharedUiAction
            action={node.action}
            highlighted={node.action.actionId === highlightedActionId}
          />
        </View>
      );
    default:
      return assertNever(node);
  }
}

function SharedUiTabs({
  node,
  onNavigate,
  onOpenLink,
  hiddenActionIds,
  liveLogEntries,
  highlightedActionId,
}: {
  node: Extract<UiNode, { kind: 'tabs' }>;
  onNavigate: (surfaceId: string) => void;
  onOpenLink: (target: UiLinkTarget) => void;
  hiddenActionIds: ReadonlySet<string>;
  liveLogEntries: LiveUiLogEntries;
  highlightedActionId?: string;
}) {
  const initial = node.tabs.some((tab) => tab.id === node.activeTabId)
    ? node.activeTabId
    : node.tabs[0]?.id;
  const [activeTabId, setActiveTabId] = useState(initial);
  const activeTab = node.tabs.find((tab) => tab.id === activeTabId);

  return (
    <Section title={node.title} kind={node.kind}>
      <View style={styles.tabList} accessibilityRole="tablist">
        {node.tabs.map((tab) => {
          const selected = tab.id === activeTabId;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, selected && styles.selectedTab]}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={tab.label}
              onPress={() => setActiveTabId(tab.id)}
            >
              <Text style={[styles.tabLabel, selected && styles.selectedTabLabel]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {activeTab ? (
        <View style={styles.tabPanel}>
          {activeTab.nodes.map((child, index) => (
            <SharedUiNode
              key={`${child.kind}-${index}`}
              node={child}
              onNavigate={onNavigate}
              onOpenLink={onOpenLink}
              hiddenActionIds={hiddenActionIds}
              liveLogEntries={liveLogEntries}
              highlightedActionId={highlightedActionId}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.muted}>No tab content.</Text>
      )}
    </Section>
  );
}

function LogEntries({ entries }: { entries: readonly UiLogEntry[] }) {
  if (entries.length === 0) return <Text style={styles.muted}>No log entries.</Text>;
  return (
    <View style={styles.logs}>
      {entries.map((entry, index) => (
        <View key={`${entry.timestamp}-${index}`} style={styles.logEntry}>
          <Text style={styles.logMeta}>
            {entry.timestamp} · {entry.level.toUpperCase()}
          </Text>
          <Text style={styles.logMessage}>
            {entry.source ? `${entry.source}: ` : ''}
            {entry.message}
          </Text>
        </View>
      ))}
    </View>
  );
}
