import Foundation
import Observation

/// The user's skills (`/api/skills`): list, create, edit, delete, and the
/// enabled toggle. Held once in `AppEnvironment` so the ⋯ ▸ Skills… sheet and
/// anything else that lists skills share one copy.
@MainActor
@Observable
final class SkillsModel {

    private(set) var skills: [Skill] = []
    private(set) var isLoading = false
    private(set) var hasLoaded = false
    /// Set when the list itself couldn't be fetched (the sheet shows it in
    /// place of the list). Per-action errors are thrown to the caller instead.
    private(set) var loadError: String?
    /// Skills with a save in flight — rows dim their toggle while it runs.
    private(set) var busyIds: Set<String> = []
    /// One line under the list when a toggle fails (the row snaps back).
    private(set) var toggleError: String?

    private let api: ApiClient

    init(api: ApiClient) {
        self.api = api
    }

    var enabledCount: Int { skills.filter(\.enabled).count }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            skills = try await api.listSkills().skills
            loadError = nil
        } catch {
            loadError = Self.describe(error)
        }
        hasLoaded = true
    }

    /// `POST /api/skills`. Throws so the editor can show a 409 next to the name.
    func create(_ draft: SkillDraft) async throws -> Skill {
        let skill = try await api.createSkill(draft)
        skills.removeAll { $0.id == skill.id }
        skills.insert(skill, at: 0)
        return skill
    }

    /// `PUT /api/skills/:id` with the changed fields.
    func update(id: String, _ draft: SkillDraft) async throws -> Skill {
        busyIds.insert(id)
        defer { busyIds.remove(id) }
        let skill = try await api.updateSkill(id: id, draft)
        replace(skill)
        return skill
    }

    /// `DELETE /api/skills/:id`.
    func delete(id: String) async throws {
        busyIds.insert(id)
        defer { busyIds.remove(id) }
        try await api.deleteSkill(id: id)
        skills.removeAll { $0.id == id }
    }

    /// The list-row switch: optimistic, reverted (with a message) on failure.
    func setEnabled(_ skill: Skill, _ enabled: Bool) async {
        guard let index = skills.firstIndex(where: { $0.id == skill.id }) else { return }
        let previous = skills[index]
        skills[index].enabled = enabled
        toggleError = nil
        do {
            _ = try await update(id: skill.id, SkillDraft(enabled: enabled))
        } catch {
            if let current = skills.firstIndex(where: { $0.id == skill.id }) {
                skills[current] = previous
            }
            toggleError = Self.describe(error)
        }
    }

    func clearToggleError() {
        toggleError = nil
    }

    #if DEBUG
    /// Previews/tests: stand in for a loaded list without a server.
    func seed(_ skills: [Skill]) {
        self.skills = skills
        hasLoaded = true
        loadError = nil
    }
    #endif

    func reset() {
        skills = []
        hasLoaded = false
        loadError = nil
        busyIds = []
        toggleError = nil
    }

    private func replace(_ skill: Skill) {
        if let index = skills.firstIndex(where: { $0.id == skill.id }) {
            skills[index] = skill
        } else {
            skills.insert(skill, at: 0)
        }
        // Newest updated first, like the server's list order.
        skills.sort { $0.updatedAt > $1.updatedAt }
    }

    /// A 404 on the list means the server predates skills — say so plainly
    /// rather than showing a raw "Request failed (404)".
    static func describe(_ error: Error) -> String {
        if case ApiError.server(status: 404, _) = error {
            return "This server doesn't offer skills yet. Update it and try again."
        }
        return (error as? ApiError)?.errorDescription ?? error.localizedDescription
    }
}
