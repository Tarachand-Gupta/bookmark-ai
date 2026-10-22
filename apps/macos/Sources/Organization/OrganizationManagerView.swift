import SwiftUI

struct OrganizationManagerView: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var kind: String
    @State private var selected = ""
    @State private var name = ""
    @State private var parent = ""
    @State private var destination = ""
    @State private var children = "parent"
    @State private var review: String?
    @State private var query = ""
    init(initialKind: String = "folder") { _kind = State(initialValue: initialKind) }
    private var kindTitle: String { kind == "category" ? "topic" : kind }
    private var folder: OrganizationFolder? { app.organization.data?.folders.first { $0.id == selected } }
    private var labels: [OrganizationLabel] { kind == "category" ? app.organization.data?.categories ?? [] : app.organization.data?.tags ?? [] }
    private var count: Int { kind == "folder" ? folder?.count ?? 0 : labels.first { $0.id == selected }?.count ?? 0 }
    private var eligibleFolders: [OrganizationFolder] {
        (app.organization.data?.folders ?? []).filter { item in item.id != selected && !(folder.map { item.path.hasPrefix($0.path + "/") } ?? false) }
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack { Text("Manage organization").font(.title2.weight(.semibold)); Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction).disabled(app.organization.isBusy) }.padding()
            Text("Folders keep links together. Topics describe what they are about.").font(.caption).foregroundStyle(.secondary).padding(.horizontal)
            Picker("Type", selection: $kind) { Text("Folders").tag("folder"); Text("Topics").tag("category"); Text("Tags").tag("tag") }.pickerStyle(.segmented).padding(.horizontal)
            HSplitView {
                VStack {
                    TextField("Search names", text: $query).padding([.horizontal, .top])
                    List(selection: $selected) {
                        Text("Create new…").tag("")
                        if kind == "folder" { ForEach((app.organization.data?.folders ?? []).filter { query.isEmpty || $0.path.localizedCaseInsensitiveContains(query) }) { row in Text("\(row.path)  (\(row.count))").tag(row.id) } }
                        else { ForEach(labels.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) }) { row in Text("\(row.name)  (\(row.count))").tag(row.id) } }
                    }
                }.frame(minWidth: 200, idealWidth: 250)
                Form {
                    Text(selected.isEmpty ? "New \(kindTitle)" : "Edit \(kindTitle)").font(.headline)
                    TextField("Name", text: $name)
                    if kind == "folder" { FolderDestinationPicker(folders: eligibleFolders, selection: $parent, label: "Parent") }
                    if !selected.isEmpty { Text("Affects \(count) bookmarks across the whole library.").font(.caption).foregroundStyle(.secondary) }
                    Button(selected.isEmpty ? "Create" : "Save changes") { Task { await save() } }.buttonStyle(.borderedProminent).disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || app.organization.isBusy)
                    if !selected.isEmpty {
                        Divider()
                        if kind == "tag" {
                            Picker("Merge into", selection: $destination) { Text("Choose a tag").tag(""); ForEach(labels.filter { $0.id != selected }) { Text($0.name).tag($0.id) } }
                            Button("Review merge…") { review = "merge" }.disabled(destination.isEmpty)
                        }
                        Button("Review removal…", role: .destructive) { destination = ""; review = "remove" }
                    }
                    if let error = app.organization.error { Text(error).foregroundStyle(.red).textSelection(.enabled) }
                    if let notice = app.organization.notice { Text(notice).foregroundStyle(.secondary) }
                }.formStyle(.grouped).frame(minWidth: 310, idealWidth: 360)
            }.padding(.top)
        }.frame(width: 650, height: 540)
        .onChange(of: selected) { _, _ in populate() }
        .onChange(of: kind) { _, _ in selected = ""; name = ""; parent = ""; destination = ""; query = "" }
        .sheet(isPresented: Binding(get: { review != nil }, set: { if !$0 { review = nil } })) { reviewSheet }
        .task { await app.organization.refresh() }
    }
    private var reviewSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(review == "merge" ? "Merge tags?" : "Remove \(kindTitle)?").font(.title2.weight(.semibold))
            Text("This changes organization for \(count) bookmarks across the whole library. Your bookmarks stay saved.")
            if kind == "folder", let folder {
                Text("\(folder.directCount) directly assigned bookmarks will move to the destination. \(folder.count - folder.directCount) bookmarks in child folders stay inside their folders.").foregroundStyle(.secondary)
                FolderDestinationPicker(folders: eligibleFolders, selection: $destination, label: "Move direct bookmarks to")
                Picker("Child folders", selection: $children) { Text("Move to removed folder's parent").tag("parent"); Text("Move to chosen destination").tag("destination") }
            } else if kind == "category" {
                Picker("Replacement topic", selection: $destination) { Text("Uncategorized").tag(""); ForEach(labels.filter { $0.id != selected }) { Text($0.name).tag($0.id) } }
            } else if review == "merge" {
                Text("Merge into \(labels.first { $0.id == destination }?.name ?? "selected tag"). Existing duplicate tags will collapse.")
            } else { Text("The tag is removed from every bookmark that uses it.") }
            HStack { Button("Cancel") { review = nil }.keyboardShortcut(.cancelAction); Spacer(); Button("Confirm \(review == "merge" ? "merge" : "removal")") { Task { await destructiveAction() } }.buttonStyle(.borderedProminent).disabled(app.organization.isBusy) }
            if let error = app.organization.error { Text(error).foregroundStyle(.red) }
        }.padding(24).frame(width: 500)
        .interactiveDismissDisabled(app.organization.isBusy)
    }
    private func populate() {
        name = kind == "folder" ? folder?.name ?? "" : labels.first { $0.id == selected }?.name ?? ""
        parent = folder?.parentId ?? ""; destination = ""
    }
    private func save() async {
        var fields: [String: JSONValue] = ["name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines))]
        if !selected.isEmpty { fields["id"] = .string(selected) }
        if kind == "folder" {
            fields["parentId"] = parent.isEmpty ? .null : .string(parent)
            if let folder { fields["expected"] = .object(folder.fieldVersions.mapValues(JSONValue.string)) }
        }
        let verb = selected.isEmpty ? "create" : kind == "folder" ? "update" : "rename"
        if let result = await app.organization.perform(action: "\(kind).\(verb)", fields: fields, title: "\(selected.isEmpty ? "Create" : "Update") \(kind)"), result.failedCount == 0 { selected = result.entityId ?? selected; populate() }
    }
    private func destructiveAction() async {
        var fields: [String: JSONValue] = ["id": .string(selected)]
        if kind == "folder" { fields["destinationId"] = destination.isEmpty ? .null : .string(destination); fields["children"] = .string(children) }
        if kind == "category" { fields["replacementId"] = destination.isEmpty ? .null : .string(destination) }
        if review == "merge" { fields = ["sourceId": .string(selected), "targetId": .string(destination)] }
        if let result = await app.organization.perform(action: "\(kind).\(review == "merge" ? "merge" : "remove")", fields: fields, title: "\(review == "merge" ? "Merge" : "Remove") \(kind)"), result.failedCount == 0 { review = nil; selected = ""; populate() }
    }
}

struct RecentChangesView: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 0) {
            HStack { Text("Recent changes").font(.title2.weight(.semibold)); Spacer(); Button("Refresh") { Task { await app.organization.loadHistory() } }; Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) }.padding()
            Text("Undo is available for seven days. Newer edits are preserved; conflicts name the fields that need review.").font(.caption).foregroundStyle(.secondary).padding(.horizontal)
            List {
                if !app.organization.pending.isEmpty {
                    Section("Waiting for confirmation or resume") {
                        ForEach(app.organization.pending) { request in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(request.title)
                                HStack { Button("Check result") { Task { await app.organization.reconcile(request) } }; Button("Retry this action") { Task { await app.organization.resume(request) } } }.disabled(app.organization.isBusy)
                            }.padding(.vertical, 6)
                        }
                    }
                }
                ForEach(app.organization.history) { operation in
                    DisclosureGroup {
                        ForEach(operation.results, id: \.id) { (item: OrganizationItemResult) in
                            VStack(alignment: .leading, spacing: 4) {
                                if item.entityType == "bookmark", let bookmark = app.library.visibleBookmarks.first(where: { $0.id == item.id }) {
                                    Button(item.displayLabel) { app.organization.editing = bookmark; dismiss() }.buttonStyle(.link)
                                } else { Text(item.displayLabel).font(.headline) }
                                Text(item.detail).font(.caption).foregroundStyle(item.error == nil ? Color.secondary : Color.red)
                            }.padding(.vertical, 4)
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(operation.description).font(.headline)
                            Text(operation.summary).font(.caption).foregroundStyle(.secondary)
                            HStack {
                                if operation.canUndo { Button("Undo") { Task { await app.organization.undo(operation) } } }
                                if operation.failedCount > 0 { Button("Retry failed items") { Task { await app.organization.retry(operation) } } }
                                if let date = ISO8601.date(from: operation.createdAt) { Text(date, style: .relative).font(.caption).foregroundStyle(.secondary) }
                            }.disabled(app.organization.isBusy)
                        }.padding(.vertical, 6)
                    }
                }
                if app.organization.history.isEmpty && app.organization.pending.isEmpty { Text("No recent changes. Your next organization action will appear here.").foregroundStyle(.secondary) }
            }
            if let error = app.organization.error { Text(error).font(.callout).foregroundStyle(.red).padding() }
        }.frame(width: 620, height: 580).task { await app.organization.loadHistory() }
    }
}
