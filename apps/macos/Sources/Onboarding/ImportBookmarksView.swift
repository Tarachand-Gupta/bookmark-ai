import SwiftUI

struct ImportBookmarksView: View {
    @Environment(AppEnvironment.self) private var appEnvironment
    @Environment(\.dismiss) private var dismiss
    @State private var model = ImportBookmarksModel()
    @State private var visibleCount = 100
    @State private var showHelp = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Import existing links").font(.title2.weight(.semibold))
                    Text("Review before saving. Existing library links stay unchanged.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button(model.busy && model.job != nil ? "Pause and close" : "Done") { close() }
                    .keyboardShortcut(.cancelAction)
            }.padding(20)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let error = model.error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
                    if let job = model.job { progress(job) }
                    else if let preview = model.preview { review(preview) }
                    else { sourcePicker }
                    if model.busy { ProgressView(model.job == nil ? "Reading links… Nothing is saved yet." : "Importing links…") }
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(minWidth: 430, idealWidth: 620, maxWidth: 760, minHeight: 420, idealHeight: 640, maxHeight: 780)
        .task { await model.prepare(api: appEnvironment.api) }
        .onDisappear { model.pause() }
        .onChange(of: appEnvironment.auth.status) { _, status in
            if status == .signedOut { model.invalidateAccount(); dismiss() }
        }
        .onChange(of: appEnvironment.auth.account?.accountId) { old, new in
            if old != nil && old != new { model.invalidateAccount(); dismiss() }
        }
        .onChange(of: appEnvironment.api.target.baseURL.absoluteString) { _, _ in
            model.invalidateAccount(); dismiss()
        }
    }

    private var sourcePicker: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("From a browser").font(.headline)
            Text("Choose a bookmarks HTML export, Markdown or plain text file. Up to 5 MB and 5,000 links.").foregroundStyle(.secondary)
            Button("Choose file…") { Task { await model.chooseFile(api: appEnvironment.api) } }
                .disabled(model.busy || !model.connected)
            DisclosureGroup("How to export bookmarks", isExpanded: $showHelp) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Chrome: Bookmark manager → menu → Export bookmarks.")
                    Text("Firefox: Manage bookmarks → Import and Backup → Export Bookmarks to HTML.")
                    Text("Safari: File → Export Browsing Data to File → select Bookmarks only. Extract the ZIP in Finder, then choose its bookmarks HTML file. Older versions offer File → Export → Bookmarks.")
                    Text("Safari extensions cannot access iCloud bookmarks. If iCloud already syncs your bookmarks to this Mac, export the bookmarks visible in Safari.")
                }.font(.callout).foregroundStyle(.secondary).padding(.top, 8)
            }
            Divider()
            Text("Links from notes").font(.headline)
            Text("Paste links or Markdown. Only web links are saved; note text and attachments remain in the original app.").foregroundStyle(.secondary)
            TextEditor(text: $model.paste).font(.body).frame(minHeight: 120).padding(6)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(nsColor: .separatorColor)))
                .accessibilityLabel("Links or Markdown to import")
                .disabled(model.busy)
            Button("Preview links") { Task { await model.previewPaste(api: appEnvironment.api) } }
                .disabled(model.paste.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.busy || !model.connected)
            Text("For a Bookmark AI JSON backup, use Settings → Data → Restore backup.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func review(_ preview: BookmarkImportPreview) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(model.sourceName).font(.headline).textSelection(.enabled)
            Text("\(preview.items.count - preview.existingCount) ready · \(preview.existingCount) already saved · \(preview.duplicateCount) repeated · \(preview.invalidCount) invalid")
                .font(.callout)
            ForEach(preview.warnings, id: \.self) { Text($0).font(.callout).foregroundStyle(.secondary) }
            if preview.items.contains(where: { !$0.folderPath.isEmpty }) {
                Toggle("Keep source folders", isOn: $model.preserveFolders)
                if !model.preserveFolders { Text("New links will go to Unsorted.").font(.caption).foregroundStyle(.secondary) }
            }
            if preview.items.isEmpty { Text("No usable web links were found. Choose another export or paste HTTP(S) links.") }
            ForEach(Array(preview.items.prefix(visibleCount))) { item in
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title).fontWeight(.medium)
                    Text(item.url).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    Text("\(item.folderPath.isEmpty ? "Unsorted" : item.folderPath.joined(separator: " / ")) · \(item.status == "existing" ? "Already saved" : "Ready")")
                        .font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading)
                Divider()
            }
            if visibleCount < preview.items.count { Button("Show more") { visibleCount += 100 } }
            HStack {
                Button("Choose another source") { model.chooseAnotherSource(); visibleCount = 100 }
                Spacer()
                Button("Import \(preview.items.count - preview.existingCount) links") {
                    Task { await model.start(api: appEnvironment.api); await refreshLibrary() }
                }.buttonStyle(.borderedProminent)
                    .disabled(model.busy || preview.items.count == preview.existingCount)
            }
        }
    }

    private func progress(_ job: BookmarkImportJob) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(job.status == "completed" ? (job.failed > 0 ? "Import finished with failures" : "Your links are ready") : (model.busy ? "Importing links…" : "Import paused"))
                .font(.headline)
            Text("\(job.imported) imported · \(job.existing) already saved · \(job.failed) failed · \(job.remaining) remaining")
            ProgressView(value: Double(job.outcomes.count), total: Double(max(job.items.count, 1)))
                .accessibilityLabel("Import progress")
            if let error = job.error { Text(error).font(.callout).foregroundStyle(.red) }
            Text("Progress is saved for this account on this Mac. Closing pauses after the current batch. Reopen Import to continue.")
                .font(.callout).foregroundStyle(.secondary)
            ForEach(job.outcomes.filter { $0.status == "failed" }) { item in
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.url).textSelection(.enabled)
                    if let error = item.error { Text(error).foregroundStyle(.secondary) }
                }.font(.callout)
            }
            HStack {
                if !model.busy && job.remaining > 0 {
                    Button("Resume import") { Task { await model.resume(api: appEnvironment.api); await refreshLibrary() } }
                }
                if !model.busy && job.failed > 0 && job.pending == nil {
                    Button("Retry failed links") { Task { await model.retryFailed(api: appEnvironment.api); await refreshLibrary() } }
                }
                if !model.busy && job.status == "completed" {
                    Button("Start another import") { model.clearCompleted() }
                    Spacer()
                    Button("Go to library") { close() }.buttonStyle(.borderedProminent)
                }
            }
            if job.status == "completed" {
                Text("Find a saved title with Search, open a folder, or ask AI about your library.").font(.callout).foregroundStyle(.secondary)
            }
        }
    }

    private func refreshLibrary() async {
        if (model.job?.imported ?? 0) > 0 { await appEnvironment.loadEverything() }
    }

    private func close() { model.pause(); dismiss() }
}
