import XCTest
@testable import BookmarkAI

/// What the sidebar footer says — the pure derivation behind `AccountFooter`.
/// The primary line is the account's EMAIL; the name stays in Settings ▸ Account.
final class AccountFooterTests: XCTestCase {

    private let tara = AccountInfo(signedIn: true, name: "Tara Gupta", email: "tara@purecode.ai")

    func testCloudSignedInShowsEmailOverHost() {
        let lines = AccountFooter.lines(target: .cloud, status: .signedIn, account: tara)
        XCTAssertEqual(lines, .init(primary: "tara@purecode.ai", secondary: "bookmark-ai.cloud", isIdentity: true))

        // A long address is the same line: truncating it (middle, one line)
        // is the view's job, so the copy never abbreviates it.
        let long = AccountInfo(signedIn: true, name: "Tarachand Gupta", email: " tarachandragupta2784@gmail.com ")
        XCTAssertEqual(
            AccountFooter.lines(target: .cloud, status: .signedIn, account: long).primary,
            "tarachandragupta2784@gmail.com"
        )
    }

    func testCloudSignedInWithoutEmailFallsBackToNameThenStatus() {
        let nameOnly = AccountInfo(signedIn: true, name: "Tara Gupta", email: nil)
        XCTAssertEqual(
            AccountFooter.lines(target: .cloud, status: .signedIn, account: nameOnly),
            .init(primary: "Tara Gupta", secondary: "bookmark-ai.cloud", isIdentity: true)
        )
        let blankEmail = AccountInfo(signedIn: true, name: "Tara Gupta", email: "   ")
        XCTAssertEqual(AccountFooter.lines(target: .cloud, status: .signedIn, account: blankEmail).primary, "Tara Gupta")

        // An open-mode server reports a nameless session.
        let nameless = AccountInfo(signedIn: true, name: nil, email: nil)
        XCTAssertEqual(
            AccountFooter.lines(target: .cloud, status: .signedIn, account: nameless),
            .init(primary: "Signed in", secondary: "bookmark-ai.cloud", isIdentity: false)
        )
    }

    /// A confirmed session whose `/api/me` hasn't answered yet: a short neutral
    /// placeholder, never "Signed in" pretending to be an identity.
    func testCloudIdentityNotLoadedYetShowsPlaceholder() {
        let lines = AccountFooter.lines(target: .cloud, status: .signedIn, account: nil)
        XCTAssertEqual(lines, .init(primary: AccountFooter.loadingPlaceholder, secondary: "bookmark-ai.cloud", isIdentity: false))
        XCTAssertEqual(lines.primary, "Loading…")
        XCTAssertLessThanOrEqual(lines.primary.count, 10, "must fit the footer at the sidebar's minimum width without truncating")
    }

    func testLocalAndGateStatesUseTargetCopy() {
        // Local has no session concept — whatever auth says, even a stale identity.
        for status in [AuthController.Status.unknown, .signedOut, .signedIn, .unreachable] {
            XCTAssertEqual(
                AccountFooter.lines(target: .local, status: status, account: tara),
                .init(primary: "Local account", secondary: "localhost:3000", isIdentity: false),
                "local · \(status)"
            )
        }
        // Not normally rendered (the gate replaces the sidebar), but never wrong.
        XCTAssertEqual(AccountFooter.lines(target: .cloud, status: .unknown, account: nil).primary, "Connecting…")
        XCTAssertEqual(AccountFooter.lines(target: .cloud, status: .unreachable, account: tara).primary, "Connecting…")
        XCTAssertEqual(AccountFooter.lines(target: .cloud, status: .signedOut, account: nil).primary, "Not signed in")
        XCTAssertEqual(AccountFooter.lines(target: .cloud, status: .signedOut, account: nil).secondary, "bookmark-ai.cloud")
    }
}
