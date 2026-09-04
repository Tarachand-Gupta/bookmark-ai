import Foundation

/// The history popover's day buckets and row timestamps — pure functions over
/// `ChatConversation.updatedAt`, so the grouping and the copy are unit-tested
/// against a fixed clock and locale.
enum ChatHistoryGrouping {

    struct Section: Identifiable, Equatable {
        let title: String
        let conversations: [ChatConversation]
        var id: String { title }
    }

    /// Newest first, bucketed as Today / Yesterday / Earlier. Conversations
    /// with an unparsable date sort last and land in Earlier.
    static func sections(
        _ conversations: [ChatConversation],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [Section] {
        let sorted = conversations.sorted { lhs, rhs in
            (ISO8601.date(from: lhs.updatedAt) ?? .distantPast) > (ISO8601.date(from: rhs.updatedAt) ?? .distantPast)
        }
        var buckets: [(title: String, conversations: [ChatConversation])] = []
        for conversation in sorted {
            let title = bucketTitle(for: ISO8601.date(from: conversation.updatedAt), now: now, calendar: calendar)
            if let index = buckets.firstIndex(where: { $0.title == title }) {
                buckets[index].conversations.append(conversation)
            } else {
                buckets.append((title: title, conversations: [conversation]))
            }
        }
        return buckets.map { Section(title: $0.title, conversations: $0.conversations) }
    }

    static func bucketTitle(for date: Date?, now: Date, calendar: Calendar) -> String {
        guard let date else { return "Earlier" }
        if calendar.isDate(date, inSameDayAs: now) { return "Today" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           calendar.isDate(date, inSameDayAs: yesterday) {
            return "Yesterday"
        }
        return "Earlier"
    }

    /// "Just now" · "2 min ago" · today's older ones as the time ("14:03") ·
    /// "Yesterday 14:03" · "24 Aug, 14:03" · "24 Aug 2025". Times follow the
    /// locale's clock (12h / 24h).
    static func relativeTime(
        _ date: Date?,
        now: Date = Date(),
        calendar: Calendar = .current,
        locale: Locale = .current
    ) -> String {
        guard let date else { return "" }
        let seconds = now.timeIntervalSince(date)
        if seconds < 60 { return "Just now" }
        if seconds < 3_600 { return "\(Int(seconds / 60)) min ago" }

        let time = format(date, template: "jmm", calendar: calendar, locale: locale)
        if calendar.isDate(date, inSameDayAs: now) { return time }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
           calendar.isDate(date, inSameDayAs: yesterday) {
            return "Yesterday \(time)"
        }
        if calendar.isDate(date, equalTo: now, toGranularity: .year) {
            return "\(format(date, template: "MMMd", calendar: calendar, locale: locale)), \(time)"
        }
        return format(date, template: "yMMMd", calendar: calendar, locale: locale)
    }

    private static func format(_ date: Date, template: String, calendar: Calendar, locale: Locale) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = locale
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: date)
    }
}
