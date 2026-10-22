import AppKit
import SwiftUI

struct FolderDestinationPicker: View {
    let folders: [OrganizationFolder]
    @Binding var selection: String
    var label = "Folder"
    @State private var query = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Find a folder", text: $query)
                .accessibilityLabel("Search folder destinations")
            Picker(label, selection: $selection) {
                Text("Unsorted").tag("")
                ForEach(folders.filter { query.isEmpty || $0.path.localizedCaseInsensitiveContains(query) || $0.id == selection }) { folder in
                    Text(folder.path).tag(folder.id)
                }
            }
        }
    }
}

struct BookmarkEditorView: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(\.dismiss) private var dismiss
    let bookmark: Bookmark
    @State private var title: String
    @State private var folder: String
    @State private var category: String
    @State private var tags: Set<String>
    @State private var reading: ReadingState
    @State private var labelSearch = ""
    @State private var newLabel = ""
    @State private var newKind = "tag"
    @State private var showDiscard = false
    @State private var showNewFolder = false
    @State private var error: String?

    init(bookmark: Bookmark) {
        self.bookmark = bookmark
        _title = State(initialValue: bookmark.title)
        _folder = State(initialValue: bookmark.folderId ?? "")
        _category = State(initialValue: bookmark.categoryId ?? "")
        _tags = State(initialValue: Set(bookmark.tags))
        _reading = State(initialValue: bookmark.canonicalReadingState)
    }
    private var changes: [String: JSONValue] {
        var result: [String: JSONValue] = [:]
        if title != bookmark.title { result["title"] = .string(title.trimmingCharacters(in: .whitespacesAndNewlines)) }
        if folder != (bookmark.folderId ?? "") { result["folderId"] = folder.isEmpty ? .null : .string(folder) }
        if category != (bookmark.categoryId ?? "") { result["categoryId"] = category.isEmpty ? .null : .string(category) }
        if tags != Set(bookmark.tags) { result["tags"] = .array(tags.sorted().map(JSONValue.string)) }
        if reading != bookmark.canonicalReadingState { result["readingState"] = .string(reading.rawValue) }
        return result
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Edit bookmark").font(.title2.weight(.semibold))
                Spacer()
                Button("Cancel") { close() }.keyboardShortcut(.cancelAction)
                Button("Save changes") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut("s", modifiers: .command)
                    .disabled(changes.isEmpty || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.count > 2000 || app.organization.isBusy || (tags.count > 10 && tags.count >= bookmark.tags.count))
            }.padding()
            Divider()
            Form {
                TextField("Title", text: $title, axis: .vertical).lineLimit(2...5)
                HStack {
                    Text(bookmark.url).lineLimit(2).textSelection(.enabled)
                    Spacer()
                    if let url = bookmark.pageURL { Link("Open", destination: url) }
                    Button("Copy URL") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(bookmark.url, forType: .string) }
                }
                Section("Location") {
                    FolderDestinationPicker(folders: app.organization.data?.folders ?? [], selection: $folder)
                    Button("New folder…") { showNewFolder = true }
                    Picker("Topic", selection: $category) {
                        Text("Uncategorized").tag("")
                        ForEach(app.organization.data?.categories ?? []) { Text($0.name).tag($0.id) }
                    }
                }
                Section("Tags · \(tags.count) selected") {
                    TextField("Search tags", text: $labelSearch)
                    ForEach((app.organization.data?.tags ?? []).filter { labelSearch.isEmpty || $0.name.localizedCaseInsensitiveContains(labelSearch) }) { tag in
                        Toggle(tag.name, isOn: Binding(get: { tags.contains(tag.name) }, set: { if $0 { tags.insert(tag.name) } else { tags.remove(tag.name) } }))
                            .disabled(!tags.contains(tag.name) && tags.count >= 10)
                    }
                    ForEach(tags.filter { name in !(app.organization.data?.tags ?? []).contains { $0.name == name } }.sorted(), id: \.self) { name in
                        Toggle(name, isOn: Binding(get: { tags.contains(name) }, set: { if !$0 { tags.remove(name) } }))
                    }
                    if tags.count > 10 { Text("This older bookmark has more than ten tags. Remove tags without losing any automatically.").font(.caption).foregroundStyle(.secondary) }
                }
                DisclosureGroup("New topic or tag…") {
                    Picker("Type", selection: $newKind) { Text("Tag").tag("tag"); Text("Topic").tag("category") }
                    TextField("New label name", text: $newLabel)
                    Button("Create and select") { Task { await createLabel() } }.disabled(newLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || app.organization.isBusy)
                }
                Picker("Reading state", selection: $reading) { ForEach(ReadingState.allCases) { Text($0.title).tag($0) } }
                if let error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
            }.formStyle(.grouped)
        }
        .frame(minWidth: 380, idealWidth: 460, maxWidth: 620, minHeight: 440, idealHeight: 660)
        .onChange(of: changes, initial: true) { _, value in app.organization.editorDirty = !value.isEmpty }
        .interactiveDismissDisabled(!changes.isEmpty || app.organization.isBusy)
        .confirmationDialog("Discard unsaved changes?", isPresented: $showDiscard) { Button("Discard changes", role: .destructive) { app.organization.closeEditor(); dismiss() }; Button("Keep editing", role: .cancel) {} }
        .sheet(isPresented: $showNewFolder) { OrganizationManagerView(initialKind: "folder") }
    }
    private func close() { if changes.isEmpty { app.organization.closeEditor(); dismiss() } else { showDiscard = true } }
    private func save() async {
        guard let result = await app.organization.edit(bookmark, changes: changes) else { error = app.organization.error; return }
        if result.failedCount > 0 { error = result.results.compactMap(\.error?.message).joined(separator: " "); return }
        app.organization.closeEditor(); dismiss()
    }
    private func createLabel() async {
        guard let operation = await app.organization.perform(action: "\(newKind).create", fields: ["name": .string(newLabel.trimmingCharacters(in: .whitespacesAndNewlines))], title: "Create \(newKind)"), operation.failedCount == 0 else { error = app.organization.error; return }
        if newKind == "category", let id = operation.entityId { category = id }
        if newKind == "tag", tags.count < 10, let name = app.organization.data?.tags.first(where: { $0.id == operation.entityId })?.name { tags.insert(name) }
        newLabel = ""
    }
}

struct BulkOrganizationView: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(\.dismiss) private var dismiss
    let selection: OrganizationSelection
    @State private var action = "folderId"
    @State private var destination = ""
    @State private var reading = ReadingState.unread
    @State private var chosenTags = Set<String>()
    @State private var completed = false
    private var sampled: [Bookmark] { app.library.visibleBookmarks.filter { selection.bookmarkIds.contains($0.id) } }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack { Text("Edit \(selection.count) bookmarks").font(.title2.weight(.semibold)); Spacer(); Button("Done") { dismiss() }.disabled(app.organization.isBusy) }
            Text(selection.limited ? "Frozen top \(selection.count) ranked results. New matches are not included." : "Selection is frozen. Only these \(selection.count) bookmarks will change.").foregroundStyle(.secondary)
            if !sampled.isEmpty {
                Text("\(Set(sampled.map(\.category)).count > 1 ? "Multiple topics" : "Topic: \(sampled[0].category)") · \(sampled.count) loaded items")
                let common = sampled.dropFirst().reduce(Set(sampled[0].tags)) { $0.intersection($1.tags) }
                Text("Common tags in loaded items: \(common.sorted().joined(separator: ", ").isEmpty ? "None" : common.sorted().joined(separator: ", "))").font(.caption).foregroundStyle(.secondary)
            }
            Form {
                Picker("Change", selection: $action) { Text("Move to folder").tag("folderId"); Text("Set topic").tag("categoryId"); Text("Add tags").tag("addTags"); Text("Remove tags").tag("removeTags"); Text("Reading state").tag("readingState") }
                if action == "folderId" { FolderDestinationPicker(folders: app.organization.data?.folders ?? [], selection: $destination) }
                else if action == "categoryId" {
                    Picker("Topic", selection: $destination) { Text("Uncategorized").tag(""); ForEach(app.organization.data?.categories ?? []) { Text($0.name).tag($0.id) } }
                } else if action == "readingState" { Picker("Reading state", selection: $reading) { ForEach(ReadingState.allCases) { Text($0.title).tag($0) } } }
                else { ForEach(app.organization.data?.tags ?? []) { tag in Toggle(tag.name, isOn: Binding(get: { chosenTags.contains(tag.name) }, set: { if $0 { chosenTags.insert(tag.name) } else { chosenTags.remove(tag.name) } })) } }
            }.formStyle(.grouped)
            if let error = app.organization.error { Text(error).foregroundStyle(.red) }
            if let notice = app.organization.notice { Text(notice).font(.callout).accessibilityLabel(notice) }
            HStack {
                Text("Unselected fields stay unchanged.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                if app.organization.isBusy { Button("Pause after this batch") { app.organization.pauseRequested = true } }
                else if completed { Button("View results") { app.organization.showHistory = true; dismiss() } }
                else { Button("Apply to \(selection.count) bookmarks") { Task { await app.organization.apply(selection: selection, changes: changes); completed = true } }.buttonStyle(.borderedProminent).disabled((action == "addTags" || action == "removeTags") && chosenTags.isEmpty) }
            }
        }.padding(20).frame(width: 540, height: 540)
        .interactiveDismissDisabled(app.organization.isBusy)
        .onChange(of: action) { _, _ in destination = "" }
    }
    private var changes: [String: JSONValue] {
        switch action {
        case "readingState": [action: .string(reading.rawValue)]
        case "addTags", "removeTags": [action: .array(chosenTags.sorted().map(JSONValue.string))]
        default: [action: destination.isEmpty ? .null : .string(destination)]
        }
    }
}
