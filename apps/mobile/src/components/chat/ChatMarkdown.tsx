import { Fragment } from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../context/PreferencesContext";
import {
  parseInline,
  parseMarkdown,
  type InlineToken,
  type MarkdownBlock,
} from "../../lib/markdown";

/**
 * Renders the agent's markdown with React Native primitives — the mobile
 * counterpart of the web thread's react-markdown + remark-gfm. Only the
 * constructs the agent actually emits are styled (see src/lib/markdown.ts for
 * the why); anything else falls through as plain text.
 *
 * Deliberately no markdown library: every RN option ships its own renderer and
 * its own theming story, for six constructs we can style with Text/View.
 */
export function ChatMarkdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <View style={styles.blocks}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </View>
  );
}

function Block({ block }: { block: MarkdownBlock }) {
  const { colors, radius } = useAppTheme();

  switch (block.kind) {
    case "heading":
      return (
        <Text
          style={[
            styles.heading,
            { color: colors.foreground, fontSize: block.level <= 2 ? 19 : 17 },
          ]}
        >
          <Inline tokens={parseInline(block.text)} />
        </Text>
      );

    case "paragraph":
      return (
        <Text style={[styles.body, { color: colors.foreground }]}>
          <Inline tokens={parseInline(block.text)} />
        </Text>
      );

    case "list":
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={[styles.bullet, { color: colors.mutedForeground }]}>
                {block.ordered ? `${i + 1}.` : "•"}
              </Text>
              <Text style={[styles.body, styles.listText, { color: colors.foreground }]}>
                <Inline tokens={parseInline(item)} />
              </Text>
            </View>
          ))}
        </View>
      );

    case "code":
      return (
        // Long lines scroll sideways instead of wrapping mid-token — a wrapped
        // SQL statement is unreadable, and the agent's queryDatabase answers
        // quote SQL constantly.
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.codeBlock, { backgroundColor: colors.muted, borderRadius: radius.md }]}
          contentContainerStyle={styles.codeBlockContent}
        >
          <Text style={[styles.mono, { color: colors.foreground }]}>{block.code}</Text>
        </ScrollView>
      );

    case "table":
      return <Table header={block.header} rows={block.rows} />;

    case "rule":
      return <View style={[styles.rule, { backgroundColor: colors.border }]} />;
  }
}

/** A GFM table: horizontally scrollable, header row emphasized. The agent is
 * instructed to answer tabular questions with tables, so this is a load-bearing
 * block, not a nicety. */
function Table({ header, rows }: { header: string[]; rows: string[][] }) {
  const { colors, radius } = useAppTheme();
  const columns = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const cell = (value: string | undefined, key: number, bold: boolean) => (
    <Text
      key={key}
      numberOfLines={3}
      style={[
        styles.tableCell,
        {
          color: bold ? colors.foreground : colors.cardForeground,
          fontWeight: bold ? "600" : "400",
          borderLeftColor: colors.border,
          // No rule to the left of the first column — that's the table's own edge.
          borderLeftWidth: key === 0 ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <Inline tokens={parseInline(value ?? "")} />
    </Text>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={[styles.table, { borderColor: colors.border, borderRadius: radius.md }]}>
        <View style={[styles.tableRow, { backgroundColor: colors.muted }]}>
          {Array.from({ length: columns }, (_, c) => cell(header[c], c, true))}
        </View>
        {rows.map((row, r) => (
          <View
            key={r}
            style={[styles.tableRow, { borderTopColor: colors.border, borderTopWidth: 1 }]}
          >
            {Array.from({ length: columns }, (_, c) => cell(row[c], c, false))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/** Inline spans. Nested <Text> inherits the parent's size/line-height, so bold,
 * code, and links stay on the same baseline as the surrounding sentence. */
function Inline({ tokens }: { tokens: InlineToken[] }) {
  const { colors } = useAppTheme();
  return (
    <>
      {tokens.map((token, i) => {
        switch (token.kind) {
          case "bold":
            return (
              <Text key={i} style={styles.bold}>
                {token.text}
              </Text>
            );
          case "italic":
            return (
              <Text key={i} style={styles.italic}>
                {token.text}
              </Text>
            );
          case "code":
            return (
              <Text key={i} style={[styles.inlineCode, { color: colors.foreground }]}>
                {token.text}
              </Text>
            );
          case "link":
            return (
              <Text
                key={i}
                // The agent's citations are the main way out of a chat and into a
                // bookmark, so links have to be tappable, not just tinted.
                onPress={() => void Linking.openURL(token.href).catch(() => undefined)}
                style={[styles.link, { color: colors.foreground }]}
                accessibilityRole="link"
              >
                {token.text}
              </Text>
            );
          case "text":
            return <Fragment key={i}>{token.text}</Fragment>;
        }
      })}
    </>
  );
}

/** RN has no generic "monospace" family on iOS — Menlo is the system mono there,
 * `monospace` is the alias Android resolves. */
const MONO_FAMILY = Platform.select({ ios: "Menlo", default: "monospace" });

const styles = StyleSheet.create({
  blocks: { gap: 10 },
  body: { fontSize: 16, lineHeight: 23 },
  heading: { fontWeight: "700", lineHeight: 25 },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  inlineCode: { fontFamily: MONO_FAMILY, fontSize: 14 },
  link: { textDecorationLine: "underline" },
  list: { gap: 4 },
  listItem: { flexDirection: "row", gap: 8 },
  bullet: { fontSize: 16, lineHeight: 23, minWidth: 16, textAlign: "right" },
  listText: { flex: 1 },
  codeBlock: { maxHeight: 260 },
  codeBlockContent: { padding: 12 },
  mono: { fontFamily: MONO_FAMILY, fontSize: 13, lineHeight: 19 },
  rule: { height: StyleSheet.hairlineWidth },
  table: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  tableRow: { flexDirection: "row" },
  tableCell: {
    width: 140,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    lineHeight: 19,
  },
});
