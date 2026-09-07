//
//  AppDelegate.swift
//  Bookmark AI for Safari
//
//  The container app the Mac App Store requires around a Safari web extension,
//  built as a menu-bar (LSUIElement) companion:
//    • an NSStatusItem with the live extension state + the same actions as the
//      setup window, so the app is useful after its window is closed;
//    • a single, fixed-size setup window (SwiftUI, `SetupView`) that opens on
//      first launch and whenever the app is opened again from Finder/Launchpad —
//      it explains how to turn the extension on and deep-links into Safari;
//    • an optional login item (SMAppService) so the menu-bar icon is there at
//      login. Opt-in from the window/menu — no modal prompt on first launch.
//
//  Programmatic UI only (no storyboard): the whole project is generated from
//  project.yml, so there is nothing to click-configure in Xcode.
//

import AppKit
import SwiftUI

@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {

    /// `@main` on an NSApplicationDelegate is NOT enough without a storyboard:
    /// AppKit's default `main()` just calls `NSApplicationMain`, which only
    /// instantiates a delegate when Info.plist names a main storyboard/nib (the
    /// converter template relied on that). Verified 2026-09-07: without this the
    /// app ran with no status item and no window. So create, retain (the
    /// `delegate` property is unowned) and install the delegate ourselves.
    private static var retainedDelegate: AppDelegate?

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        retainedDelegate = delegate
        app.delegate = delegate
        _ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
    }

    private let model = CompanionModel()

    private var statusItem: NSStatusItem?
    private var authStateItem: NSMenuItem?
    private var extensionStateItem: NSMenuItem?
    private var loginMenuItem: NSMenuItem?

    private var setupWindow: NSWindow?
    private var statePoller: Timer?

    /// UserDefaults flag: have we ever finished a launch before? Drives the
    /// one-time setup window; later (login-item) launches stay silent.
    private let hasLaunchedBeforeKey = "ai.bookmark.safari.hasLaunchedBefore"

    // MARK: - Lifecycle

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = Self.makeKeyEquivalentMenu()
        setUpStatusItem()
        observeModelForMenu()

        let defaults = UserDefaults.standard
        let firstLaunch = !defaults.bool(forKey: hasLaunchedBeforeKey)
        if firstLaunch {
            defaults.set(true, forKey: hasLaunchedBeforeKey)
        }
        // `--show-setup` (dev/QA): force the window on a non-first launch, e.g.
        //   open -n "/Applications/Bookmark AI.app" --args --show-setup
        if firstLaunch || CommandLine.arguments.contains("--show-setup") {
            showSetupWindow()
        }
        model.refresh()
    }

    /// A menu-bar app stays alive with no windows — closing the setup window must NOT quit.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    /// Double-clicking the app in Finder/Launchpad (or `open`ing it again) re-shows the window.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showSetupWindow()
        return false
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        model.refresh()
    }

    // MARK: - Main menu (key equivalents only)

    /// LSUIElement apps show no menu bar, but key equivalents in `NSApp.mainMenu`
    /// are still dispatched — this is what makes ⌘W close the window and ⌘Q quit.
    private static func makeKeyEquivalentMenu() -> NSMenu {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu(title: "Bookmark AI")
        appMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        appMenu.addItem(withTitle: "Quit Bookmark AI", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        return main
    }

    // MARK: - Status item / menu

    private func setUpStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            let image = NSImage(systemSymbolName: "bookmark.fill", accessibilityDescription: "Bookmark AI")
            image?.isTemplate = true // adapts to light/dark menu bars
            button.image = image
            button.toolTip = "Bookmark AI for Safari"
        }
        item.menu = buildMenu()
        statusItem = item
    }

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()
        menu.delegate = self // menuWillOpen refreshes the live rows each time it opens

        // Disabled status lines — nil action + autoenable ⇒ greyed out. Text updated live.
        let auth = NSMenuItem(title: Self.menuTitle(for: model.authState), action: nil, keyEquivalent: "")
        auth.isEnabled = false
        menu.addItem(auth)
        authStateItem = auth

        let state = NSMenuItem(title: Self.menuTitle(for: model.extensionState), action: nil, keyEquivalent: "")
        state.isEnabled = false
        menu.addItem(state)
        extensionStateItem = state

        menu.addItem(.separator())
        menu.addItem(actionItem("Open Safari Extensions Settings…", #selector(openExtensionSettings)))
        menu.addItem(actionItem("Open Bookmark AI in Safari", #selector(openWebApp)))
        menu.addItem(actionItem("Show Setup Window", #selector(showSetupWindowFromMenu)))

        menu.addItem(.separator())
        let login = actionItem("Start at Login", #selector(toggleLoginItem(_:)))
        login.state = model.launchAtLogin ? .on : .off
        menu.addItem(login)
        loginMenuItem = login

        menu.addItem(.separator())
        menu.addItem(actionItem("Quit Bookmark AI", #selector(quit), keyEquivalent: "q"))
        return menu
    }

    private func actionItem(_ title: String, _ selector: Selector, keyEquivalent: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: selector, keyEquivalent: keyEquivalent)
        item.target = self
        return item
    }

    private static func menuTitle(for state: CompanionModel.ExtensionState) -> String {
        switch state {
        case .unknown: return "Safari extension: checking…"
        case .enabled: return "Safari extension: on"
        case .disabled: return "Safari extension: off"
        }
    }

    /// What the extension reported about its sign-in (App Group suite). One line,
    /// so a long address is middle-truncated and keeps its domain readable.
    private static func menuTitle(for auth: CompanionModel.AuthState) -> String {
        switch auth {
        case .unknown: return "Sign-in state unknown"
        case .signedOut: return "Not signed in"
        case let .signedIn(email, name):
            let who = (email?.isEmpty == false ? email : nil) ?? (name?.isEmpty == false ? name : nil)
            guard let who else { return "Signed in" }
            return "Signed in as " + AuthStateStore.middleTruncated(who)
        }
    }

    /// Menu items are plain AppKit objects, so observe the model by hand and
    /// re-arm after every change (withObservationTracking fires once).
    private func observeModelForMenu() {
        withObservationTracking {
            authStateItem?.title = Self.menuTitle(for: model.authState)
            extensionStateItem?.title = Self.menuTitle(for: model.extensionState)
            loginMenuItem?.state = model.launchAtLogin ? .on : .off
        } onChange: { [weak self] in
            Task { @MainActor [weak self] in self?.observeModelForMenu() }
        }
    }

    // MARK: - NSMenuDelegate

    func menuWillOpen(_ menu: NSMenu) {
        model.refresh()
    }

    // MARK: - Menu actions

    @objc private func openExtensionSettings() {
        model.openSafariExtensionSettings()
    }

    /// `model.open` always lands in Safari (see CompanionModel.open) — the whole
    /// point of this companion is the Safari session.
    @objc private func openWebApp() {
        model.open(CompanionModel.webAppURL)
    }

    @objc private func showSetupWindowFromMenu() {
        showSetupWindow()
    }

    @objc private func toggleLoginItem(_ sender: NSMenuItem) {
        model.setLaunchAtLogin(!model.launchAtLogin)
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }

    // MARK: - Setup window

    private func showSetupWindow() {
        if setupWindow == nil {
            let hosting = NSHostingController(rootView: SetupView(model: model))
            hosting.sizingOptions = [.preferredContentSize]
            let window = NSWindow(contentViewController: hosting)
            window.title = "Bookmark AI for Safari"
            window.styleMask = [.titled, .closable, .miniaturizable]
            window.isReleasedWhenClosed = false // reused for the app's lifetime
            window.setFrameAutosaveName("BookmarkAI.SetupWindow")
            window.center()
            window.delegate = self
            setupWindow = window
        }
        setupWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate()
        model.refresh()
        startPollingState()
    }

    /// Poll Safari while the window is on screen so the status card follows the
    /// switch in Safari ▸ Settings ▸ Extensions live. Stopped on close.
    private func startPollingState() {
        statePoller?.invalidate()
        statePoller = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.model.refresh() }
        }
    }

    private func stopPollingState() {
        statePoller?.invalidate()
        statePoller = nil
    }
}

extension AppDelegate: NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        stopPollingState()
    }
}
