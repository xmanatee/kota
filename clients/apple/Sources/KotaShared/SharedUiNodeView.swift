import SwiftUI

struct SharedUiNodeView: View {
    @EnvironmentObject private var appState: AppState
    let node: UiNode
    let hiddenActionIds: Set<String>
    let onNavigate: (String) -> Void
    let onSessionSelect: (String) -> Void

    var body: some View {
        Group {
            switch node {
            case .navigation(let items, let label):
                SharedUiNodeSection(title: label) {
                    FlowButtons(items: items, onNavigate: onNavigate)
                }
            case .statusSummary(let entries):
                SharedUiStatusSummary(entries: entries)
            case .metrics(let metrics, let title):
                SharedUiNodeSection(title: title) {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))], spacing: 8) {
                        ForEach(Array(metrics.enumerated()), id: \.offset) { _, metric in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(metric.label).font(.caption).foregroundStyle(.secondary)
                                HStack(alignment: .firstTextBaseline, spacing: 3) {
                                    Text(metric.value).font(.title3.weight(.semibold))
                                    if let unit = metric.unit { Text(unit).font(.caption) }
                                }
                                .foregroundStyle(metric.role.color)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(9)
                            .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 7))
                        }
                    }
                }
            case .text(let body, let role, let title):
                SharedUiNodeSection(title: title) {
                    Text(body)
                        .font(.body)
                        .foregroundStyle((role ?? .neutral).color)
                        .textSelection(.enabled)
                }
            case .link(let label, let role, let target):
                SharedUiLinkView(
                    label: label,
                    role: role ?? .info,
                    target: target,
                    onNavigate: onNavigate,
                    onSessionSelect: onSessionSelect
                )
            case .tabs(let activeTabId, let tabs, let title):
                SharedUiTabsView(
                    title: title,
                    activeTabId: activeTabId,
                    tabs: tabs,
                    hiddenActionIds: hiddenActionIds,
                    onNavigate: onNavigate,
                    onSessionSelect: onSessionSelect
                )
            case .list(let items, let title):
                SharedUiNodeSection(title: title) {
                    if items.isEmpty {
                        Text("No items.").foregroundStyle(.secondary)
                    } else {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(items, id: \.id) { item in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(item.title).font(.subheadline.weight(.medium)).foregroundStyle(item.role.color)
                                    Text(item.detail).font(.caption).foregroundStyle(.secondary)
                                    if let action = item.action {
                                        SharedUiActionView(action: action)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.vertical, 8)
                                Divider()
                            }
                        }
                    }
                }
            case .table(let columns, let rows, let searchable, let title):
                SharedUiTableView(
                    title: title,
                    columns: columns,
                    rows: rows,
                    searchable: searchable == true
                )
            case .detail(let body, let title):
                SharedUiNodeSection(title: title) {
                    Text(body).textSelection(.enabled)
                }
            case .progress(let label, let maximum, let role, let value):
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text(label)
                        Spacer()
                        Text("\(value.formatted()) / \(maximum.formatted())")
                            .font(.caption)
                            .foregroundStyle(role.color)
                    }
                    ProgressView(
                        value: maximum > 0 ? min(Swift.max(value, 0), maximum) : 0,
                        total: maximum > 0 ? maximum : 1
                    )
                        .tint(role.color)
                }
            case .log(let entries, let title):
                SharedUiNodeSection(title: title) {
                    SharedUiLogEntriesView(entries: entries)
                }
            case .logStream(let entries, let source, let streamId, let title):
                SharedUiNodeSection(title: title) {
                    HStack(spacing: 5) {
                        Image(systemName: appState.uiSurfaceEventsConnected ? "dot.radiowaves.left.and.right" : "antenna.radiowaves.left.and.right.slash")
                        Text(appState.uiSurfaceEventsConnected ? "Live from \(source.path)" : "Polling · \(source.path)")
                        Text(source.eventTypes.joined(separator: ", "))
                            .lineLimit(1)
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    SharedUiLogEntriesView(entries: entries + (appState.liveUiLogEntries[streamId] ?? []))
                }
            case .form(let fields, let submit, let title):
                SharedUiNodeSection(title: title) {
                    SharedUiActionView(action: submit, fields: fields, expanded: true)
                }
            case .actionList(let actions, let title):
                let visible = actions.filter { !hiddenActionIds.contains($0.actionId) }
                if visible.isEmpty {
                    if actions.isEmpty {
                        SharedUiNodeSection(title: title) {
                            Text("No actions available.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    SharedUiNodeSection(title: title) {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(visible, id: \.actionId) { action in
                                SharedUiActionView(action: action)
                            }
                        }
                    }
                }
            case .command(let action):
                SharedUiActionView(action: action)
            case .empty(let action, let detail, let title):
                SharedUiCallout(title: title, detail: detail, role: .muted) {
                    SharedUiActionView(action: action)
                }
            case .error(let action, let detail, let title):
                SharedUiCallout(title: title, detail: detail, role: .error) {
                    SharedUiActionView(action: action)
                }
            }
        }
        .accessibilityIdentifier("ui-node-\(sharedUiNodeKind(node))")
    }
}

struct SharedUiNodeSection<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct FlowButtons: View {
    let items: [UiNodeNavigationItem]
    let onNavigate: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(items, id: \.surfaceId) { item in
                Button {
                    onNavigate(item.surfaceId)
                } label: {
                    Label(item.label, systemImage: "arrow.right.circle")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.bordered)
            }
        }
    }
}

private struct SharedUiStatusSummary: View {
    let entries: [UiStatusEntry]

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 7) {
            ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                GridRow {
                    Text(entry.label).font(.caption).foregroundStyle(.secondary)
                    Text(entry.value).font(.subheadline.weight(.semibold)).foregroundStyle(entry.role.color)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct SharedUiLinkView: View {
    @EnvironmentObject private var appState: AppState
    let label: String
    let role: UiRole
    let target: UiLinkTarget
    let onNavigate: (String) -> Void
    let onSessionSelect: (String) -> Void

    var body: some View {
        Button {
            switch target {
            case .surface(let surfaceId): onNavigate(surfaceId)
            case .session(let sessionId): onSessionSelect(sessionId)
            case .daemonRoute, .externalUrl: appState.openUiLinkTarget(target)
            }
        } label: {
            Label(label, systemImage: target.systemImage)
        }
        .buttonStyle(.plain)
        .foregroundStyle(role.color)
    }
}

private struct SharedUiTabsView: View {
    let title: String
    let tabs: [UiTab]
    let hiddenActionIds: Set<String>
    let onNavigate: (String) -> Void
    let onSessionSelect: (String) -> Void
    @State private var selectedTabId: String

    init(
        title: String,
        activeTabId: String,
        tabs: [UiTab],
        hiddenActionIds: Set<String>,
        onNavigate: @escaping (String) -> Void,
        onSessionSelect: @escaping (String) -> Void
    ) {
        self.title = title
        self.tabs = tabs
        self.hiddenActionIds = hiddenActionIds
        self.onNavigate = onNavigate
        self.onSessionSelect = onSessionSelect
        _selectedTabId = State(initialValue: tabs.contains { $0.id == activeTabId } ? activeTabId : tabs.first?.id ?? "")
    }

    var body: some View {
        SharedUiNodeSection(title: title) {
            Picker(title, selection: $selectedTabId) {
                ForEach(tabs, id: \.id) { tab in Text(tab.label).tag(tab.id) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            if let selected = tabs.first(where: { $0.id == selectedTabId }) {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(Array(selected.nodes.enumerated()), id: \.offset) { _, node in
                        SharedUiNodeView(
                            node: node,
                            hiddenActionIds: hiddenActionIds,
                            onNavigate: onNavigate,
                            onSessionSelect: onSessionSelect
                        )
                    }
                }
            } else {
                Text("No tab content.").foregroundStyle(.secondary)
            }
        }
    }
}

private struct SharedUiTableView: View {
    let title: String
    let columns: [UiTableColumn]
    let rows: [UiTableRow]
    let searchable: Bool
    @State private var query = ""
    @State private var filters: [String: String] = [:]

    private var filterableColumns: [UiTableColumn] {
        columns.filter { $0.filterable == true }
    }

    private var hasActions: Bool {
        rows.contains { $0.action != nil }
    }

    private var visibleRows: [UiTableRow] {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return rows.filter { row in
            let matchesQuery = normalized.isEmpty || row.cells.contains {
                $0.value.lowercased().contains(normalized)
            }
            return matchesQuery && filterableColumns.allSatisfy { column in
                let selected = filters[column.id] ?? ""
                return selected.isEmpty || cellValue(row, column.id) == selected
            }
        }
    }

    var body: some View {
        SharedUiNodeSection(title: title) {
            if searchable || !filterableColumns.isEmpty {
                if searchable {
                    TextField("Search \(title.lowercased())", text: $query)
                        .textFieldStyle(.roundedBorder)
                }
                HStack(spacing: 8) {
                    ForEach(filterableColumns, id: \.id) { column in
                        Picker(column.label, selection: filterBinding(column.id)) {
                            Text("All \(column.label.lowercased())").tag("")
                            ForEach(columnOptions(column.id), id: \.self) { option in
                                Text(option).tag(option)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                    Spacer()
                    Text("\(visibleRows.count)/\(rows.count)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            if visibleRows.isEmpty {
                Text(rows.isEmpty ? "No records." : "No matching records.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 20)
            } else {
                ScrollView(.horizontal) {
                    Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 7) {
                        GridRow {
                            ForEach(columns, id: \.id) { column in
                                Text(column.label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            }
                            if hasActions { Text("Action").font(.caption.weight(.semibold)) }
                        }
                        Divider()
                        ForEach(visibleRows, id: \.id) { row in
                            GridRow {
                                ForEach(columns, id: \.id) { column in
                                    let cell = row.cells.first { $0.columnId == column.id }
                                    Text(cell?.value ?? "")
                                        .font(.caption)
                                        .foregroundStyle((cell?.role ?? column.role ?? .neutral).color)
                                }
                                if hasActions {
                                    if let action = row.action {
                                        SharedUiActionView(
                                            action: action,
                                            initialParameters: rowActionDefaults(action: action, rowId: row.id)
                                        )
                                    } else {
                                        Color.clear.frame(width: 1, height: 1)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func cellValue(_ row: UiTableRow, _ columnId: String) -> String {
        row.cells.first { $0.columnId == columnId }?.value ?? ""
    }

    private func columnOptions(_ columnId: String) -> [String] {
        Array(Set(rows.map { cellValue($0, columnId) }.filter { !$0.isEmpty })).sorted()
    }

    private func filterBinding(_ columnId: String) -> Binding<String> {
        Binding(
            get: { filters[columnId] ?? "" },
            set: { filters[columnId] = $0 }
        )
    }
}

private struct SharedUiLogEntriesView: View {
    let entries: [UiLogEntry]

    var body: some View {
        if entries.isEmpty {
            Text("No log entries.").font(.caption).foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(entries.enumerated()), id: \.offset) { _, entry in
                    HStack(alignment: .top, spacing: 6) {
                        Circle().fill(entry.level.role.color).frame(width: 6, height: 6).padding(.top, 5)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(entry.message).font(.system(.caption, design: .monospaced))
                            Text([entry.timestamp, entry.source].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }
}

private struct SharedUiCallout<Content: View>: View {
    let title: String
    let detail: String
    let role: UiRole
    let content: Content

    init(title: String, detail: String, role: UiRole, @ViewBuilder content: () -> Content) {
        self.title = title
        self.detail = detail
        self.role = role
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline).foregroundStyle(role.color)
            Text(detail).font(.caption).foregroundStyle(.secondary)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(11)
        .background(role.color.opacity(0.09), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(role.color.opacity(0.28)))
    }
}

func sharedUiNodeKind(_ node: UiNode) -> String {
    switch node {
    case .navigation: return "navigation"
    case .statusSummary: return "status-summary"
    case .metrics: return "metrics"
    case .text: return "text"
    case .link: return "link"
    case .tabs: return "tabs"
    case .list: return "list"
    case .table: return "table"
    case .detail: return "detail"
    case .progress: return "progress"
    case .log: return "log"
    case .logStream: return "log-stream"
    case .form: return "form"
    case .actionList: return "action-list"
    case .command: return "command"
    case .empty: return "empty"
    case .error: return "error"
    }
}

private extension UiLinkTarget {
    var systemImage: String {
        switch self {
        case .surface: return "rectangle.on.rectangle"
        case .session: return "bubble.left.and.bubble.right"
        case .daemonRoute: return "network"
        case .externalUrl: return "arrow.up.right.square"
        }
    }
}
