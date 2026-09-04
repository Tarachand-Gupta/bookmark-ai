import XCTest
@testable import BookmarkAI

/// SKILL.md import (contract §3b): frontmatter first, heading/paragraph
/// fallback, the error vocabulary, serialize→parse round trip, the import
/// type gate, and the chat-tool copy for createSkill / installSkill.
final class SkillMarkdownTests: XCTestCase {

    func testFrontmatterWins() throws {
        let text = """
        ---
        name: "Weekly reading digest"
        description: Summarise what I saved this week
        version: 1
        # a comment
        ---

        # Weekly reading digest

        Build a digest of everything saved in the last 7 days.

        1. Group by theme.
        """
        let parsed = try SkillMarkdown.parse(text).get()
        XCTAssertEqual(parsed.name, "Weekly reading digest")
        XCTAssertEqual(parsed.description, "Summarise what I saved this week")
        // With both fields supplied, the WHOLE body is the instructions.
        XCTAssertTrue(parsed.instructions.hasPrefix("# Weekly reading digest"))
        XCTAssertTrue(parsed.instructions.hasSuffix("1. Group by theme."))
    }

    func testCRLFAndBOMAreTolerated() throws {
        let text = "\u{FEFF}---\r\nname: Link triage\r\ndescription: 'Sort links'\r\n---\r\nDo the thing.\r\n"
        let parsed = try SkillMarkdown.parse(text).get()
        XCTAssertEqual(parsed.name, "Link triage")
        XCTAssertEqual(parsed.description, "Sort links")
        XCTAssertEqual(parsed.instructions, "Do the thing.")
    }

    func testHeadingAndFirstParagraphFallBackWithoutFrontmatter() throws {
        let text = """

        # Research brief

        Turn my bookmarks on a topic
        into a structured brief.

        1. Search the library first.
        2. Add up to three external sources.
        """
        let parsed = try SkillMarkdown.parse(text).get()
        XCTAssertEqual(parsed.name, "Research brief")
        XCTAssertEqual(parsed.description, "Turn my bookmarks on a topic into a structured brief.")
        XCTAssertEqual(parsed.instructions, "1. Search the library first.\n2. Add up to three external sources.")
    }

    func testFrontmatterWithoutDescriptionUsesTheFirstParagraph() throws {
        let text = """
        ---
        name: Link triage
        ---
        Sort a batch of recent bookmarks into keep / read later / archive.

        Fetch the last 20 with queryDatabase and bucket every one.
        """
        let parsed = try SkillMarkdown.parse(text).get()
        XCTAssertEqual(parsed.name, "Link triage")
        XCTAssertEqual(parsed.description, "Sort a batch of recent bookmarks into keep / read later / archive.")
        XCTAssertEqual(parsed.instructions, "Fetch the last 20 with queryDatabase and bucket every one.")
    }

    func testMissingPiecesAreNamedErrors() {
        XCTAssertEqual(SkillMarkdown.parse("   \n\n").failure, .empty)
        XCTAssertEqual(SkillMarkdown.parse("Just a paragraph with no heading.\n\nMore.").failure, .missingName)
        XCTAssertEqual(SkillMarkdown.parse("---\nname: X\n---\n").failure, .missingDescription)
        XCTAssertEqual(SkillMarkdown.parse("# Only a title\n\nOne paragraph, nothing else.").failure, .missingInstructions)
        // An unclosed fence is not frontmatter — the body rules apply.
        XCTAssertEqual(SkillMarkdown.parse("---\nname: X\nno closing fence").failure, .missingName)
        XCTAssertEqual(SkillMarkdown.ParseError.missingName.errorDescription?.isEmpty, false)
    }

    func testSerializeRoundTrips() throws {
        let markdown = SkillMarkdown.serialize(
            name: "Digest: weekly",
            description: "Summarise \"what\" I saved",
            instructions: "Build a digest.\n\n1. Group by theme."
        )
        XCTAssertTrue(
            markdown.hasPrefix("---\nname: \"Digest: weekly\"\ndescription: \"Summarise \\\"what\\\" I saved\"\n---\n"),
            markdown
        )
        let parsed = try SkillMarkdown.parse(markdown).get()
        XCTAssertEqual(parsed.name, "Digest: weekly")
        XCTAssertEqual(parsed.description, "Summarise \"what\" I saved")
        XCTAssertEqual(parsed.instructions, "Build a digest.\n\n1. Group by theme.")
    }

    func testImportRejectsOtherFileTypes() {
        guard case .failure(let error) = SkillImport.read(URL(fileURLWithPath: "/tmp/skill.pdf")) else {
            return XCTFail("expected a rejection")
        }
        XCTAssertEqual(error as? SkillImport.ReadError, .unsupportedType("pdf"))
        XCTAssertTrue(SkillImport.contentTypes.contains(.plainText))
    }

    func testSkillToolCopyFollowsTheContract() {
        func call(_ name: String, _ state: ChatToolCall.State, input: JSONValue? = nil, output: JSONValue? = nil) -> ChatToolCall {
            ChatToolCall(name: name, callId: "c", state: state, input: input, output: output, errorText: nil)
        }
        XCTAssertEqual(
            ChatToolCopy.label(for: call("createSkill", .inputAvailable, input: .object(["name": .string("Link triage")]))),
            "Creating skill “Link triage”"
        )
        let created = call(
            "createSkill", .outputAvailable,
            input: .object(["name": .string("Link triage")]),
            output: .object(["skill": .object([
                "id": .string("s1"), "name": .string("Link triage"), "description": .string("Sort links"),
            ])])
        )
        XCTAssertEqual(ChatToolCopy.label(for: created), "Created skill “Link triage”")
        XCTAssertEqual(created.skillSummary, ChatSkillSummary(name: "Link triage", description: "Sort links"))
        XCTAssertEqual(
            ChatToolCopy.label(for: call("installSkill", .inputAvailable, input: .object(["url": .string("https://example.com/skills/SKILL.md")]))),
            "Installing skill from example.com"
        )
        XCTAssertEqual(
            ChatToolCopy.label(for: call("installSkill", .outputAvailable, output: .object(["skill": .object(["name": .string("Research brief")])]))),
            "Installed skill “Research brief”"
        )
        // Conflicts come back as `{error}` — the red state, no summary.
        let conflict = call(
            "createSkill", .outputAvailable,
            input: .object(["name": .string("Link triage")]),
            output: .object(["error": .string("A skill named “Link triage” already exists — pick a different name.")])
        )
        XCTAssertTrue(conflict.isFailure)
        XCTAssertEqual(ChatToolCopy.label(for: conflict), "Skill creation failed")
        XCTAssertNil(conflict.skillSummary)
        XCTAssertEqual(ChatToolCopy.label(for: call("installSkill", .outputError)), "Skill install failed")
    }
}

private extension Result {
    var failure: Failure? {
        if case .failure(let error) = self { return error }
        return nil
    }
}
