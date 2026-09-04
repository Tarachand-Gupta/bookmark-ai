import AppKit
import SwiftUI

/// Copy-to-clipboard with the "Copied" confirmation — one implementation for
/// every snippet/secret the app offers (Settings ▸ MCP). Small bordered button
/// so it sits naturally beside a code block in a grouped Form.
struct CopyButton: View {
    let value: String
    var label = "Copy"

    @State private var didCopy = false

    var body: some View {
        Button {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(value, forType: .string)
            didCopy = true
            Task {
                try? await Task.sleep(for: .seconds(1.5))
                didCopy = false
            }
        } label: {
            Label(didCopy ? "Copied" : label, systemImage: didCopy ? "checkmark" : "doc.on.doc")
                .frame(minWidth: 64)
        }
        .controlSize(.small)
        .pointingHandCursor()
        .help("Copy to the clipboard")
    }
}

/// A monospace block for endpoints, snippets and secrets. Wraps mid-token so a
/// 260-character token is fully visible inside a 500pt Settings window — a
/// secret you have to scroll sideways to verify is a worse trade than a few
/// extra lines.
struct CodeBlockText: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11, design: .monospaced))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(8)
            .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(.separator.opacity(0.6), lineWidth: 1)
            )
    }
}
