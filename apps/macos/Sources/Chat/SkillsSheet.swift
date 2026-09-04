import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// ⋯ ▸ Skills… — the skills manager as a master/detail sheet: the list (with
/// enabled switches) on the left, the editor on the right; New offers a blank
/// skill or one of three starter templates; Import… (or a SKILL.md dropped on
/// the list) opens the editor prefilled; the empty state teaches what a skill
/// is and offers the templates directly. Esc / Done closes, ⌘S saves.
struct SkillsSheet: View {
    @Environment(AppEnvironment.self) private var appEnvironment
    @Environment(\.dismiss) private var dismiss

    /// What the editor holds. `.new` carries the template it started from.
    private enum Editing: Equatable {
        case none
        case new(SkillTemplate?)
        case existing(id: String)

        var existingId: String? {
            if case .existing(let id) = self { return id }
            return nil
        }
    }

    private struct EditorDraft: Equatable {
        var name = ""
        var description = ""
        var instructions = ""
        var enabled = true

        init() {}

        init(_ skill: Skill) {
            name = skill.name
            description = skill.description
            instructions = skill.instructions
            enabled = skill.enabled
        }

        init(_ template: SkillTemplate) {
            name = template.name
            description = template.description
            instructions = template.instructions
            enabled = true
        }
    }

    @State private var editing: Editing = .none
    @State private var draft = EditorDraft()
    @State private var baseline = EditorDraft()
    @State private var attemptedSave = false
    @State private var isSaving = false
    @State private var saveError: String?
    @State private var nameConflict = false
    @State private var confirmingDelete = false
    /// A row picked while the editor has unsaved changes — confirmed first.
    @State private var pendingEditing: Editing?
    /// Why the last Import… / drop didn't open the editor.
    @State private var importError: String?
    @State private var isDropTargeted = false

    var body: some View {
        let skills = appEnvironment.skills

        VStack(spacing: 0) {
            header
            Divider()
            HStack(spacing: 0) {
                sidebar
                    .frame(width: 250)
                Divider()
                detail
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 780, height: 540)
        .task { await skills.load() }
        // A row switch elsewhere (the list's toggle) must not read as an
        // unsaved edit in the form.
        .onChange(of: skills.skills) { _, updated in
            guard let id = editing.existingId, let skill = updated.first(where: { $0.id == id }) else { return }
            if skill.enabled != baseline.enabled {
                let wasDirty = draft.enabled != baseline.enabled
                baseline.enabled = skill.enabled
                if !wasDirty { draft.enabled = skill.enabled }
            }
        }
        .confirmationDialog(
            "Delete “\(baseline.name)”?",
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Delete Skill", role: .destructive) { deleteCurrent() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Ask AI stops seeing this skill immediately. This can't be undone.")
        }
        .confirmationDialog(
            "Discard unsaved changes?",
            isPresented: Binding(get: { pendingEditing != nil }, set: { if !$0 { pendingEditing = nil } }),
            titleVisibility: .visible
        ) {
            Button("Discard Changes", role: .destructive) {
                if let pending = pendingEditing { begin(pending) }
                pendingEditing = nil
            }
            Button("Keep Editing", role: .cancel) { pendingEditing = nil }
        } message: {
            Text("“\(draft.name.isEmpty ? "Untitled skill" : draft.name)” has changes that haven't been saved.")
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Skills")
                    .font(.title3)
                    .fontWeight(.semibold)
                Text("Reusable instructions Ask AI follows when they fit your request.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Done") { dismiss() }
                .keyboardShortcut(.cancelAction)
                .pointingHandCursor()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Sidebar

    private var sidebar: some View {
        let skills = appEnvironment.skills

        return VStack(spacing: 0) {
            if skills.isLoading, !skills.hasLoaded {
                Spacer()
                ProgressView().controlSize(.small)
                Spacer()
            } else if let error = skills.loadError {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("Try Again") { Task { await skills.load() } }
                        .controlSize(.small)
                }
                .padding(16)
                Spacer()
            } else if skills.skills.isEmpty {
                Spacer()
                Text("No skills yet")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Spacer()
            } else {
                List(selection: selectionBinding) {
                    ForEach(skills.skills) { skill in
                        SkillListRow(skill: skill, busy: skills.busyIds.contains(skill.id)) { enabled in
                            Task { await skills.setEnabled(skill, enabled) }
                        }
                        .tag(skill.id)
                    }
                }
                .listStyle(.inset)
                .scrollContentBackground(.hidden)

                if let error = skills.toggleError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 6)
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                if !skills.skills.isEmpty {
                    Text("\(skills.enabledCount) of \(skills.skills.count) enabled")
                        .lineLimit(1)
                }
                Text("Tip: you can also ask Ask AI to create or install a skill for you.")
                if let importError {
                    Text(importError)
                        .foregroundStyle(.red)
                        .textSelection(.enabled)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            HStack(spacing: 8) {
                newMenu
                Button("Import…") { importFromPanel() }
                    .controlSize(.small)
                    .pointingHandCursor()
                    .help("Import a SKILL.md or .txt file — the editor opens prefilled for review")
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
        .background(.quaternary.opacity(0.25))
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(.tint, lineWidth: 2)
                .padding(3)
                .opacity(isDropTargeted ? 1 : 0)
                .allowsHitTesting(false)
        )
        .onDrop(of: [.fileURL], isTargeted: $isDropTargeted) { providers in
            importDropped(providers)
        }
    }

    // MARK: - Import (SKILL.md)

    private func importFromPanel() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = SkillImport.contentTypes
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.message = "Choose a SKILL.md (or .txt) file. The editor opens prefilled so you can review it before saving."
        panel.prompt = "Import"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        importFile(at: url)
    }

    /// Finder drops onto the list. Only the first file is taken — the editor
    /// holds one skill at a time.
    private func importDropped(_ providers: [NSItemProvider]) -> Bool {
        guard providers.contains(where: { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) }) else {
            return false
        }
        DropPayload.load(providers) { urls, _ in
            guard let url = urls.first else { return }
            importFile(at: url)
        }
        return true
    }

    /// Parse client-side and open the editor PREFILLED; nothing is posted
    /// until the user clicks Create (the normal `POST /api/skills`).
    private func importFile(at url: URL) {
        importError = nil
        switch SkillImport.read(url) {
        case .success(let parsed):
            let imported = SkillTemplate(
                name: parsed.name,
                description: parsed.description,
                instructions: parsed.instructions,
                symbolName: "square.and.arrow.down"
            )
            requestEditing(.new(imported))
        case .failure(let error):
            importError = "Couldn't import “\(url.lastPathComponent)”: \(error.localizedDescription)"
        }
    }

    private var newMenu: some View {
        Menu {
            Button {
                requestEditing(.new(nil))
            } label: {
                Label("Blank Skill", systemImage: "doc")
            }
            Divider()
            Section("Start from a template") {
                ForEach(SkillTemplate.starters) { template in
                    Button {
                        requestEditing(.new(template))
                    } label: {
                        Label(template.name, systemImage: template.symbolName)
                    }
                }
            }
        } label: {
            Label("New", systemImage: "plus")
        }
        .controlSize(.small)
        .fixedSize()
        .pointingHandCursor()
        .help("Create a skill")
    }

    private var selectionBinding: Binding<String?> {
        Binding(
            get: { editing.existingId },
            set: { id in
                guard let id, id != editing.existingId else { return }
                requestEditing(.existing(id: id))
            }
        )
    }

    // MARK: - Detail

    @ViewBuilder
    private var detail: some View {
        let skills = appEnvironment.skills
        switch editing {
        case .none:
            if skills.hasLoaded, skills.loadError == nil, skills.skills.isEmpty {
                emptyState
            } else {
                ContentUnavailableView {
                    Label("Select a skill", systemImage: "sparkles.rectangle.stack")
                } description: {
                    Text("Pick a skill on the left to edit it, or create a new one.")
                }
            }
        case .new, .existing:
            editor
        }
    }

    private var emptyState: some View {
        ScrollView {
            VStack(spacing: 0) {
                Image(systemName: "sparkles.rectangle.stack")
                    .font(.system(size: 34, weight: .regular))
                    .foregroundStyle(.tint)
                    .symbolRenderingMode(.hierarchical)
                Text("No skills yet")
                    .font(.title3)
                    .fontWeight(.semibold)
                    .padding(.top, 12)
                Text("A skill is a reusable set of instructions — how you like a weekly digest laid out, how to brief a topic, how to triage links. When a request fits one, Ask AI applies it and tells you which.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 400)
                    .padding(.top, 6)

                VStack(spacing: 8) {
                    ForEach(SkillTemplate.starters) { template in
                        TemplateRow(template: template) { requestEditing(.new(template)) }
                    }
                }
                .frame(maxWidth: 420)
                .padding(.top, 22)

                Button("Start from scratch") { requestEditing(.new(nil)) }
                    .buttonStyle(.link)
                    .pointingHandCursor()
                    .padding(.top, 14)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 28)
            .padding(.vertical, 32)
        }
    }

    private var editor: some View {
        let isNew = editing.existingId == nil
        let nameProblem = SkillValidation.nameProblem(draft.name)
        let descriptionProblem = SkillValidation.descriptionProblem(draft.description)
        let instructionsProblem = SkillValidation.instructionsProblem(draft.instructions)
        let showProblems = attemptedSave

        return VStack(spacing: 0) {
            Form {
                Section {
                    TextField("Name", text: $draft.name, prompt: Text("e.g. Weekly reading digest"))
                        .onChange(of: draft.name) { nameConflict = false }
                    if nameConflict {
                        fieldProblem("A skill with this name already exists.")
                    } else if showProblems, let nameProblem {
                        fieldProblem(nameProblem)
                    }

                    TextField(
                        "Description",
                        text: $draft.description,
                        prompt: Text("one line — this is how Ask AI decides when to use it")
                    )
                    if showProblems, let descriptionProblem {
                        fieldProblem(descriptionProblem)
                    }
                } footer: {
                    Text("Ask AI sees every enabled skill's name and description, and loads the instructions only when one fits.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section {
                    TextEditor(text: $draft.instructions)
                        .font(.body)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 170)
                        .padding(.vertical, 2)
                    if showProblems, let instructionsProblem {
                        fieldProblem(instructionsProblem)
                    }
                } header: {
                    Text("Instructions")
                } footer: {
                    Text("Markdown is fine. Once Ask AI picks this skill, it follows these for the rest of the turn.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)

            Divider()

            HStack(spacing: 10) {
                if !isNew {
                    Button("Delete…", role: .destructive) { confirmingDelete = true }
                        .disabled(isSaving)
                        .pointingHandCursor()
                }
                // Lives in the bar, not the form: the instructions editor takes
                // the form's height, and a switch below the fold is a hidden one.
                Toggle("Enabled", isOn: $draft.enabled)
                    .toggleStyle(.switch)
                    .controlSize(.small)
                    .disabled(isSaving)
                    .help("Disabled skills stay saved but Ask AI won't see them.")
                if let saveError {
                    Text(saveError)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .lineLimit(2)
                }
                Spacer()
                if isSaving {
                    ProgressView().controlSize(.small)
                }
                Button("Cancel") { cancelEditing() }
                    .disabled(isSaving)
                    .pointingHandCursor()
                Button(isNew ? "Create" : "Save") { save() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut("s", modifiers: .command)
                    .disabled(isSaving || (!isNew && draft == baseline))
                    .pointingHandCursor()
            }
            .padding(12)
        }
    }

    private func fieldProblem(_ text: String) -> some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.red)
    }

    // MARK: - Editing flow

    private var isDirty: Bool {
        switch editing {
        case .none: false
        case .new: draft != EditorDraft() && draft != templateDraft
        case .existing: draft != baseline
        }
    }

    /// The untouched template a `.new` started from (so opening a template and
    /// leaving it alone isn't "unsaved changes").
    private var templateDraft: EditorDraft {
        if case .new(let template?) = editing { return EditorDraft(template) }
        return EditorDraft()
    }

    private func requestEditing(_ target: Editing) {
        if isDirty {
            pendingEditing = target
        } else {
            begin(target)
        }
    }

    private func begin(_ target: Editing) {
        editing = target
        attemptedSave = false
        saveError = nil
        nameConflict = false
        switch target {
        case .none:
            draft = EditorDraft()
            baseline = draft
        case .new(let template):
            draft = template.map(EditorDraft.init) ?? EditorDraft()
            baseline = EditorDraft()
        case .existing(let id):
            if let skill = appEnvironment.skills.skills.first(where: { $0.id == id }) {
                draft = EditorDraft(skill)
                baseline = draft
            }
        }
    }

    private func cancelEditing() {
        switch editing {
        case .existing:
            draft = baseline
            attemptedSave = false
            saveError = nil
            nameConflict = false
        case .new, .none:
            begin(.none)
        }
    }

    private func save() {
        attemptedSave = true
        saveError = nil
        nameConflict = false
        guard SkillValidation.isValid(name: draft.name, description: draft.description, instructions: draft.instructions) else {
            return
        }
        let name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let description = draft.description.trimmingCharacters(in: .whitespacesAndNewlines)
        let instructions = draft.instructions
        let enabled = draft.enabled
        let skills = appEnvironment.skills

        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                switch editing {
                case .existing(let id):
                    var partial = SkillDraft()
                    if name != baseline.name { partial.name = name }
                    if description != baseline.description { partial.description = description }
                    if instructions != baseline.instructions { partial.instructions = instructions }
                    if enabled != baseline.enabled { partial.enabled = enabled }
                    let updated = try await skills.update(id: id, partial)
                    draft = EditorDraft(updated)
                    baseline = draft
                case .new:
                    let created = try await skills.create(
                        SkillDraft(name: name, description: description, instructions: instructions, enabled: enabled)
                    )
                    editing = .existing(id: created.id)
                    draft = EditorDraft(created)
                    baseline = draft
                case .none:
                    break
                }
                attemptedSave = false
            } catch {
                if case ApiError.server(status: 409, _) = error {
                    nameConflict = true
                } else {
                    saveError = SkillsModel.describe(error)
                }
            }
        }
    }

    private func deleteCurrent() {
        guard let id = editing.existingId else { return }
        let skills = appEnvironment.skills
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                try await skills.delete(id: id)
                begin(.none)
            } catch {
                saveError = SkillsModel.describe(error)
            }
        }
    }
}

/// One skill in the sidebar list: name, description, and the enabled switch.
private struct SkillListRow: View {
    let skill: Skill
    let busy: Bool
    let onToggle: (Bool) -> Void

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(skill.name)
                    .lineLimit(1)
                    .foregroundStyle(skill.enabled ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                Text(skill.description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Toggle("Enabled", isOn: Binding(get: { skill.enabled }, set: onToggle))
                .toggleStyle(.switch)
                .controlSize(.mini)
                .labelsHidden()
                .disabled(busy)
                .help(skill.enabled ? "Ask AI can use this skill" : "Hidden from Ask AI")
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
        .pointingHandCursor()
    }
}

/// A starter template in the empty state — a card row that opens the editor
/// pre-filled.
private struct TemplateRow: View {
    let template: SkillTemplate
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: template.symbolName)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.tint)
                    .frame(width: 28, height: 28)
                    .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(template.name)
                        .font(.callout)
                        .fontWeight(.medium)
                    Text(template.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .surfaceCard(radius: 10, hovering: isHovering)
        .onHover { isHovering = $0 }
        .pointingHandCursor()
    }
}
