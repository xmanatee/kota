import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { UiNode } from '../daemon/ui-surface.generated';
import { SharedUiAction } from './SharedUiAction';
import { roleColors, rowActionDefaults } from './presentation';

type TableNode = Extract<UiNode, { kind: 'table' }>;
type TableRow = TableNode['rows'][number];

export function SharedUiTable({
  node,
  highlightedActionId,
}: {
  node: TableNode;
  highlightedActionId?: string;
}) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const filterableColumns = node.columns.filter((column) => column.filterable);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = node.rows.filter((row) => {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      row.cells.some((cell) =>
        cell.value.toLowerCase().includes(normalizedQuery),
      );
    return matchesQuery && filterableColumns.every((column) => {
      const selected = filters[column.id];
      return !selected || cellValue(row, column.id) === selected;
    });
  });
  const showControls = node.searchable === true || filterableColumns.length > 0;

  return (
    <View style={styles.container}>
      {showControls ? (
        <View style={styles.controls} accessibilityLabel={`${node.title} filters`}>
          {node.searchable ? (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={`Search ${node.title.toLowerCase()}`}
              accessibilityLabel={`Search ${node.title}`}
              style={styles.search}
            />
          ) : null}
          {filterableColumns.map((column) => (
            <ScrollView
              key={column.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
              accessibilityLabel={`Filter by ${column.label}`}
            >
              {['', ...columnOptions(node.rows, column.id)].map((option) => {
                const selected = (filters[column.id] ?? '') === option;
                return (
                  <TouchableOpacity
                    key={option ? `value:${option}` : '__all__'}
                    style={[styles.filter, selected && styles.selectedFilter]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() =>
                      setFilters((current) => ({ ...current, [column.id]: option }))
                    }
                  >
                    <Text style={[styles.filterLabel, selected && styles.selectedFilterLabel]}>
                      {option || `All ${column.label.toLowerCase()}`}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ))}
          <Text style={styles.count}>{visibleRows.length}/{node.rows.length}</Text>
        </View>
      ) : null}

      {visibleRows.length === 0 ? (
        <Text style={styles.empty}>
          {node.rows.length === 0 ? 'No records.' : 'No matching records.'}
        </Text>
      ) : (
        <View style={styles.rows}>
          {visibleRows.map((row) => {
            const primary = row.cells.find(
              (cell) => cell.columnId === node.columns[0]?.id,
            );
            return (
              <View key={row.id} style={styles.row}>
                <Text
                  style={[
                    styles.title,
                    {
                      color:
                        roleColors[
                          primary?.role ?? node.columns[0]?.role ?? 'neutral'
                        ],
                    },
                  ]}
                >
                  {primary?.value ?? row.id}
                </Text>
                <View style={styles.details}>
                  {node.columns.slice(1).map((column) => {
                    const cell = row.cells.find(
                      (candidate) => candidate.columnId === column.id,
                    );
                    if (!cell?.value || cell.value === '—') return null;
                    return (
                      <View key={column.id} style={styles.detail}>
                        <Text style={styles.detailLabel}>{column.label}</Text>
                        <Text
                          style={{
                            color:
                              roleColors[
                                cell.role ?? column.role ?? 'neutral'
                              ],
                          }}
                        >
                          {cell.value}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                {row.action ? (
                  <SharedUiAction
                    action={row.action}
                    initialParameters={rowActionDefaults(row.action, row.id)}
                    highlighted={row.action.actionId === highlightedActionId}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function cellValue(row: TableRow, columnId: string): string {
  return row.cells.find((cell) => cell.columnId === columnId)?.value ?? '';
}

function columnOptions(rows: readonly TableRow[], columnId: string): string[] {
  return [...new Set(rows.map((row) => cellValue(row, columnId)).filter(Boolean))].sort();
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  controls: { gap: 8 },
  search: {
    minHeight: 42,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c7c7cc',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    color: '#1c1c1e',
    fontSize: 14,
  },
  filterRow: { gap: 6 },
  filter: {
    minHeight: 34,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#c7c7cc',
    borderRadius: 8,
    paddingHorizontal: 10,
  },
  selectedFilter: { borderColor: '#0a67c7', backgroundColor: '#eaf3fc' },
  filterLabel: { color: '#3a3a3c', fontSize: 12, fontWeight: '500' },
  selectedFilterLabel: { color: '#0a67c7' },
  count: { alignSelf: 'flex-end', color: '#8e8e93', fontSize: 11 },
  rows: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d1d6',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  row: {
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5ea',
    padding: 12,
  },
  title: { fontSize: 15, fontWeight: '700' },
  details: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  detail: { flexDirection: 'row', gap: 5 },
  detailLabel: { color: '#8e8e93', fontSize: 12 },
  empty: { paddingVertical: 24, textAlign: 'center', color: '#8e8e93', fontSize: 13 },
});
