/** Programmatic dialogs have no Radix trigger to restore. Return to the visible
 * action for this bookmark, or the library when deletion removed the row. */
export function restoreBookmarkFocus(bookmarkId?: string) {
  const actions = bookmarkId
    ? [...document.querySelectorAll<HTMLElement>("[data-bookmark-actions]")]
        .find((node) => node.dataset.bookmarkActions === bookmarkId)
    : null;
  const target = [...(actions?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .find((button) => button.getClientRects().length > 0 && !button.disabled);
  (target ?? document.getElementById("library-content"))?.focus({ preventScroll: true });
}
