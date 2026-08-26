import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type {
  UiLinkTarget,
  UiNode,
} from '../daemon/ui-surface.generated';
import { SharedUiAction } from './SharedUiAction';
import { assertNever } from './graph';
import { roleColors, rowActionDefaults } from './presentation';

type DataNode = Extract<
  UiNode,
  {
    kind:
      | 'navigation'
      | 'status-summary'
      | 'metrics'
      | 'text'
      | 'link'
      | 'list'
      | 'table';
  }
>;

export function SharedUiDataNode({
  node,
  onNavigate,
  onOpenLink,
  highlightedActionId,
}: {
  node: DataNode;
  onNavigate: (surfaceId: string) => void;
  onOpenLink: (target: UiLinkTarget) => void;
  highlightedActionId?: string;
}) {
  switch (node.kind) {
    case 'navigation':
      return (
        <Section title={node.label} kind={node.kind}>
          <View style={styles.buttonWrap}>
            {node.items.map((item) => (
              <TouchableOpacity
                key={item.surfaceId}
                style={styles.outlineButton}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                onPress={() => onNavigate(item.surfaceId)}
              >
                <Text style={styles.outlineButtonLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>
      );
    case 'status-summary':
      return (
        <View
          style={styles.summary}
          accessibilityLabel="Status summary"
          testID="ui-node-status-summary"
        >
          {node.entries.map((entry, index) => (
            <View
              key={`${entry.label}:${entry.value}:${index}`}
              style={styles.summaryEntry}
            >
              <Text style={styles.summaryLabel}>{entry.label}</Text>
              <Text
                style={[styles.summaryValue, { color: roleColors[entry.role] }]}
                numberOfLines={2}
              >
                {entry.value}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'metrics':
      return (
        <Section title={node.title} kind={node.kind}>
          <View style={styles.metrics}>
            {node.metrics.map((metric, index) => (
              <View key={`${metric.label}:${index}`} style={styles.metric}>
                <Text style={styles.summaryLabel}>{metric.label}</Text>
                <Text
                  style={[styles.metricValue, { color: roleColors[metric.role] }]}
                >
                  {metric.value}
                  {metric.unit ? (
                    <Text style={styles.metricUnit}> {metric.unit}</Text>
                  ) : null}
                </Text>
              </View>
            ))}
          </View>
        </Section>
      );
    case 'text':
      return (
        <Section title={node.title} kind={node.kind}>
          <Text style={[styles.bodyText, { color: roleColors[node.role ?? 'neutral'] }]}>
            {node.body}
          </Text>
        </Section>
      );
    case 'link':
      return (
        <TouchableOpacity
          style={styles.link}
          accessibilityRole="link"
          accessibilityLabel={node.label}
          onPress={() =>
            node.target.kind === 'surface'
              ? onNavigate(node.target.surfaceId)
              : onOpenLink(node.target)
          }
          testID="ui-node-link"
        >
          <Text style={[styles.linkLabel, { color: roleColors[node.role ?? 'info'] }]}>
            {node.label} ↗
          </Text>
        </TouchableOpacity>
      );
    case 'list':
      return (
        <Section title={node.title} kind={node.kind}>
          {node.items.length === 0 ? (
            <Text style={styles.muted}>No items.</Text>
          ) : (
            <View style={styles.list}>
              {node.items.map((item) => (
                <View key={item.id} style={styles.listItem}>
                  <Text
                    style={[styles.itemTitle, { color: roleColors[item.role] }]}
                  >
                    {item.title}
                  </Text>
                  <Text style={styles.itemDetail}>{item.detail}</Text>
                  {item.action ? (
                    <SharedUiAction
                      action={item.action}
                      highlighted={item.action.actionId === highlightedActionId}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </Section>
      );
    case 'table':
      return (
        <Section title={node.title} kind={node.kind}>
          {node.rows.length === 0 ? (
            <Text style={styles.muted}>No rows.</Text>
          ) : (
            <View style={styles.list}>
              {node.rows.map((row) => (
                <View key={row.id} style={styles.tableRow}>
                  {node.columns.map((column) => {
                    const cell = row.cells.find(
                      (candidate) => candidate.columnId === column.id,
                    );
                    return (
                      <View key={column.id} style={styles.tableCell}>
                        <Text style={styles.summaryLabel}>{column.label}</Text>
                        <Text
                          style={{
                            color: roleColors[
                              cell?.role ?? column.role ?? 'neutral'
                            ],
                          }}
                        >
                          {cell?.value ?? ''}
                        </Text>
                      </View>
                    );
                  })}
                  {row.action ? (
                    <SharedUiAction
                      action={row.action}
                      initialParameters={rowActionDefaults(row.action, row.id)}
                      highlighted={row.action.actionId === highlightedActionId}
                    />
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </Section>
      );
    default:
      return assertNever(node);
  }
}

export function Section({
  title,
  kind,
  children,
}: {
  title: string;
  kind: UiNode['kind'];
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section} testID={`ui-node-${kind}`}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  sectionTitle: { color: '#1c1c1e', fontSize: 16, fontWeight: '700' },
  buttonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  outlineButton: {
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#c7c7cc',
    borderRadius: 9,
    paddingHorizontal: 14,
  },
  outlineButtonLabel: { color: '#0a67c7', fontSize: 14, fontWeight: '600' },
  summary: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d1d6',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  summaryEntry: {
    width: '50%',
    minHeight: 72,
    justifyContent: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    padding: 12,
  },
  summaryLabel: {
    color: '#6c6c70',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  summaryValue: { fontSize: 15, fontWeight: '700' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: {
    minWidth: '46%',
    flexGrow: 1,
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d1d6',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    padding: 14,
  },
  metricValue: { fontSize: 24, fontWeight: '700' },
  metricUnit: { color: '#6c6c70', fontSize: 13, fontWeight: '400' },
  bodyText: { fontSize: 14, lineHeight: 21 },
  link: { minHeight: 48, alignSelf: 'flex-start', justifyContent: 'center' },
  linkLabel: { fontSize: 14, fontWeight: '600' },
  list: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d1d6',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  listItem: {
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    padding: 14,
  },
  itemTitle: { fontSize: 15, fontWeight: '700' },
  itemDetail: { color: '#6c6c70', fontSize: 13, lineHeight: 19 },
  tableRow: {
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    padding: 14,
  },
  tableCell: { gap: 3 },
  muted: { color: '#6c6c70', fontSize: 13 },
});
