import SwiftUI

struct ApprovalsView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        if appState.pendingApprovals.isEmpty { return AnyView(EmptyView()) }

        return AnyView(
            VStack(alignment: .leading, spacing: 0) {
                Divider()
                Text("Pending Approvals")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                    .padding(.bottom, 4)

                ForEach(appState.pendingApprovals) { approval in
                    ApprovalRow(approval: approval)
                }
            }
        )
    }
}

struct ApprovalRow: View {
    @EnvironmentObject var appState: AppState
    let approval: ApprovalRequest
    @State private var isProcessing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Circle()
                    .fill(riskColor)
                    .frame(width: 8, height: 8)
                Text(approval.tool)
                    .font(.system(.body, design: .monospaced))
                    .fontWeight(.medium)
                Spacer()
                Text(approval.risk)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if let reason = approval.reason, !reason.isEmpty {
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            HStack(spacing: 8) {
                Button("Approve") {
                    isProcessing = true
                    Task {
                        await appState.approve(id: approval.id)
                        isProcessing = false
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(isProcessing)

                Button("Reject") {
                    isProcessing = true
                    Task {
                        await appState.reject(id: approval.id)
                        isProcessing = false
                    }
                }
                .buttonStyle(.bordered)
                .tint(.red)
                .disabled(isProcessing)

                if isProcessing {
                    ProgressView().scaleEffect(0.6)
                }
            }
            .font(.caption)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)

        Divider().padding(.leading, 12)
    }

    var riskColor: Color {
        switch approval.risk {
        case "dangerous": return .red
        case "elevated": return .orange
        default: return .yellow
        }
    }
}
