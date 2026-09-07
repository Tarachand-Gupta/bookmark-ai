//
//  SetupView.swift
//  Bookmark AI for Safari
//
//  The one window of the companion app. App Store review opens the app and
//  expects it to do something: this explains the three steps (turn on the
//  extension, sign in on the web once, save from the toolbar), shows the live
//  on/off state Safari reports, deep-links into Safari's extension settings and
//  hosts the "Start at login" preference. Semantic colors/materials throughout,
//  so light and dark are correct by construction. Fixed width; height follows
//  the content.
//

import SwiftUI

struct SetupView: View {
    var model: CompanionModel

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            statusCard
            steps
            Divider()
            loginRow
            footer
        }
        .padding(24)
        .frame(width: 480)
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .top, spacing: 16) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 64, height: 64)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("Bookmark AI for Safari")
                    .font(.title2.weight(.semibold))
                Text("Save any page in one click — AI files and tags it, and you find it again by meaning.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Status

    private var statusCard: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(statusColor)
                .frame(width: 10, height: 10)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(statusTitle)
                    .font(.headline)
                Text(statusDetail)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 12)
            Button(model.extensionState == .disabled ? "Turn On in Safari…" : "Safari Settings…") {
                model.openSafariExtensionSettings()
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)
            .disabled(model.extensionState == .unknown)
        }
        .padding(14)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var statusColor: Color {
        switch model.extensionState {
        case .enabled: return .green
        case .disabled: return .orange
        case .unknown: return .secondary
        }
    }

    private var statusTitle: String {
        switch model.extensionState {
        case .enabled: return "Bookmark AI is on in Safari"
        case .disabled: return "Bookmark AI is off in Safari"
        case .unknown: return "Checking Safari…"
        }
    }

    private var statusDetail: String {
        switch model.extensionState {
        case .enabled:
            if let account = model.signedInLabel {
                return "\(account). Click the bookmark button in Safari's toolbar to save."
            }
            if model.authState == .signedOut {
                return "Not signed in yet — sign in on bookmark-ai.cloud (step 2), then save from the toolbar."
            }
            return "Click the bookmark button in Safari's toolbar to save the page you're on."
        case .disabled: return "Turn it on under Safari ▸ Settings ▸ Extensions."
        case .unknown: return "Safari hasn't reported the extension's state yet."
        }
    }

    private var extensionIsOn: Bool { model.extensionState == .enabled }
    private var isSignedIn: Bool { model.authState.isSignedIn }

    // MARK: - Steps

    private var steps: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("How it works")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            // Steps 1 and 2 flip to a green check once they are actually done —
            // step 1 from Safari's own verdict, step 2 from what the extension
            // reports through the App Group (never guessed).
            StepRow(
                number: 1,
                done: extensionIsOn,
                title: extensionIsOn ? "Extension is on" : "Turn on the extension",
                detail: extensionIsOn
                    ? "Bookmark AI is enabled in Safari."
                    : "Safari ▸ Settings ▸ Extensions ▸ tick Bookmark AI. The button above opens that pane."
            )
            StepRow(
                number: 2,
                done: isSignedIn,
                title: isSignedIn ? "Signed in on the web" : "Sign in once on the web",
                detail: model.signedInLabel
                    ?? "Open bookmark-ai.cloud and sign in. When Safari asks, allow Bookmark AI on that site — that's how the extension picks up your session. It never asks for a password itself.",
                singleLineDetail: isSignedIn
            )
            StepRow(
                number: 3,
                title: "Save from Safari's toolbar",
                detail: "Click the Bookmark AI button or press ⌥⇧S to save the page you're on. Save a whole window as a session, or share it live to your other devices."
            )
            HStack(spacing: 10) {
                Button("Open Bookmark AI") { model.open(CompanionModel.webAppURL) }
                    .controlSize(.large)
                if !isSignedIn {
                    Button("Sign In") { model.open(CompanionModel.signInURL) }
                        .controlSize(.large)
                }
                Spacer()
            }
            .padding(.top, 2)
        }
    }

    // MARK: - Login item

    private var loginRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(isOn: Binding(
                get: { model.launchAtLogin },
                set: { model.setLaunchAtLogin($0) }
            )) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Start at login")
                    Text("Keeps the Bookmark AI icon in your menu bar for quick access to Safari's extension settings and your library. The extension itself runs inside Safari either way.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .toggleStyle(.switch)
            .controlSize(.small)
            if let error = model.loginItemError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Footer

    private var footer: some View {
        HStack(spacing: 6) {
            Link("Privacy Policy", destination: CompanionModel.privacyURL)
            Text("·").foregroundStyle(.tertiary)
            Link("Support", destination: CompanionModel.supportURL)
            Spacer()
            Text(model.versionLabel)
                .foregroundStyle(.tertiary)
        }
        .font(.caption)
    }
}

/// Numbered step with a circled index — the same "1 / 2 / 3" rhythm as the
/// setup cards in the web app's onboarding. `done` swaps the index for a green
/// check; `singleLineDetail` middle-truncates (for an e-mail address).
private struct StepRow: View {
    let number: Int
    var done: Bool = false
    let title: String
    let detail: String
    var singleLineDetail: Bool = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            badge
                .frame(width: 22, height: 22)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body.weight(.medium))
                detailText
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Step \(number)\(done ? ", done" : ""): \(title). \(detail)")
    }

    @ViewBuilder
    private var badge: some View {
        if done {
            Image(systemName: "checkmark")
                .font(.caption.weight(.bold))
                .foregroundStyle(.white)
                .background(Color.green, in: Circle().inset(by: -6))
        } else {
            Text("\(number)")
                .font(.caption.weight(.bold).monospacedDigit())
                .frame(width: 22, height: 22)
                .background(.tint.opacity(0.15), in: Circle())
                .foregroundStyle(.tint)
        }
    }

    @ViewBuilder
    private var detailText: some View {
        if singleLineDetail {
            Text(detail)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
        } else {
            Text(detail)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
