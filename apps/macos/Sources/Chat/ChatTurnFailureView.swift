import SwiftUI

/// Under a prompt whose turn produced nothing to show: the plain fact and a
/// Retry — never a silently vanished Thinking placeholder.
struct ChatTurnFailureView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            Text(message)
                .font(.callout)
            Spacer(minLength: 8)
            Button("Retry", action: onRetry)
                .controlSize(.small)
                .pointingHandCursor()
                .help("Send the same message again")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: 560, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(.red.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .strokeBorder(.red.opacity(0.35), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
