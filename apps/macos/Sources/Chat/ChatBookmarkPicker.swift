import SwiftUI

/// Explicit context selection; choosing saved links never saves duplicate bookmarks.
struct ChatBookmarkPicker: View {
    @Environment(AppEnvironment.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var rows: [Bookmark] = []
    @State private var selected = Set<String>()
    @State private var isLoading = false
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text("Select saved bookmarks").font(.title2.weight(.semibold)); Spacer(); Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction) }
            TextField("Search saved links", text: $query)
            HStack { Text("\(selected.count) selected · up to 1,000").font(.caption); Spacer(); if isLoading { ProgressView().controlSize(.small) } }
            List(rows) { bookmark in
                Toggle(isOn: Binding(get: { selected.contains(bookmark.id) }, set: { if $0 { selected.insert(bookmark.id) } else { selected.remove(bookmark.id) } })) {
                    VStack(alignment: .leading) { Text(bookmark.displayTitle); Text(bookmark.url).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }.disabled(selected.count >= 1000 && !selected.contains(bookmark.id))
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack { Text("Only these selected links become context.").font(.caption).foregroundStyle(.secondary); Spacer(); Button("Add context") { app.chat.show(context: .bookmarks(selected.sorted())); dismiss() }.buttonStyle(.borderedProminent).disabled(selected.isEmpty) }
        }.padding(20).frame(width: 520, height: 480)
        .onAppear { selected = Set(app.chat.context.bookmarkIds ?? []) }
        .task(id: query) { await search() }
    }
    private func search() async {
        guard app.canUseData else { return }
        let scope = app.organization.scope
        do {
            try await Task.sleep(for: .milliseconds(query.isEmpty ? 0 : 200))
            isLoading = true
            let result: [Bookmark]
            if query.isEmpty { result = try await app.api.listBookmarks(limit: 100).bookmarks }
            else { result = try await app.api.search(query: query, limit: 50).results.map(\.bookmark) }
            guard !Task.isCancelled, scope == app.organization.scope else { return }
            rows = result; error = nil; isLoading = false
        } catch {
            guard !Task.isCancelled, scope == app.organization.scope else { return }
            self.error = "Couldn't load saved links. Try another search or reopen this picker."; isLoading = false
        }
    }
}
