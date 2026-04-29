import SwiftUI

// Pending approvals: `ApprovalRow` is mounted by `AttentionInboxView`
// (`OperatorSections.swift`).

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
