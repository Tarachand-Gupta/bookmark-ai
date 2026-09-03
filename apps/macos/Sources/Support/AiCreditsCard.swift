import SwiftUI

/// The free-credits card — the Mac twin of the web's `AiCreditsCallout`, and
/// like it, the ONE place the free-tier numbers and wording live. Units: usage
/// arrives as tokens, displays as credits at 1,000 tokens each. Metering is
/// WEEKLY — the copy always says "this week" / "resets Monday", never monthly.
///
/// `dim` = the user runs on their own key, so the free meter is context, not
/// the active path — it drops the tinted emphasis.
struct AiCreditsCard: View {
    let usage: AiUsage?
    var dim = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 9) {
                Image(systemName: "sparkles")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(dim ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tint))
                    .frame(width: 26, height: 26)
                    .background(
                        (dim ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.tint.opacity(0.12))),
                        in: RoundedRectangle(cornerRadius: 7, style: .continuous)
                    )

                VStack(alignment: .leading, spacing: 1) {
                    Text("Free AI included")
                        .font(.callout)
                        .fontWeight(.medium)
                    Text("Chat and answers run on our shared AI — no setup needed.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }

            if let usage {
                HStack(spacing: 4) {
                    Text("\(usage.usedCredits.formatted()) of \(usage.limitCredits.formatted())")
                        .fontWeight(.medium)
                        .monospacedDigit()
                    Text("credits used this week")
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 8)
                    Text("resets Monday")
                        .foregroundStyle(.secondary)
                }
                .font(.caption)

                // Slim bar; any nonzero spend shows at least a sliver — an empty
                // bar next to "3 of 1,000 used" reads broken.
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.quaternary)
                        Capsule()
                            .fill(usage.exhausted
                                ? AnyShapeStyle(.orange)
                                : dim ? AnyShapeStyle(.tertiary) : AnyShapeStyle(.tint))
                            .frame(width: geo.size.width * max(usage.percentUsed > 0 ? 2 : 0, usage.percentUsed) / 100)
                    }
                }
                .frame(height: 5)

                if usage.exhausted {
                    Text("You've used this week's free credits. Add your own API key in Settings to keep going now, or wait for Monday's reset.")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(dim ? AnyShapeStyle(.clear) : AnyShapeStyle(.tint.opacity(0.06)))
        )
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(.cardFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(dim ? AnyShapeStyle(.separator) : AnyShapeStyle(.tint.opacity(0.35)), lineWidth: 1)
        )
    }
}
