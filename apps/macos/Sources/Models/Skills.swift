import Foundation

/// A user-authored instruction bundle Ask AI follows when it fits the request —
/// mirror of `skillSchema` in `packages/types/src/skills.ts` (agentskills.io
/// shape, v1). Enabled skills are listed in the agent's system prompt by name +
/// description; the agent calls `useSkill` to load the instructions.
struct Skill: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    var description: String
    var instructions: String
    var enabled: Bool
    var createdAt: String
    var updatedAt: String
}

/// `GET /api/skills` → `{skills}` (newest updated first).
struct ListSkillsResponse: Codable, Sendable {
    var skills: [Skill]
}

/// `POST /api/skills` → `201 {skill}`; `GET|PUT /api/skills/:id` → `{skill}`.
struct SkillResponse: Codable, Sendable {
    var skill: Skill
}

/// `POST /api/skills` body (`createSkillSchema`) and, with every field
/// optional, the `PUT /api/skills/:id` body (`updateSkillSchema` = partial).
/// Synthesized Codable omits nil fields, so a toggle PUTs `{enabled}` alone.
struct SkillDraft: Codable, Hashable, Sendable {
    var name: String?
    var description: String?
    var instructions: String?
    var enabled: Bool?

    init(name: String? = nil, description: String? = nil, instructions: String? = nil, enabled: Bool? = nil) {
        self.name = name
        self.description = description
        self.instructions = instructions
        self.enabled = enabled
    }
}

/// Client-side validation, matching `createSkillSchema` so a bad draft is
/// caught before the round trip. Returns the FIRST problem, in field order.
enum SkillValidation {
    static let nameMaxLength = 60
    static let descriptionMaxLength = 200
    static let instructionsMaxLength = 32_000

    private static let nameAllowed: CharacterSet = {
        var set = CharacterSet.alphanumerics
        set.insert(charactersIn: " -_")
        return set
    }()

    static func nameProblem(_ raw: String) -> String? {
        let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return "Give the skill a name." }
        if name.count > nameMaxLength { return "Names are at most \(nameMaxLength) characters." }
        if name.unicodeScalars.contains(where: { !nameAllowed.contains($0) }) {
            return "Use letters, digits, spaces, hyphens, or underscores."
        }
        return nil
    }

    static func descriptionProblem(_ raw: String) -> String? {
        let description = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if description.isEmpty { return "Describe when Ask AI should use it." }
        if description.count > descriptionMaxLength {
            return "Descriptions are at most \(descriptionMaxLength) characters."
        }
        return nil
    }

    static func instructionsProblem(_ raw: String) -> String? {
        if raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Write the instructions." }
        if raw.count > instructionsMaxLength { return "Instructions are at most 32,000 characters." }
        return nil
    }

    /// Whole-draft check for the Save button.
    static func isValid(name: String, description: String, instructions: String) -> Bool {
        nameProblem(name) == nil && descriptionProblem(description) == nil
            && instructionsProblem(instructions) == nil
    }
}

/// The three starter templates offered client-side (never DB rows until the
/// user saves one). Same trio as the web/mobile managers so the products agree.
struct SkillTemplate: Hashable, Identifiable, Sendable {
    let name: String
    let description: String
    let instructions: String
    let symbolName: String
    var id: String { name }

    static let starters: [SkillTemplate] = [
        SkillTemplate(
            name: "Weekly reading digest",
            description: "Summarise what I saved this week into a short, themed digest",
            instructions: """
            Build a digest of everything saved in the last 7 days.

            1. Use queryDatabase to list the bookmarks saved in the last 7 days (title, url, category, tags, saved day).
            2. Group them into 3–6 themes. Name each theme in a few words.
            3. Under each theme, list the items as `[title](url)` with a one-line note on why it matters.
            4. Finish with "Worth revisiting": the two or three items most worth a second look, and why.

            Keep it skimmable — short lines, no filler. If fewer than three items were saved, say so and summarise what is there.
            """,
            symbolName: "calendar"
        ),
        SkillTemplate(
            name: "Research brief",
            description: "Turn my bookmarks (and the web, if needed) on a topic into a structured brief",
            instructions: """
            Produce a research brief on the topic the user names.

            1. Search the library first (searchBookmarks, hybrid) and read the most relevant pages with fetchUrl.
            2. Only if the library is thin, add up to three external sources with webSearch. Mark external sources clearly.
            3. Structure the brief as: Summary (3 sentences) · Key points (bullets, each citing a source as `[title](url)`) · Open questions · Sources.
            4. Distinguish facts from opinions, and flag anything the sources disagree on.

            Prefer the user's own saved material over the open web. Never invent a source.
            """,
            symbolName: "doc.text.magnifyingglass"
        ),
        SkillTemplate(
            name: "Link triage",
            description: "Sort a batch of recent bookmarks into keep / read later / archive",
            instructions: """
            Triage the user's most recent bookmarks (default: the last 20, or the range they ask for).

            1. Fetch them with queryDatabase (title, url, description, category, tags, saved day).
            2. Sort every item into exactly one of: Keep (reference material worth having), Read later (substantive, unread), Archive (stale, duplicate, or low value).
            3. Present three short lists as `[title](url)` with a five-word reason each.
            4. Call out duplicates and near-duplicates explicitly.

            Be decisive — every link lands in one bucket. Do not delete anything; only recommend.
            """,
            symbolName: "tray.2"
        ),
    ]
}
