import { StyleSheet, Text, View } from "react-native";
import type { DashboardActivity } from "@bookmark-ai/types";
import { useAppTheme } from "../context/PreferencesContext";

/** Trailing entries of `activity.days` counted as "this week". */
const WEEK_DAYS = 7;

const SPARK_HEIGHT = 18;

/**
 * Activity: exactly one quiet row — saves this week, the top category, and a
 * 14-day sparkline (§4.6). Deliberately NOT tappable and deliberately tiny: it
 * is the one allowed non-verb on the dashboard. No streaks, no "up 23%".
 *
 * Rendered only when the server sends `activity` (it withholds it below the
 * data volume where a chart looks broken), and hidden here too if that payload
 * turns out to have nothing worth saying.
 */
export function HomeActivityRow({ activity }: { activity: DashboardActivity }) {
  const { colors, radius } = useAppTheme();

  // `days` arrives as a fixed 14-entry ascending, zero-filled window (see
  // dashboardActivitySchema), so it IS the sparkline — consumed positionally on
  // purpose. Re-deriving local calendar keys and looking them up would shift the
  // whole chart by a day in any timezone offset from the UTC `saved_day` keys.
  const spark = activity.days.map((d) => d.count);
  const week = spark.slice(-WEEK_DAYS).reduce((sum, count) => sum + count, 0);
  const topCategory = activity.topCategories[0]?.name;
  const max = Math.max(1, ...spark);

  const parts = [`${week} save${week === 1 ? "" : "s"} this week`];
  if (topCategory) parts.push(`Top: ${topCategory}`);
  const summary = parts.join(" · ");

  // Nothing this week and no category → say nothing at all.
  if (week === 0 && topCategory === undefined) return null;

  return (
    <View
      accessible
      accessibilityLabel={summary}
      style={[
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg },
      ]}
    >
      <Text numberOfLines={1} style={[styles.summary, { color: colors.mutedForeground }]}>
        {summary}
      </Text>
      <View style={styles.spark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {spark.map((count, i) => (
          <View
            key={i}
            style={{
              width: 4,
              // 2pt floor keeps empty days visible as a baseline tick.
              height: count === 0 ? 2 : Math.max(3, (count / max) * SPARK_HEIGHT),
              borderRadius: 2,
              backgroundColor: count === 0 ? colors.border : colors.mutedForeground,
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginHorizontal: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  summary: { fontSize: 13, flexShrink: 1 },
  spark: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: SPARK_HEIGHT },
});
