import AppKit
import SwiftUI

/// The sidebar's update banner, directly above the account footer. Renders
/// nothing unless `AppUpdateModel.banner` says so. Two variants: a newer
/// version (Download / Later) and an unsupported one (Download only — the copy
/// says why, and it cannot be dismissed).
struct UpdateBanner: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    @State private var isHovering = false

    var body: some View {
        if let banner = appEnvironment.updates.banner {
            VStack(alignment: .leading, spacing: 9) {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: banner.isBlocking ? "exclamationmark.triangle.fill" : "arrow.down.circle.fill")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(banner.isBlocking ? AnyShapeStyle(.orange) : AnyShapeStyle(.tint))
                        .frame(width: 18)
                        .padding(.top, 1)
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 3) {
                        Text("Bookmark AI \(banner.version) is available")
                            .font(.system(size: 12, weight: .semibold))
                            .lineLimit(2)
                        if banner.isBlocking {
                            // NB: no `fixedSize(vertical:)` here — inside the
                            // sidebar's VStack it inflates the banner's minimum
                            // height and the whole column overflows the window
                            // (List loses its share, footer gets clipped).
                            Text("This version is no longer supported — update to keep syncing.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                        } else if let notes = banner.notes {
                            Text(notes)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                    }
                    Spacer(minLength: 0)
                }

                HStack(spacing: 8) {
                    Button("Download") { NSWorkspace.shared.open(banner.downloadURL) }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .pointingHandCursor()
                        .help(banner.downloadURL.absoluteString)
                        .accessibilityIdentifier("update-download")
                    if !banner.isBlocking {
                        Button("Later") { appEnvironment.updates.snooze() }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .pointingHandCursor()
                            .help("Hide this for 24 hours")
                            .accessibilityIdentifier("update-later")
                    }
                    Spacer(minLength: 0)
                }
                .padding(.leading, 26)
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.primary.opacity(isHovering ? 0.09 : 0.06))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(
                        banner.isBlocking ? AnyShapeStyle(.orange.opacity(0.5)) : AnyShapeStyle(.separator),
                        lineWidth: 1
                    )
            )
            .animation(.easeOut(duration: 0.12), value: isHovering)
            .onHover { isHovering = $0 }
            .padding(.horizontal, 8)
            .padding(.top, 8)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(banner.isBlocking ? "update-banner-blocking" : "update-banner")
        }
    }
}
