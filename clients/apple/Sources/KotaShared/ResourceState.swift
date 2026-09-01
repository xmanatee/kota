import SwiftUI

struct ResourceIssue: Equatable {
    let title: String
    let detail: String
}

enum ResourceFailure: Equatable {
    case offline(ResourceIssue)
    case unavailable(ResourceIssue)
    case failed(ResourceIssue)
}

enum ResourceState<Value> {
    case idle
    case loading(previous: Value?)
    case loaded(Value)
    case empty
    case offline(ResourceIssue)
    case unavailable(ResourceIssue)
    case failed(ResourceIssue, previous: Value?)

    var value: Value? {
        switch self {
        case .loading(let previous): return previous
        case .loaded(let value): return value
        case .failed(_, let previous): return previous
        case .idle, .empty, .offline, .unavailable: return nil
        }
    }

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }
}

/// The single transition owner for daemon-backed Apple resources. It keeps a
/// previously rendered value during refresh and makes empty, connectivity,
/// semantic availability, and recoverable failure mutually exclusive.
struct ResourceStateOwner<Value> {
    private(set) var state: ResourceState<Value> = .idle

    var value: Value? { state.value }
    var isLoading: Bool { state.isLoading }

    mutating func beginLoading() {
        state = .loading(previous: state.value)
    }

    mutating func resolve(_ value: Value, isEmpty: (Value) -> Bool) {
        state = isEmpty(value) ? .empty : .loaded(value)
    }

    mutating func reject(_ failure: ResourceFailure) {
        let previous = state.value
        switch failure {
        case .offline(let issue): state = .offline(issue)
        case .unavailable(let issue): state = .unavailable(issue)
        case .failed(let issue): state = .failed(issue, previous: previous)
        }
    }

    mutating func cancelLoading() {
        guard case .loading(let previous) = state else { return }
        state = previous.map(ResourceState.loaded) ?? .idle
    }

    mutating func reset() {
        state = .idle
    }
}

/// Composable SwiftUI presentation for the shared resource lifecycle. Domain
/// screens supply only their loaded and empty bodies; common progress, retry,
/// offline, unavailable, and failure rendering stays here.
struct ResourceStateShell<Value, Content: View, EmptyContent: View>: View {
    let state: ResourceState<Value>
    let loadingLabel: String
    let retry: () -> Void
    let content: (Value) -> Content
    let emptyContent: () -> EmptyContent

    init(
        state: ResourceState<Value>,
        loadingLabel: String,
        retry: @escaping () -> Void,
        @ViewBuilder content: @escaping (Value) -> Content,
        @ViewBuilder emptyContent: @escaping () -> EmptyContent
    ) {
        self.state = state
        self.loadingLabel = loadingLabel
        self.retry = retry
        self.content = content
        self.emptyContent = emptyContent
    }

    @ViewBuilder
    var body: some View {
        switch state {
        case .idle:
            loadingView
        case .loading(let previous):
            if let previous {
                content(previous)
                    .overlay(alignment: .topTrailing) {
                        ProgressView()
                            .controlSize(.small)
                            .padding(8)
                            .accessibilityLabel(loadingLabel)
                    }
            } else {
                loadingView
            }
        case .loaded(let value):
            content(value)
        case .empty:
            emptyContent()
        case .offline(let issue), .unavailable(let issue):
            ResourceIssueView(issue: issue, retry: retry)
        case .failed(let issue, let previous):
            if let previous {
                content(previous)
                    .overlay(alignment: .top) {
                        ResourceRefreshFailureView(issue: issue, retry: retry)
                    }
            } else {
                ResourceIssueView(issue: issue, retry: retry)
            }
        }
    }

    private var loadingView: some View {
        VStack(spacing: 10) {
            ProgressView()
            Text(loadingLabel)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("resource-loading")
    }
}

private struct ResourceRefreshFailureView: View {
    let issue: ResourceIssue
    let retry: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(issue.detail)
                .font(.caption)
                .lineLimit(2)
            Spacer(minLength: 0)
            Button("Try Again", action: retry).buttonStyle(.borderless)
        }
        .padding(8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8))
        .padding(8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(issue.title): \(issue.detail)")
        .accessibilityIdentifier("resource-refresh-failure")
    }
}

private struct ResourceIssueView: View {
    let issue: ResourceIssue
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "rectangle.3.group.bubble.left")
                .font(.title)
                .foregroundStyle(.secondary)
            Text(issue.title).font(.headline)
            Text(issue.detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Try Again", action: retry).buttonStyle(.bordered)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("resource-issue")
    }
}
