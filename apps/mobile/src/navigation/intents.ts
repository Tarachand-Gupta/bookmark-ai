import type { SessionsSegment } from "../hooks/useLiveDevices";

/**
 * Cross-tab navigation without a nav library. The Shell (App.tsx) keeps the
 * active tab in state and screens stay mounted, so "go to the Library filtered
 * by a tag" is one state update plus a one-shot request handed to that screen —
 * not a route. Home is the only producer today (every card is a verb, and most
 * verbs land in another tab); every screen that can be a target consumes its
 * own field below.
 */
export type NavTarget =
  | {
      tab: "library";
      /** Apply this tag as the Library's filter on arrival. */
      tag?: string;
      /** Open the add-bookmark sheet on arrival (first-run "save your first"). */
      add?: boolean;
    }
  | { tab: "sessions"; segment?: SessionsSegment }
  | { tab: "search"; focus?: boolean }
  // Settings is deliberately absent: it's no longer a tab but a shell-level
  // full-screen presentation, opened via HomeScreen's `onOpenSettings` callback
  // rather than a nav target.
  | { tab: "home" };
