import XCTest
@testable import BookmarkAI

/// The 2026-09 chat/settings contract: reasoning + tool-state stream chunks,
/// `file` parts, the `{message, conversationId}` request body, the chat
/// route's error vocabulary, `aiMode`, plans, MCP tokens, and skills.
final class Phase3DecodingTests: XCTestCase {

    // MARK: - Stream chunks (AI SDK v7 UI-message stream)

    func testReasoningChunksParse() {
        XCTAssertEqual(
            ChatStreamChunk.parse(line: #"data: {"type":"reasoning-start","id":"r1","providerMetadata":{"google":{"thoughtSignature":"x"}}}"#),
            .reasoningStart(id: "r1")
        )
        XCTAssertEqual(
            ChatStreamChunk.parse(line: #"data: {"type":"reasoning-delta","id":"r1","delta":"Let me check the library."}"#),
            .reasoningDelta(id: "r1", delta: "Let me check the library.")
        )
        XCTAssertEqual(
            ChatStreamChunk.parse(line: #"data: {"type":"reasoning-end","id":"r1"}"#),
            .reasoningEnd(id: "r1")
        )
    }

    func testToolInputDeltaAndOutputErrorParse() {
        XCTAssertEqual(
            ChatStreamChunk.parse(line: #"data: {"type":"tool-input-delta","toolCallId":"c1","inputTextDelta":"{\"query\":\"des"}"#),
            .toolInputDelta(toolCallId: "c1", inputTextDelta: #"{"query":"des"#)
        )
        XCTAssertEqual(
            ChatStreamChunk.parse(line: #"data: {"type":"tool-output-error","toolCallId":"c1","errorText":"fetch failed: 403"}"#),
            .toolOutputError(toolCallId: "c1", errorText: "fetch failed: 403")
        )
        // A missing call id can't be attributed to a row — absorbed, never fatal.
        XCTAssertEqual(
            ChatStreamChunk.parse(line: #"data: {"type":"tool-output-error","errorText":"x"}"#),
            .other(type: "tool-output-error")
        )
    }

    func testFileChunkParses() {
        XCTAssertEqual(
            ChatStreamChunk.parse(line: #"data: {"type":"file","url":"data:image/png;base64,iVBORw0KGgo=","mediaType":"image/png"}"#),
            .file(url: "data:image/png;base64,iVBORw0KGgo=", mediaType: "image/png")
        )
    }

    // MARK: - Request protocol (§5)

    func testFirstTurnSendsMessagesArrayAndLaterTurnsSendOnlyTheNewMessage() throws {
        let user = ChatMessage.user(text: "hi")

        let first = ChatTurnBody.make(message: user, conversationId: nil, timezone: "Asia/Kolkata")
        let firstJSON = try JSONSerialization.jsonObject(with: JSONEncoder().encode(first)) as? [String: Any]
        XCTAssertNotNil(firstJSON?["messages"])
        XCTAssertNil(firstJSON?["message"])
        XCTAssertNil(firstJSON?["conversationId"])
        XCTAssertEqual(firstJSON?["timezone"] as? String, "Asia/Kolkata")

        let later = ChatTurnBody.make(message: user, conversationId: "conv-1", timezone: "UTC")
        let laterJSON = try JSONSerialization.jsonObject(with: JSONEncoder().encode(later)) as? [String: Any]
        XCTAssertNil(laterJSON?["messages"], "history lives on the server — never re-send the transcript")
        XCTAssertNotNil(laterJSON?["message"])
        XCTAssertEqual(laterJSON?["conversationId"] as? String, "conv-1")
    }

    func testUserMessagePutsFilePartsBeforeText() {
        let file = ChatMessage.filePart(mediaType: "image/png", filename: "a.png", dataURL: "data:image/png;base64,AA==")
        let message = ChatMessage.user(text: "what is this?", files: [file])
        XCTAssertEqual(message.parts.count, 2)
        XCTAssertEqual(message.parts[0]["type"]?.stringValue, "file")
        XCTAssertEqual(message.parts[0]["filename"]?.stringValue, "a.png")
        XCTAssertEqual(message.parts[1]["type"]?.stringValue, "text")
        XCTAssertEqual(message.fileParts.count, 1)
        XCTAssertEqual(message.plainText, "what is this?")

        // Attachments-only: no empty text part is invented.
        let filesOnly = ChatMessage.user(text: "", files: [file])
        XCTAssertEqual(filesOnly.parts.count, 1)
        // Text-only keeps the single text part it always had.
        XCTAssertEqual(ChatMessage.user(text: "x").parts.count, 1)
    }

    // MARK: - Stored parts → projection (reasoning, file, tool states)

    func testStoredReasoningAndFilePartsProject() throws {
        let json = """
        {"conversation":{"id":"c1","title":"t","createdAt":"2026-09-03T00:00:00.000Z","updatedAt":"2026-09-03T00:00:00.000Z"},
         "messages":[
          {"id":"u1","role":"user","parts":[
            {"type":"file","mediaType":"image/png","filename":"shot.png","url":"data:image/png;base64,iVBORw0KGgo="},
            {"type":"text","text":"What's in this?"}]},
          {"id":"a1","role":"assistant","parts":[
            {"type":"step-start"},
            {"type":"reasoning","text":"The user attached a screenshot.","state":"done","providerMetadata":{"google":{"thoughtSignature":"sig"}}},
            {"type":"tool-useSkill","toolCallId":"t1","state":"output-available","input":{"name":"Link triage"},"output":{"name":"Link triage","instructions":"Sort…"}},
            {"type":"tool-fetchUrl","toolCallId":"t2","state":"output-error","input":{"url":"https://example.com/x"},"errorText":"fetch failed: 403"},
            {"type":"text","text":"A screenshot."}]}]}
        """.data(using: .utf8)!

        let detail = try ApiClient.decoder.decode(ChatConversationDetailResponse.self, from: json)
        let user = detail.messages[0]
        XCTAssertEqual(user.fileParts.count, 1)
        XCTAssertEqual(user.fileParts[0].displayName, "shot.png")
        XCTAssertTrue(user.fileParts[0].isImage)
        XCTAssertEqual(user.fileParts[0].data, Data(base64Encoded: "iVBORw0KGgo="))

        let assistant = detail.messages[1]
        let views = assistant.partViews
        XCTAssertEqual(views.count, 4)
        XCTAssertEqual(views[0], .reasoning(text: "The user attached a screenshot.", streaming: false))
        guard case .tool(let skill) = views[1], case .tool(let fetch) = views[2] else {
            return XCTFail("expected two tool rows")
        }
        XCTAssertEqual(ChatToolCopy.label(for: skill), "Using skill “Link triage”")
        XCTAssertEqual(fetch.state, .outputError)
        XCTAssertTrue(fetch.isError)
        XCTAssertEqual(fetch.errorText, "fetch failed: 403")
        XCTAssertEqual(ChatToolCopy.label(for: fetch), "Page read failed")
        XCTAssertEqual(views[3], .text("A screenshot."))
        XCTAssertTrue(assistant.hasVisibleContent)

        // Lossless: provider metadata on the reasoning part survives a round trip.
        let reencoded = try JSONEncoder().encode(assistant)
        let decoded = try JSONDecoder().decode(ChatMessage.self, from: reencoded)
        XCTAssertEqual(decoded, assistant)
    }

    /// The server never emits `tool-output-error`: every tool failure arrives as
    /// `tool-output-available` whose output object carries a string `error`.
    /// That must render exactly like the error state, `useSkill` included.
    func testSoftToolErrorsRenderLikeTheErrorState() throws {
        let chunk = ChatStreamChunk.parse(
            line: #"data: {"type":"tool-output-available","toolCallId":"c1","output":{"error":"blocked address 10.255.255.1"}}"#
        )
        guard case .toolOutputAvailable(let callId, let output) = chunk else {
            return XCTFail("expected tool-output-available, got \(String(describing: chunk))")
        }
        XCTAssertEqual(callId, "c1")
        XCTAssertEqual(output?["error"]?.stringValue, "blocked address 10.255.255.1")

        let json = """
        {"conversation":{"id":"c1","title":"t","createdAt":"2026-09-03T00:00:00.000Z","updatedAt":"2026-09-03T00:00:00.000Z"},
         "messages":[
          {"id":"a1","role":"assistant","parts":[
            {"type":"tool-fetchUrl","toolCallId":"c1","state":"output-available","input":{"url":"http://10.255.255.1/"},"output":{"error":"blocked address 10.255.255.1"}},
            {"type":"tool-useSkill","toolCallId":"c2","state":"output-available","input":{"name":"x"},"output":{"error":"Skill \\"x\\" is disabled"}},
            {"type":"tool-searchBookmarks","toolCallId":"c3","state":"output-available","input":{"query":"design"},"output":{"results":[]}},
            {"type":"text","text":"I couldn't reach that address."}]}]}
        """.data(using: .utf8)!
        let detail = try ApiClient.decoder.decode(ChatConversationDetailResponse.self, from: json)
        let views = detail.messages[0].partViews
        guard case .tool(let fetch) = views[0], case .tool(let skill) = views[1], case .tool(let search) = views[2] else {
            return XCTFail("expected three tool rows")
        }

        // Soft failure: the call itself completed, but it reads as an error.
        XCTAssertEqual(fetch.state, .outputAvailable)
        XCTAssertFalse(fetch.isError)
        XCTAssertTrue(fetch.isFailure)
        XCTAssertEqual(fetch.failureText, "blocked address 10.255.255.1")
        XCTAssertEqual(ChatToolCopy.label(for: fetch), "Page read failed")

        XCTAssertTrue(skill.isFailure)
        XCTAssertEqual(skill.failureText, #"Skill "x" is disabled"#)
        XCTAssertEqual(ChatToolCopy.label(for: skill), "Skill failed")

        // An output without `error` is the success state.
        XCTAssertFalse(search.isFailure)
        XCTAssertNil(search.failureText)
        XCTAssertEqual(ChatToolCopy.label(for: search), "Found 0 bookmarks")

        // The hard `output-error` chunk keeps the same surface.
        let hard = ChatToolCall(name: "fetchUrl", callId: "c4", state: .outputError, input: nil, output: nil, errorText: "fetch failed: 403")
        XCTAssertTrue(hard.isFailure)
        XCTAssertEqual(hard.failureText, "fetch failed: 403")
        XCTAssertEqual(ChatToolCopy.label(for: hard), "Page read failed")
    }

    func testStreamingReasoningCountsAsVisibleAndEmptyTextDoesNot() {
        let empty = ChatMessage(id: "a", role: "assistant", parts: [
            .object(["type": .string("text"), "text": .string("")]),
        ])
        XCTAssertFalse(empty.hasVisibleContent, "an empty text-start keeps the Thinking placeholder")
        let thinking = ChatMessage(id: "b", role: "assistant", parts: [
            .object(["type": .string("reasoning"), "text": .string("Hmm"), "state": .string("streaming")]),
        ])
        XCTAssertEqual(thinking.partViews, [.reasoning(text: "Hmm", streaming: true)])
        XCTAssertTrue(thinking.hasVisibleContent)
    }

    // MARK: - Tool copy (§6)

    func testToolCopyFollowsTheContract() {
        func call(_ name: String, _ state: ChatToolCall.State, input: JSONValue? = nil, output: JSONValue? = nil) -> ChatToolCall {
            ChatToolCall(name: name, callId: "c", state: state, input: input, output: output, errorText: nil)
        }
        XCTAssertEqual(
            ChatToolCopy.label(for: call("searchBookmarks", .inputAvailable, input: .object(["query": .string("design")]))),
            "Searching bookmarks for “design”"
        )
        XCTAssertEqual(
            ChatToolCopy.label(for: call("searchBookmarks", .outputAvailable, output: .object(["results": .array([.null, .null, .null])]))),
            "Found 3 bookmarks"
        )
        XCTAssertEqual(ChatToolCopy.label(for: call("queryDatabase", .inputStreaming)), "Querying your library")
        XCTAssertEqual(
            ChatToolCopy.label(for: call("queryDatabase", .outputAvailable, output: .object(["rowCount": .int(12)]))),
            "12 rows"
        )
        XCTAssertEqual(ChatToolCopy.label(for: call("listSessions", .inputAvailable)), "Listing saved sessions")
        XCTAssertEqual(
            ChatToolCopy.label(for: call("listSessions", .outputAvailable, output: .object(["total": .int(2), "sessions": .array([.null, .null])]))),
            "2 sessions"
        )
        XCTAssertEqual(ChatToolCopy.label(for: call("listLiveTabs", .inputAvailable)), "Checking live tabs")
        XCTAssertEqual(
            ChatToolCopy.label(for: call("listLiveTabs", .outputAvailable, output: .object(["enabled": .bool(false), "devices": .array([])]))),
            "Live sharing is off"
        )
        XCTAssertEqual(
            ChatToolCopy.label(for: call("listLiveTabs", .outputAvailable, output: .object([
                "enabled": .bool(true),
                "devices": .array([.object(["tabCount": .int(5)]), .object(["tabCount": .int(2)])]),
            ]))),
            "7 tabs on 2 devices"
        )
        XCTAssertEqual(
            ChatToolCopy.label(for: call("webSearch", .inputAvailable, input: .object(["query": .string("swift 6")]))),
            "Searching the web for “swift 6”"
        )
        XCTAssertEqual(
            ChatToolCopy.label(for: call("webSearch", .outputAvailable, output: .object(["sources": .array([.null, .null, .null, .null])]))),
            "4 sources"
        )
        XCTAssertEqual(
            ChatToolCopy.label(for: call("fetchUrl", .inputAvailable, input: .object(["url": .string("https://developer.apple.com/docs")]))),
            "Reading developer.apple.com"
        )
        XCTAssertEqual(
            ChatToolCopy.label(for: call("fetchUrl", .outputAvailable, output: .object(["title": .string("SwiftUI")]))),
            "Read SwiftUI"
        )
        XCTAssertEqual(
            ChatToolCopy.label(for: call("useSkill", .inputAvailable, input: .object(["name": .string("Research brief")]))),
            "Loading skill “Research brief”"
        )
        // A tool that answered `{error}` is a soft failure — red label, no crash.
        let soft = call("useSkill", .outputAvailable, input: .object(["name": .string("nope")]), output: .object(["error": .string("No skill named nope")]))
        XCTAssertEqual(soft.softError, "No skill named nope")
        XCTAssertEqual(ChatToolCopy.label(for: soft), "Skill failed")
        // Unknown tools still read sensibly.
        XCTAssertEqual(ChatToolCopy.label(for: call("frobnicate", .inputAvailable)), "Running frobnicate")
    }

    // MARK: - Chat route errors

    func testChatErrorMapping() {
        let fallback = ApiError.server(status: 500, message: "x")
        XCTAssertEqual(
            ApiClient.chatError(status: 415, body: ErrorBody(error: "attachment-type-not-allowed", code: nil), fallback: fallback),
            .server(status: 415, message: ChatAttachmentRules.rejectionCopy)
        )
        XCTAssertEqual(
            ApiClient.chatError(status: 413, body: ErrorBody(error: "attachments-too-large", code: nil), fallback: fallback),
            .server(status: 413, message: ChatAttachmentRules.totalTooLargeCopy)
        )
        XCTAssertEqual(
            ApiClient.chatError(status: 400, body: ErrorBody(error: "too-many-attachments", code: nil), fallback: fallback),
            .server(status: 400, message: ChatAttachmentRules.tooManyFilesCopy)
        )
        guard case .server(400, let urlMessage) = ApiClient.chatError(status: 400, body: ErrorBody(error: "attachment-url-not-allowed", code: nil), fallback: fallback) else {
            return XCTFail("attachment-url-not-allowed should map to a readable sentence")
        }
        XCTAssertTrue(urlMessage.contains("embedded files"))
        guard case .server(402, let message) = ApiClient.chatError(status: 402, body: ErrorBody(error: "free-limit-exceeded", code: nil), fallback: fallback) else {
            return XCTFail("402 should map to the allowance message")
        }
        XCTAssertTrue(message.contains("Settings → AI"))
        XCTAssertEqual(ApiClient.chatError(status: 500, body: nil, fallback: fallback), fallback)
    }

    func testReplyNotesComeFromTheHeaders() {
        func handle(source: String?, note: String?) -> ChatStreamHandle {
            ChatStreamHandle(
                conversationId: "c", aiSource: source, aiNote: note,
                chunks: AsyncThrowingStream { $0.finish() }
            )
        }
        XCTAssertEqual(handle(source: "included", note: nil).replyNotes, [])
        XCTAssertEqual(handle(source: "own", note: nil).replyNotes, [])
        XCTAssertEqual(handle(source: "own-fallback", note: nil).replyNotes, [.ownKeyFallback])
        XCTAssertEqual(handle(source: "own", note: "own-key-incomplete").replyNotes, [.ownKeyIncomplete])
        XCTAssertEqual(handle(source: "own-fallback", note: "own-key-incomplete").replyNotes, [.ownKeyFallback, .ownKeyIncomplete])
        XCTAssertEqual(
            ChatReplyNote.ownKeyFallback.text,
            "Free credits are used up this week — running on your own key. Resets Monday."
        )
        XCTAssertEqual(
            ChatReplyNote.ownKeyIncomplete.text,
            "Your key needs a model — pick one in Settings → AI. This reply ran on the included free AI."
        )
    }

    // MARK: - Settings: aiMode (§1)

    func testAiModeDecodesAndDerivesWhenAbsent() throws {
        let withMode = """
        {"settings":{"provider":"google","baseUrl":null,"model":null,"apiKeySet":true,"apiKeyLast4":"1234","aiMode":"included",
          "liveServerUrl":null,"onboardedAt":null,"nativeSyncEnabled":true,"nativeSyncFull":false,"mcpTools":null,"aiUsage":null}}
        """.data(using: .utf8)!
        let explicit = try ApiClient.decoder.decode(SettingsResponse.self, from: withMode).settings
        XCTAssertEqual(explicit.resolvedAiMode, .included, "a stored key no longer implies own-key mode")
        XCTAssertTrue(explicit.isOwnKeyReady, "absent ownKeyReady means ready")

        let incomplete = """
        {"settings":{"provider":"openai","baseUrl":null,"model":null,"apiKeySet":true,"apiKeyLast4":"1234","aiMode":"own",
          "ownKeyReady":false,"liveServerUrl":null,"nativeSyncEnabled":true,"nativeSyncFull":false,"mcpTools":null,"aiUsage":null}}
        """.data(using: .utf8)!
        XCTAssertFalse(try ApiClient.decoder.decode(SettingsResponse.self, from: incomplete).settings.isOwnKeyReady)

        let legacy = """
        {"settings":{"provider":"openai","baseUrl":null,"model":"gpt-4o","apiKeySet":true,"apiKeyLast4":"abcd",
          "liveServerUrl":null,"nativeSyncEnabled":true,"nativeSyncFull":false,"mcpTools":null,"aiUsage":null}}
        """.data(using: .utf8)!
        let derived = try ApiClient.decoder.decode(SettingsResponse.self, from: legacy).settings
        XCTAssertEqual(derived.resolvedAiMode, .own, "older servers: key stored ⇒ own")

        let noKey = """
        {"settings":{"provider":"google","baseUrl":null,"model":null,"apiKeySet":false,"apiKeyLast4":null,
          "liveServerUrl":null,"nativeSyncEnabled":true,"nativeSyncFull":false,"mcpTools":null,"aiUsage":null}}
        """.data(using: .utf8)!
        XCTAssertEqual(try ApiClient.decoder.decode(SettingsResponse.self, from: noKey).settings.resolvedAiMode, .included)
    }

    func testModeSwitchBodyCarriesOnlyAiMode() throws {
        let data = try JSONEncoder().encode(UpdateSettingsBody(aiMode: .own))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(json.keys.sorted(), ["aiMode"])
        XCTAssertEqual(json["aiMode"] as? String, "own")

        // Remove key is the ONLY body that carries apiKey: "".
        let remove = try JSONSerialization.jsonObject(with: JSONEncoder().encode(UpdateSettingsBody(apiKey: ""))) as? [String: Any]
        XCTAssertEqual(remove?.keys.sorted(), ["apiKey"])
        XCTAssertEqual(remove?["apiKey"] as? String, "")
    }

    // MARK: - Plan (§2)

    func testAccountPlanDecodesAndDefaultsToFree() throws {
        // Captured from GET /api/account on the dev server.
        let json = #"{"plan":"free"}"#.data(using: .utf8)!
        let account = try ApiClient.decoder.decode(AccountResponse.self, from: json)
        XCTAssertEqual(account.plan, "free")
        XCTAssertEqual(PlanInfo.resolve(account.plan), .free)

        // An older server (no plans yet) still decodes and lands on Free.
        XCTAssertNil(try ApiClient.decoder.decode(AccountResponse.self, from: Data("{}".utf8)).plan)
        XCTAssertEqual(PlanInfo.resolve(nil).badgeTitle, "Free plan")
        XCTAssertEqual(PlanInfo.free.features.map(\.key), ["bookmarks", "live-sessions", "ai-credits", "byok"])
        XCTAssertEqual(PlanInfo.free.price, 0)
    }

    // MARK: - MCP tokens

    func testMcpTokenListDecodesRealShape() throws {
        // Captured from GET /api/mcp/tokens on the dev server.
        let json = """
        {"tokens":[{"id":"2738156971bc6e5706d3a6e03bf73c6c","name":"paging-verify","createdAt":"2026-08-11T14:50:11.000Z",
          "lastUsedAt":"2026-08-11T14:50:25.766Z","revokedAt":"2026-08-11T14:58:18.521Z","hint":"bkmcp_eyJhb…bIbf0"},
         {"id":"old","name":"pre-v11","createdAt":"2026-07-01T00:00:00.000Z","lastUsedAt":null,"revokedAt":null,"hint":null}]}
        """.data(using: .utf8)!
        let response = try ApiClient.decoder.decode(ListMcpTokensResponse.self, from: json)
        XCTAssertEqual(response.tokens.count, 2)
        XCTAssertTrue(response.tokens[0].isRevoked)
        XCTAssertEqual(response.tokens[0].hint, "bkmcp_eyJhb…bIbf0")
        XCTAssertFalse(response.tokens[1].isRevoked)
        XCTAssertNil(response.tokens[1].hint)
        XCTAssertNil(response.tokens[1].lastUsedAt)
    }

    func testMcpCreateResponseAndSnippets() throws {
        let json = #"{"token":"bkmcp_abc.def","id":"t1","name":"laptop","createdAt":"2026-09-03T10:00:00.000Z"}"#.data(using: .utf8)!
        let created = try ApiClient.decoder.decode(CreateMcpTokenResponse.self, from: json)
        XCTAssertEqual(created.token, "bkmcp_abc.def")

        let endpoint = McpSnippets.endpoint(base: URL(string: "https://www.bookmark-ai.cloud")!)
        XCTAssertEqual(endpoint, "https://www.bookmark-ai.cloud/api/mcp")
        XCTAssertEqual(McpSnippets.endpoint(base: URL(string: "http://localhost:3000/")!), "http://localhost:3000/api/mcp")

        let command = McpSnippets.claudeCodeCommand(endpoint: endpoint, token: created.token)
        XCTAssertEqual(
            command,
            #"claude mcp add --transport http bookmark-ai https://www.bookmark-ai.cloud/api/mcp --header "Authorization: Bearer bkmcp_abc.def""#
        )
        XCTAssertTrue(McpSnippets.claudeCodeCommand(endpoint: endpoint, token: nil).contains("Bearer <YOUR_TOKEN>"))

        // The JSON config must be valid JSON with the expected shape.
        let config = McpSnippets.jsonConfig(endpoint: endpoint, token: nil)
        let parsed = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(config.utf8)) as? [String: Any])
        let servers = try XCTUnwrap(parsed["mcpServers"] as? [String: Any])
        let server = try XCTUnwrap(servers["bookmark-ai"] as? [String: Any])
        XCTAssertEqual(server["type"] as? String, "http")
        XCTAssertEqual(server["url"] as? String, endpoint)
        XCTAssertEqual((server["headers"] as? [String: String])?["Authorization"], "Bearer <YOUR_TOKEN>")
    }

    // MARK: - Skills (§3)

    func testSkillsDecodeAndDraftEncodesOnlyChangedFields() throws {
        let json = """
        {"skills":[{"id":"s1","name":"Weekly reading digest","description":"Summarise the week","instructions":"Do it.",
          "enabled":true,"createdAt":"2026-09-03T09:00:00.000Z","updatedAt":"2026-09-03T09:30:00.000Z"}]}
        """.data(using: .utf8)!
        let list = try ApiClient.decoder.decode(ListSkillsResponse.self, from: json)
        XCTAssertEqual(list.skills.first?.name, "Weekly reading digest")
        XCTAssertEqual(list.skills.first?.enabled, true)

        let toggle = try JSONSerialization.jsonObject(with: JSONEncoder().encode(SkillDraft(enabled: false))) as? [String: Any]
        XCTAssertEqual(toggle?.keys.sorted(), ["enabled"])

        let create = try JSONSerialization.jsonObject(with: JSONEncoder().encode(
            SkillDraft(name: "Link triage", description: "d", instructions: "i", enabled: true)
        )) as? [String: Any]
        XCTAssertEqual(create?.keys.sorted(), ["description", "enabled", "instructions", "name"])
    }

    func testStarterTemplatesAreThreeValidSkills() {
        XCTAssertEqual(SkillTemplate.starters.map(\.name), ["Weekly reading digest", "Research brief", "Link triage"])
        for template in SkillTemplate.starters {
            XCTAssertTrue(
                SkillValidation.isValid(name: template.name, description: template.description, instructions: template.instructions),
                "\(template.name) must pass the create schema"
            )
        }
    }

    func testSkillValidationMirrorsTheSchema() {
        XCTAssertNotNil(SkillValidation.nameProblem(""))
        XCTAssertNotNil(SkillValidation.nameProblem("Bad/name"))
        XCTAssertNotNil(SkillValidation.nameProblem(String(repeating: "a", count: 61)))
        XCTAssertNil(SkillValidation.nameProblem("Digest_2026 - weekly"))
        XCTAssertNotNil(SkillValidation.descriptionProblem(String(repeating: "d", count: 201)))
        XCTAssertNil(SkillValidation.descriptionProblem("Short and sweet"))
        XCTAssertNotNil(SkillValidation.instructionsProblem("   "))
        XCTAssertNil(SkillValidation.instructionsProblem("1. Do the thing"))
    }
}
