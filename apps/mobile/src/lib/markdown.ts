/**
 * A deliberately small markdown parser for assistant answers.
 *
 * The agent writes GitHub-flavored markdown (see the system prompt in
 * apps/web/app/api/chat/route.ts: inline `[title](url)` citations are MANDATORY
 * and tabular answers must be GFM tables), so a chat that renders raw text shows
 * pipes and asterisks — it reads as broken. The web app runs react-markdown +
 * remark-gfm for this; on RN there is no DOM, every markdown package pulls a
 * renderer of its own, and we only need six constructs. So: pure functions here
 * (no React, no react-native import — trivially testable), rendered by
 * components/chat/ChatMarkdown.tsx.
 *
 * Supported, because the agent actually emits them: headings, paragraphs,
 * bullet/numbered lists, fenced code blocks, GFM tables, and inline bold /
 * italic / code / links. Everything else degrades to plain text rather than
 * failing — an unsupported construct must never eat the answer.
 */

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type MarkdownBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language: string | null; code: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "rule" };

const FENCE = /^\s{0,3}(?:```|~~~)\s*([A-Za-z0-9+#._-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const RULE = /^\s{0,3}(?:[-*_]\s*){3,}$/;
/** A table separator row: `|---|:--:|` (what makes the line above it a header). */
const TABLE_DIVIDER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** Split a table row into trimmed cells, dropping the leading/trailing pipes. */
function tableCells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map((c) => c.trim());
}

function isTableRow(line: string): boolean {
  return line.includes("|") && line.trim().length > 0;
}

/**
 * Parse markdown into a flat list of blocks. Streaming-safe: a half-arrived
 * fenced block (opening fence, no closer yet) still renders as a code block, so
 * text doesn't jump between styles as tokens land.
 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ").trim();
    paragraph = [];
    if (text) blocks.push({ kind: "paragraph", text });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // ── fenced code ──────────────────────────────────────────────────────────
    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const language = fence[1] ? fence[1] : null;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      // `i` now sits on the closing fence (or past the end for a streaming block).
      blocks.push({ kind: "code", language, code: body.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    // ── GFM table: a row followed by a `|---|` divider ───────────────────────
    if (isTableRow(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      flushParagraph();
      const header = tableCells(line);
      const rows: string[][] = [];
      i += 2; // skip the divider
      while (i < lines.length && isTableRow(lines[i]) && !TABLE_DIVIDER.test(lines[i])) {
        rows.push(tableCells(lines[i]));
        i += 1;
      }
      i -= 1; // the outer loop advances past the last consumed row
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    // ── lists (runs of adjacent items of the same kind) ───────────────────────
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null;
      const items: string[] = [(bullet ?? numbered)![1].trim()];
      while (i + 1 < lines.length) {
        const next = lines[i + 1];
        const nextItem = ordered ? NUMBERED.exec(next) : BULLET.exec(next);
        if (!nextItem) break;
        items.push(nextItem[1].trim());
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return blocks;
}

/**
 * Inline spans within one block's text: `**bold**`, `*italic*`/`_italic_`,
 * `` `code` ``, and `[label](href)`. Unclosed markers stay literal (a streaming
 * answer is full of them for a few hundred milliseconds).
 */
export function parseInline(source: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let plain = "";

  const pushPlain = () => {
    if (plain) tokens.push({ kind: "text", text: plain });
    plain = "";
  };

  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);

    // `code` first: markdown gives code spans priority over emphasis.
    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      pushPlain();
      tokens.push({ kind: "code", text: code[1] });
      i += code[0].length;
      continue;
    }

    const link = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (link) {
      pushPlain();
      const label = link[1].trim();
      tokens.push({ kind: "link", text: label || link[2], href: link[2] });
      i += link[0].length;
      continue;
    }

    const bold = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (bold) {
      pushPlain();
      tokens.push({ kind: "bold", text: bold[2] });
      i += bold[0].length;
      continue;
    }

    const italic = /^(\*|_)(?=[^\s*_])([^*_]*[^\s*_])\1/.exec(rest);
    if (italic) {
      pushPlain();
      tokens.push({ kind: "italic", text: italic[2] });
      i += italic[0].length;
      continue;
    }

    plain += source[i];
    i += 1;
  }

  pushPlain();
  return tokens;
}
