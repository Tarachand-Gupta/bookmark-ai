import AppKit
import XCTest
@testable import BookmarkAI

@MainActor
final class MainWindowLifecycleTests: XCTestCase {
    override func setUp() {
        super.setUp()
        AppDelegate.mainWindow = nil
        AppDelegate.mainWindowCreationPending = false
        AppDelegate.reopenNewWindow = nil
    }

    override func tearDown() {
        AppDelegate.mainWindow = nil
        AppDelegate.mainWindowCreationPending = false
        AppDelegate.reopenNewWindow = nil
        super.tearDown()
    }

    private func window() -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: -10000, y: -10000, width: 100, height: 100), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        return window
    }

    func testRepeatedDockEventsCreateOnlyOneWindowBeforeTheSceneAttaches() {
        var creations = 0
        AppDelegate.reopenNewWindow = { creations += 1 }
        for _ in 0..<5 { XCTAssertTrue(AppDelegate.reopen(hasVisibleWindows: true, window: nil)) }
        XCTAssertEqual(creations, 1)
        XCTAssertTrue(AppDelegate.mainWindowCreationPending)
    }

    func testClosingMainThenReopeningCreatesOneReplacement() {
        let main = window()
        AppDelegate.registerMainWindow(main)
        AppDelegate.mainWindowDidClose(main)
        var creations = 0
        AppDelegate.reopenNewWindow = { creations += 1 }
        XCTAssertTrue(AppDelegate.reopen(hasVisibleWindows: false, window: AppDelegate.mainWindow))
        XCTAssertTrue(AppDelegate.reopen(hasVisibleWindows: false, window: AppDelegate.mainWindow))
        XCTAssertEqual(creations, 1)
        let replacement = window()
        AppDelegate.registerMainWindow(replacement)
        XCTAssertTrue(AppDelegate.mainWindow === replacement)
        XCTAssertFalse(AppDelegate.mainWindowCreationPending)
        XCTAssertEqual(replacement.tabbingMode, .disallowed)
    }

    func testSettingsCloseCannotClearTheMainWindowOrPendingCreation() {
        let main = window(), settings = window()
        AppDelegate.registerMainWindow(main)
        AppDelegate.mainWindowCreationPending = true
        AppDelegate.mainWindowDidClose(settings)
        XCTAssertTrue(AppDelegate.mainWindow === main)
        XCTAssertTrue(AppDelegate.mainWindowCreationPending)
    }

    func testDuplicateMainSceneIsRetiredWithoutClosingSettingsOrOriginal() async {
        let main = window(), duplicate = window(), settings = window()
        AppDelegate.registerMainWindow(main)
        let closed = expectation(forNotification: NSWindow.willCloseNotification, object: duplicate)
        let originalClosed = expectation(forNotification: NSWindow.willCloseNotification, object: main)
        originalClosed.isInverted = true
        let settingsClosed = expectation(forNotification: NSWindow.willCloseNotification, object: settings)
        settingsClosed.isInverted = true
        AppDelegate.registerMainWindow(duplicate)
        XCTAssertTrue(AppDelegate.mainWindow === main)
        await fulfillment(of: [closed, originalClosed, settingsClosed], timeout: 0.2)
        main.orderOut(nil)
    }

    func testClosingLastWindowKeepsTheAppAvailableForDockReopen() {
        XCTAssertFalse(AppDelegate().applicationShouldTerminateAfterLastWindowClosed(NSApplication.shared))
    }
}
