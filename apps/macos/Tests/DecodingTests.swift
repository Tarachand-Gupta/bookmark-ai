import XCTest
@testable import BookmarkAI

/// Decoding tests against payload shapes copied from the live API. These guard
/// the contract in `packages/types` — if a field is renamed server-side, one of
/// these fails instead of the app silently showing an empty library.
final class DecodingTests: XCTestCase {

    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try ApiClient.decoder.decode(type, from: Data(json.utf8))
    }

    // MARK: - Bookmarks

    /// A real `GET /api/bookmarks` row, nulls and all.
    func testDecodesBookmarkListWithNullOGFields() throws {
        let json = """
        {
          "bookmarks": [{
            "id": "6258757f-61f0-4ca1-8475-05748878f653",
            "url": "https://reactnative.dev",
            "domain": "reactnative.dev",
            "title": "React Native · Learn once, write anywhere",
            "description": null,
            "og": {
              "title": null, "description": null, "image": null, "siteName": null,
              "type": null, "url": "https://reactnative.dev",
              "favicon": "https://reactnative.dev/favicon.ico"
            },
            "source": {
              "browser": "other", "device": "other", "deviceName": null,
              "os": null, "savedAt": "2026-08-11T10:15:30.000Z"
            },
            "category": "development",
            "tags": ["react", "mobile"],
            "createdAt": "2026-08-11T10:15:31.412Z",
            "embedded": true
          }],
          "total": 1
        }
        """

        let response = try decode(ListBookmarksResponse.self, json)
        XCTAssertEqual(response.total, 1)
        let bookmark = try XCTUnwrap(response.bookmarks.first)
        XCTAssertEqual(bookmark.domain, "reactnative.dev")
        XCTAssertEqual(bookmark.category, "development")
        XCTAssertEqual(bookmark.tags, ["react", "mobile"])
        XCTAssertTrue(bookmark.embedded)
        XCTAssertNil(bookmark.displayDescription)
        XCTAssertNil(bookmark.thumbnailURL)
        XCTAssertEqual(bookmark.faviconURL?.absoluteString, "https://reactnative.dev/favicon.ico")
    }

    /// With no scraped favicon, fall back to the domain's conventional path —
    /// never a third-party favicon proxy.
    func testFaviconFallsBackToDomain() throws {
        let json = bookmarkJSON(favicon: "null", image: "null")
        let bookmark = try decode(Bookmark.self, json)
        XCTAssertEqual(bookmark.faviconURL?.absoluteString, "https://example.com/favicon.ico")
    }

    func testThumbnailUsesOGImage() throws {
        let json = bookmarkJSON(favicon: "null", image: "\"https://example.com/cover.png\"")
        let bookmark = try decode(Bookmark.self, json)
        XCTAssertEqual(bookmark.thumbnailURL?.absoluteString, "https://example.com/cover.png")
    }

    /// `browser`/`device` decode as String so a NEW server-side enum member can
    /// never break decoding in an already-shipped build.
    func testUnknownBrowserEnumStillDecodes() throws {
        let json = bookmarkJSON(favicon: "null", image: "null", browser: "brave")
        let bookmark = try decode(Bookmark.self, json)
        XCTAssertEqual(bookmark.source.browser, "brave")
    }

    /// The API emits ISO 8601 both with and WITHOUT fractional seconds.
    func testParsesBothISO8601Shapes() {
        XCTAssertNotNil(ISO8601.date(from: "2026-08-11T10:15:31.412Z"))
        XCTAssertNotNil(ISO8601.date(from: "2026-08-11T10:15:31Z"))
        XCTAssertNil(ISO8601.date(from: "not a date"))
    }

    /// A blank title must not produce a blank row.
    func testDisplayTitleFallsBackToDomain() throws {
        let json = bookmarkJSON(favicon: "null", image: "null", title: "")
        let bookmark = try decode(Bookmark.self, json)
        XCTAssertEqual(bookmark.displayTitle, "example.com")
    }

    // MARK: - Search

    func testDecodesSearchResponseWithExactAndFallback() throws {
        let json = """
        {
          "mode": "hybrid",
          "fallback": true,
          "results": [
            { "bookmark": \(bookmarkJSON(favicon: "null", image: "null")), "score": 0.83, "exact": true },
            { "bookmark": \(bookmarkJSON(favicon: "null", image: "null")), "score": 0.41 }
          ]
        }
        """

        let response = try decode(SearchResponse.self, json)
        XCTAssertEqual(response.mode, "hybrid")
        XCTAssertEqual(response.fallback, true)
        XCTAssertEqual(response.results.count, 2)
        XCTAssertEqual(response.results[0].exact, true)
        XCTAssertNil(response.results[1].exact)
        XCTAssertEqual(response.results[0].score, 0.83, accuracy: 0.0001)
    }

    /// `sessionResults` is not modelled in Phase 1 — an unknown key must be
    /// ignored, not fatal, so the server can add fields freely.
    func testUnknownTopLevelKeysAreIgnored() throws {
        let json = """
        { "mode": "text", "results": [], "sessionResults": [{"session": {}, "score": 2}] }
        """
        let response = try decode(SearchResponse.self, json)
        XCTAssertTrue(response.results.isEmpty)
    }

    // MARK: - Meta

    func testDecodesMetaFacets() throws {
        let json = """
        {
          "categories": [{"name":"development","count":42},{"name":"design","count":7}],
          "browsers": [{"name":"chrome","count":30}],
          "devices": [{"name":"laptop","count":30}],
          "days": [{"day":"2026-08-11","count":5}],
          "tags": [{"name":"react","count":12}],
          "total": 49
        }
        """
        let meta = try decode(MetaResponse.self, json)
        XCTAssertEqual(meta.total, 49)
        XCTAssertEqual(meta.categories.first?.name, "development")
        XCTAssertEqual(meta.categories.first?.count, 42)
        XCTAssertEqual(meta.days.first?.id, "2026-08-11")
    }

    // MARK: - Account

    /// Open modes report `signedIn: true` with null identity — the footer must
    /// render something sensible rather than an empty line.
    func testAccountInfoOpenModeHasLocalLabel() throws {
        let account = try decode(AccountInfo.self, #"{"signedIn":true,"name":null,"email":null}"#)
        XCTAssertEqual(account.displayName, "Local account")
        XCTAssertNil(account.displayDetail)
    }

    func testAccountInfoPrefersNameAndKeepsEmailAsDetail() throws {
        let account = try decode(
            AccountInfo.self, #"{"signedIn":true,"name":"Tara","email":"tara@purecode.ai"}"#
        )
        XCTAssertEqual(account.displayName, "Tara")
        XCTAssertEqual(account.displayDetail, "tara@purecode.ai")
    }

    func testHealthResponse() throws {
        let health = try decode(HealthResponse.self, #"{"ok":true,"ai":true}"#)
        XCTAssertTrue(health.ok)
        XCTAssertTrue(health.ai)
    }

    // MARK: - Fixture

    private func bookmarkJSON(
        favicon: String,
        image: String,
        browser: String = "chrome",
        title: String = "Example"
    ) -> String {
        """
        {
          "id": "abc", "url": "https://example.com", "domain": "example.com",
          "title": "\(title)", "description": null,
          "og": { "title": null, "description": null, "image": \(image), "siteName": null,
                  "type": null, "url": null, "favicon": \(favicon) },
          "source": { "browser": "\(browser)", "device": "laptop", "deviceName": "Mac",
                      "os": "macOS", "savedAt": "2026-08-11T10:15:30Z" },
          "category": "general", "tags": [], "createdAt": "2026-08-11T10:15:30Z",
          "embedded": false
        }
        """
    }
}
