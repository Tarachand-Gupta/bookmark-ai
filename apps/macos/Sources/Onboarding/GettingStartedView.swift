import SwiftUI

struct GettingStartedView: View {
    var onSaveLink: () -> Void
    var onImport: () -> Void
    var onDismiss: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Make this library yours").font(.title3.weight(.semibold))
            Text("Save a link or bring your existing bookmarks. Then search for a title, organize it, or ask AI about your library.")
                .font(.callout).foregroundStyle(.secondary)
            ViewThatFits(in: .horizontal) {
                HStack {
                    Button("Save a link", action: onSaveLink).buttonStyle(.borderedProminent)
                    Button("Import existing links…", action: onImport)
                    if let onDismiss { Button("Later", action: onDismiss).buttonStyle(.plain) }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Button("Save a link", action: onSaveLink).buttonStyle(.borderedProminent)
                    Button("Import existing links…", action: onImport)
                    if let onDismiss { Button("Later", action: onDismiss).buttonStyle(.plain) }
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))
    }
}
