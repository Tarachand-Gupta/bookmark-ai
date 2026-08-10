import { restoreSessionViaExtension } from "@/lib/extension-bridge";
import { planTabOpen, OPEN_TABS_MAX } from "@/lib/dashboard";

/**
 * "Open all" for a set of tab URLs, shared by the Continue hero and the sessions
 * shelf. Same escalation the saved-sessions view uses (sessions-view.tsx):
 *
 * 1. Ask the extension to restore them as ONE new window — the only way that
 *    isn't fought by the pop-up blocker.
 * 2. Fall back to a page-side `window.open` loop, capped at OPEN_TABS_MAX and
 *    confirmed past OPEN_TABS_CONFIRM_OVER (see planTabOpen), reporting honestly
 *    when the blocker ate some of them.
 *
 * Returns a user-facing note, or null when everything opened cleanly.
 */
export async function openTabsInNewWindow(
  urls: string[],
  options: { name?: string } = {},
): Promise<string | null> {
  const plan = planTabOpen(urls);
  if (plan.urls.length === 0) return "Nothing to open — these tabs aren't openable links.";

  if (await restoreSessionViaExtension(plan.urls, { mode: "window", name: options.name })) {
    return plan.skipped > 0
      ? `Opened the first ${OPEN_TABS_MAX} tabs (${plan.skipped} more not opened).`
      : null;
  }

  if (
    plan.needsConfirm &&
    !window.confirm(`Open ${plan.urls.length} tabs in this browser?`)
  ) {
    return null;
  }

  // No "noopener,noreferrer" in the features string: per spec window.open()
  // returns NULL whenever noopener is requested, which made `opened` always 0 and
  // the note below claim the pop-up blocker ate every tab while all of them
  // opened. Counting what actually opened is only possible without it — and these
  // are the user's own saved bookmarks, opened by their own click, not untrusted
  // third-party links (rel= semantics don't exist for window.open features anyway).
  let opened = 0;
  for (const url of plan.urls) {
    if (window.open(url, "_blank")) opened++;
  }
  if (opened < plan.urls.length) {
    return `Your pop-up blocker let ${opened} of ${plan.urls.length} tabs through. Allow pop-ups for this site, or install the Bookmark AI extension to open them as one window.`;
  }
  return plan.skipped > 0
    ? `Opened ${opened} tabs — ${plan.skipped} more weren't opened (limit ${OPEN_TABS_MAX}).`
    : null;
}
