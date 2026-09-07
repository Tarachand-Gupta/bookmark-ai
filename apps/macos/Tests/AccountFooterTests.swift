import XCTest
@testable import BookmarkAI

/// What the sidebar footer says — the pure derivation behind `AccountFooter`.
/// The primary line is the account's NAME; the email is the tooltip (and stays
/// spelled out in Settings ▸ Account).
final class AccountFooterTests: XCTestCase {

    private let tara = AccountInfo(signedIn: true, name: "Tara Gupta", email: "tara@purecode.ai")

    func testCloudSignedInShowsNameOverHostWithEmailTooltip() {
        let lines = AccountFooter.lines(target: .cloud, status: .signedIn, account: tara)
        XCTAssertEqual(
            lines,
            .init(primary: "Tara Gupta", secondary: "bookmark-ai.cloud", tooltip: "tara@purecode.ai")
        )

        // Surrounding whitespace is trimmed off both, and a long name is the
        // same line: truncating it (middle, one line) is the view's job, so
        // the copy never abbreviates it.
        let long = AccountInfo(signedIn: true, name: " Tarachandra Gupta-Rajagopalan ", email: " tarachandragupta2784@gmail.com ")
        XCTAssertEqual(
            AccountFooter.lines(target: .cloud, status: .signedIn, account: long),
            .init(
                primary: "Tarachandra Gupta-Rajagopalan",
                secondary: "bookmark-ai.cloud",
                tooltip: "tarachandragupta2784@gmail.com"
            )
        )
    }

    func testCloudSignedInWithoutNameFallsBackToEmailThenStatus() {
        let emailOnly = AccountInfo(signedIn: true, name: nil, email: "tara@purecode.ai")
        XCTAssertEqual(
            AccountFooter.lines(target: .cloud, status: .signedIn, account: emailOnly),
            .init(primary: "tara@purecode.ai", secondary: "bookmark-ai.cloud", tooltip: "tara@purecode.ai")
        )
        let blankName = AccountInfo(signedIn: true, name: "   ", email: "tara@purecode.ai")
        XCTAssertEqual(
            AccountFooter.lines(target: .cloud, status: .signedIn, account: blankName).primary,
            "tara@purecode.ai"
        )

        // No email to hover: the name still gets the untruncated tooltip.
        let nameOnly = AccountInfo(signedIn: true, name: "Tara Gupta", email: "   ")
        XCTAssertEqual(
            AccountFooter.lines(target: .cloud, status: .signedIn, account: nameOnly),
            .init(primary: "Tara Gupta", secondary: "bookmark-ai.cloud", tooltip: "Tara Gupta")
        )

        // An open-mode server reports a nameless session.
        let nameless = AccountInfo(signedIn: true, name: nil, email: nil)
        XCTAssertEqual(
            AccountFooter.lines(target: .cloud, status: .signedIn, account: nameless),
            .init(primary: "Signed in", secondary: "bookmark-ai.cloud", tooltip: nil)
        )
    }

    /// A confirmed session whose `/api/me` hasn't answered yet: a short neutral
    /// placeholder, never "Signed in" pretending to be an identity.
    func testCloudIdentityNotLoadedYetShowsPlaceholder() {
        let lines = AccountFooter.lines(target: .cloud, status: .signedIn, account: nil)
        XCTAssertEqual(lines, .init(primary: AccountFooter.loadingPlaceholder, secondary: "bookmark-ai.cloud", tooltip: nil))
        XCTAssertEqual(lines.primary, "Loading…")
        XCTAssertLessThanOrEqual(lines.primary.count, 10, "must fit the footer at the sidebar's minimum width without truncating")
    }

    func testLocalAndGateStatesUseTargetCopy() {
        // Local has no session concept — whatever auth says, even a stale identity.
        for status in [AuthController.Status.unknown, .signedOut, .signedIn, .unreachable] {
            XCTAssertEqual(
                AccountFooter.lines(target: .local, status: status, account: tara),
                .init(primary: "Local account", secondary: "localhost:3000", tooltip: nil),
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
