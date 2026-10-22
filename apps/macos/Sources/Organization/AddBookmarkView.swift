import SwiftUI

struct AddBookmarkView: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var requestId = UUID().uuidString
    @State private var saved: SavedBookmarkEnvelope?
    @State private var busy = false
    @State private var requestStarted = false
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Text(saved == nil ? "Save a link" : saved?.existing == true ? "Already saved" : "Link saved").font(.title2.weight(.semibold)); Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy) }
            if let saved {
                Text(saved.bookmark.displayTitle).font(.headline)
                Text(saved.bookmark.url).foregroundStyle(.secondary).textSelection(.enabled)
                Text("Your link is saved. Organizing it is optional.")
                HStack {
                    Button("Edit details…") { app.organization.editing = saved.bookmark; dismiss() }.disabled(!app.organization.available)
                    Spacer()
                    Button("Save another") { self.saved = nil; url = ""; requestId = UUID().uuidString; requestStarted = false }
                }
            } else {
                TextField("https://example.com", text: $url).textFieldStyle(.roundedBorder).accessibilityLabel("Link URL").disabled(busy || requestStarted)
                Text("Save now, organize afterward.").foregroundStyle(.secondary)
                if busy { ProgressView("Saving…") }
                Button(error == nil ? "Save link" : "Retry save") { Task { await save() } }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(busy || URL(string: url)?.host == nil)
            }
            if let error {
                Text(error).foregroundStyle(.red).textSelection(.enabled)
                Button("Start another save") { url = ""; requestId = UUID().uuidString; requestStarted = false; self.error = nil }
                    .disabled(busy)
                Text("The earlier request stays in Recent changes for explicit recovery.").font(.caption).foregroundStyle(.secondary)
            }
        }.padding(24).frame(width: 500).interactiveDismissDisabled(busy)
    }
    private func save() async {
        requestStarted = true
        busy = true; defer { busy = false }
        saved = await app.organization.save(url: url, requestId: requestId)
        error = saved == nil ? app.organization.error : nil
    }
}
