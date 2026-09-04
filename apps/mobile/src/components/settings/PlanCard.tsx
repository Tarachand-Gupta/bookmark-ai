import { StyleSheet, Text, View } from "react-native";
import { PLAN_FAIR_USE_NOTE, PLAN_FEATURES, type PlanId } from "@bookmark-ai/types";
import { useAppTheme } from "../../context/PreferencesContext";
import { Symbol } from "../Symbol";
import { Group, GroupFootnote, GroupLabel } from "./SettingsGroup";

/** "Free plan" pill under the profile name. Copy comes from PLAN_FEATURES so it
 * can't drift from the web's pricing card or the macOS app. */
export function PlanBadge({ plan }: { plan: PlanId }) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[styles.badge, { backgroundColor: colors.muted, borderColor: colors.border }]}
      accessibilityRole="text"
      accessibilityLabel={`${PLAN_FEATURES[plan].name} plan`}
    >
      <Symbol name="checkmark.seal.fill" size={13} color={colors.foreground} fallback="✓" />
      <Text style={[styles.badgeText, { color: colors.foreground }]}>
        {PLAN_FEATURES[plan].name} plan
      </Text>
    </View>
  );
}

/** Settings → Plan: the plan's name and price, its feature lines, the fair-use footnote. */
export function PlanCard({ plan }: { plan: PlanId }) {
  const { colors } = useAppTheme();
  const definition = PLAN_FEATURES[plan];
  return (
    <>
      <GroupLabel>Plan</GroupLabel>
      <Group>
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={[styles.name, { color: colors.foreground }]}>{definition.name}</Text>
            <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
              Everything, today
            </Text>
          </View>
          <View style={styles.price}>
            <Text style={[styles.priceValue, { color: colors.foreground }]}>${definition.price}</Text>
            <Text style={[styles.pricePeriod, { color: colors.mutedForeground }]}>/ month</Text>
          </View>
        </View>
        {definition.features.map((feature) => (
          <View
            key={feature.key}
            style={[styles.feature, { borderTopColor: colors.border }]}
            accessibilityRole="text"
          >
            <Symbol
              name="checkmark.circle.fill"
              size={18}
              color={colors.mutedForeground}
              fallback="✓"
            />
            <Text style={[styles.featureText, { color: colors.foreground }]}>{feature.label}</Text>
          </View>
        ))}
      </Group>
      <GroupFootnote>{PLAN_FAIR_USE_NOTE}. Everyone is on the Free plan today.</GroupFootnote>
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: { fontSize: 12, fontWeight: "600", letterSpacing: 0.2 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headText: { gap: 2 },
  name: { fontSize: 20, fontWeight: "700" },
  tagline: { fontSize: 13 },
  price: { flexDirection: "row", alignItems: "baseline", gap: 3 },
  priceValue: { fontSize: 22, fontWeight: "700" },
  pricePeriod: { fontSize: 13 },
  feature: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  featureText: { flex: 1, fontSize: 15, lineHeight: 20 },
});
